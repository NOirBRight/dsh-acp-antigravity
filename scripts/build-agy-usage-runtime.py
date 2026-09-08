#!/usr/bin/env python3
"""OPT-IN rebuild of agy_acp_server.par with scripts/agy-usage-forwarding.patch.

Stdlib plus the `patch` binary. Gates on scripts/check-agy-usage-patch.py
against the source archive, applies the patch, regenerates the matching
hash-checked .pyc under the original co_filename (a compiler roundtrip on
the unpatched source must reproduce the stock .pyc byte-for-byte), then
writes a NEW file: stock ELF bootstrap + standalone payload zip. The
payload must use 0-based offsets, like stock: the loader parses offsets
relative to the `.par_data` section start, so absolute file offsets fail
with `wrong number of entries in central directory ... got 0`. Its bounds
check also needs the `.par_data` section size refreshed to the new payload
(a single sh_size field; anything else drifting refuses loudly). Raw
`objcopy --update-section` was measured unsuitable: it relocates the
section table to EOF, shifts `.par_data`, and the result is not even a
readable zip. Never modifies the source archive; refuses to overwrite
anything (O_EXCL).

  python3 scripts/build-agy-usage-runtime.py --par <stock.par> --out <new.par>
  python3 scripts/build-agy-usage-runtime.py --par <stock.par> --out <ui.par> --ownership-only
  python3 scripts/build-agy-usage-runtime.py --par <stock.par> --out <probe.par> \
      --sentinel AGY_USAGE_PROBE_SENTINEL   # probe only, proves loader reads it
"""

import argparse
import importlib.util
import marshal
import os
import py_compile
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

BASE = "google3/cloud/developer_experience/antigravity_extensions/acp_server/"
PY = BASE + "server.py"
PYC = BASE + "__pycache__/server.cpython-314.pyc"
HERE = Path(__file__).resolve().parent
CHUNK = 8 * 1024 * 1024
CHECKED = py_compile.PycInvalidationMode.CHECKED_HASH


def _fix_par_data_size(out, par_size, zip_start):
    """Point the ELF `.par_data` section at the rebuilt payload.

    The bootstrap bytes are preserved verbatim, so the section still claims
    the stock payload size; the loader rejects that (`Section not found:
    .par_data`). The section spans [zip_start, EOF), so only sh_size moves.
    Any shape drift refuses loudly instead of writing a suspect binary.
    """
    with open(out, "r+b") as f:
        eh = f.read(64)
        if eh[:4] != b"\x7fELF" or eh[4] != 2 or eh[5] != 1:
            sys.exit("ELF bootstrap drift: not LE ELF64")
        shoff = struct.unpack("<Q", eh[40:48])[0]
        shnum, shstr = struct.unpack("<HH", eh[60:64])
        if not 0 < shnum < 0xFF00 or shstr == 0xFFFF:
            sys.exit("ELF extended section numbering unsupported")
        f.seek(shoff)
        secs = [struct.unpack("<IIQQQQIIQQ", f.read(64)) for _ in range(shnum)]
        f.seek(secs[shstr][4])
        tab = f.read(secs[shstr][5])

        def name(o):
            e = tab.find(b"\x00", o)
            return tab[o:e] if e >= 0 else b""

        hits = [i for i, s in enumerate(secs) if name(s[0]) == b".par_data"]
        if len(hits) != 1:
            sys.exit(f".par_data lookup failed: {len(hits)} hits")
        i = hits[0]
        typ, off, size = secs[i][1], secs[i][4], secs[i][5]
        if typ != 1 or off != zip_start or off + size != par_size:
            sys.exit(f".par_data shape drift: type={typ} off={off} size={size}")
        f.seek(shoff + i * 64 + 32)
        f.write(struct.pack("<Q", os.path.getsize(out) - off))


ap = argparse.ArgumentParser()
ap.add_argument("--par", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--patch")
ap.add_argument("--ownership-only", action="store_true", help="forward trajectory metadata without changing token reporting")
ap.add_argument("--sentinel", default=None, help="probe only: top-level SystemExit marker")
args = ap.parse_args()
args.patch = args.patch or str(HERE / ("agy-subagent-ownership.patch" if args.ownership_only else "agy-usage-forwarding.patch"))
checker = "check-agy-subagent-ownership.py" if args.ownership_only else "check-agy-usage-patch.py"
marker = "_with_trajectory_meta" if args.ownership_only else "_prompt_token_usage"
par, out = Path(args.par), Path(args.out)
if par.resolve() == out.resolve():
    sys.exit("refusing: --out is the source archive")
if out.exists():
    sys.exit(f"refusing: output exists: {out}")

subprocess.run([sys.executable, str(HERE / checker),
                "--par", str(par), "--patch", args.patch], check=True)

with zipfile.ZipFile(par) as src:
    orig_py, orig_pyc = src.read(PY), src.read(PYC)
    min_off = min(i.header_offset for i in src.infolist())
    n_entries = len(src.infolist())
if orig_pyc[:4] != importlib.util.MAGIC_NUMBER:
    sys.exit("pyc magic drift: archive needs a different Python")
dfile = marshal.loads(orig_pyc[16:]).co_filename  # e.g. cloud/.../server.py
if not dfile.endswith("server.py"):
    sys.exit(f"unexpected co_filename: {dfile!r}")
mode = stat.S_IMODE(os.stat(par).st_mode)


def _compile(data):
    with tempfile.TemporaryDirectory() as td:
        target = Path(td) / "server.py"
        target.write_bytes(data)
        pyc_file = Path(td) / "server.pyc"
        py_compile.compile(str(target), cfile=str(pyc_file), dfile=dfile,
                           invalidation_mode=CHECKED)
        return pyc_file.read_bytes()


if _compile(orig_py) != orig_pyc:
    sys.exit("compiler roundtrip failed: toolchain differs from stock build")

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    target = td / "server.py"
    target.write_bytes(orig_py)
    try:
        subprocess.run(["patch", "-p0", "--batch", "--fuzz=0", str(target)],
                       input=Path(args.patch).read_bytes(), check=True, cwd=td)
    except FileNotFoundError:
        sys.exit("`patch` binary not installed")
    patched = target.read_bytes()
    if args.sentinel:
        patched = f"raise SystemExit({args.sentinel!r})\n".encode() + patched
    new_pyc = _compile(patched)
    if new_pyc[:8] != orig_pyc[:8]:
        sys.exit("pyc header drift (magic/flags)")
    if not args.sentinel:
        if args.ownership_only and b"_prompt_token_usage" in patched:
            sys.exit("ownership-only build must not introduce token reporting")
        if marker.encode() not in patched:
            sys.exit("patch marker missing from source")
        if marker not in marshal.loads(new_pyc[16:]).co_names:
            sys.exit("pyc/source mismatch")
    tmpzip = td / "payload.zip"
    with zipfile.ZipFile(par) as src, zipfile.ZipFile(tmpzip, "w") as dst:
        dst.comment = src.comment
        for info in src.infolist():
            zi = zipfile.ZipInfo(filename=info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.comment = info.comment
            zi.extra = info.extra
            zi.internal_attr = info.internal_attr
            zi.external_attr = info.external_attr
            zi.create_system = info.create_system
            zi.create_version = info.create_version
            data = patched if info.filename == PY else new_pyc if info.filename == PYC else None
            if data is not None:
                with dst.open(zi, "w") as w:
                    w.write(data)
            else:
                with src.open(info) as r, dst.open(zi, "w") as w:
                    shutil.copyfileobj(r, w, CHUNK)
    owned = False
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o755)
        owned = True
        with os.fdopen(fd, "wb") as f:
            with open(par, "rb") as s:
                remaining = min_off
                while remaining:
                    chunk = s.read(min(CHUNK, remaining))
                    if not chunk:
                        raise IOError("source shrank during bootstrap copy")
                    f.write(chunk)
                    remaining -= len(chunk)
            with open(tmpzip, "rb") as z:
                shutil.copyfileobj(z, f, CHUNK)
        _fix_par_data_size(out, os.path.getsize(par), min_off)
        os.chmod(out, mode)
    except BaseException:
        if owned:
            try:
                os.unlink(out)
            except OSError:
                pass
        raise

print(f"wrote {out} ({out.stat().st_size} bytes, bootstrap {min_off}, "
      f"{n_entries} entries, replaced {PY} + {PYC})")
