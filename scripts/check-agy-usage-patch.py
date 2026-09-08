#!/usr/bin/env python3
"""OPT-IN check for scripts/agy-usage-forwarding.patch.

Needs stdlib plus the `patch` binary. Reads the pinned server/schema
sources straight from the archive under test: no extraction directory, no
machine-specific paths, no production touch, no model spend.

  python3 scripts/check-agy-usage-patch.py --par <agy_acp_server.par>

This checks patched source only. Native loader verification must also use
a separately rebuilt executable with matching Python 3.14 bytecode.
"""

import argparse
import ast
import subprocess
import sys
import tempfile
import types
import zipfile
from pathlib import Path

VERSION = "agy_acp_server_20260818_01_RC01"
BASE = "google3/cloud/developer_experience/antigravity_extensions/acp_server/"

ap = argparse.ArgumentParser()
ap.add_argument("--par", required=True)
ap.add_argument("--patch", default=str(
    Path(__file__).with_name("agy-usage-forwarding.patch")))
args = ap.parse_args()

zf = zipfile.ZipFile(args.par)
server = zf.read(BASE + "server.py").decode()
version_src = zf.read(BASE + "_version.py").decode()
schema_src = zf.read("google3/third_party/py/acp/schema.py").decode()

assert f'__version__ = "{VERSION}"' in version_src, "version drift"
for anchor in ('    stop_reason: schema.StopReason = "end_turn"',
                 "    return schema.PromptResponse(stop_reason=stop_reason)"):
    assert server.count(anchor) == 1, f"anchor not unique: {anchor[:45]}"

with tempfile.TemporaryDirectory() as tmp:
    target = Path(tmp) / "server.py"
    target.write_text(server)
    try:
        subprocess.run(["patch", "-p0", "--batch", "--fuzz=0", str(target)],
                       input=Path(args.patch).read_bytes(), check=True, cwd=tmp)
    except FileNotFoundError:
        sys.exit("`patch` binary not installed")
    patched = target.read_text()
assert 'PromptResponse(stop_reason="cancelled")' in patched
assert 'PromptResponse(stop_reason="end_turn")' in patched

wanted = {"_prompt_token_usage", "_is_usage_count", "_MAX_SAFE_INTEGER"}
body = [n for n in ast.parse(patched).body
        if (isinstance(n, ast.FunctionDef) and n.name in wanted)
        or (isinstance(n, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_MAX_SAFE_INTEGER"
            for t in n.targets))]
assert len(body) == 3, "helpers missing after patch"
mod = ast.Module(body=body, type_ignores=[])


class FakeUsage:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


ns = {"schema": types.SimpleNamespace(Usage=FakeUsage, PromptResponse=types.SimpleNamespace)}
exec(compile(mod, "patched_server.py", "exec"), ns)  # noqa: S102
assert ns["_MAX_SAFE_INTEGER"] == 2**53 - 1
helper = ns["_prompt_token_usage"]

tree = ast.parse(schema_src)
aliases = {}
for node in ast.walk(tree):
    if isinstance(node, ast.ClassDef) and node.name == "Usage":
        for st in node.body:
            if isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name):
                for sub in ast.walk(st.annotation):
                    if isinstance(sub, ast.keyword) and sub.arg == "alias":
                        aliases[st.target.id] = ast.literal_eval(sub.value)
assert aliases["output_tokens"] == "outputTokens"
assert aliases["thought_tokens"] == "thoughtTokens"


def run(usage):
    return helper(types.SimpleNamespace(usage_metadata=usage))


def full(**kw):
    base = {"prompt_token_count": 13476, "candidates_token_count": 502,
            "thoughts_token_count": 430, "total_token_count": 14408,
            "cached_content_token_count": 100}
    base.update(kw)
    return types.SimpleNamespace(**base)


EXPECT = {"input_tokens": 13476, "output_tokens": 502,
          "thought_tokens": 430, "total_tokens": 14408,
          "cached_read_tokens": 100}
got = run(full())
assert got.kwargs == EXPECT, got.kwargs  # output is candidates only
assert run(full(cached_content_token_count=None)).kwargs == {
    k: v for k, v in EXPECT.items() if k != "cached_read_tokens"}
assert run(full(thoughts_token_count=None,
                total_token_count=13978)).kwargs == {
    "input_tokens": 13476, "output_tokens": 502, "total_tokens": 13978,
    "cached_read_tokens": 100}
assert run(full(prompt_token_count=0, candidates_token_count=0,
                thoughts_token_count=0, total_token_count=0,
                cached_content_token_count=0)).kwargs == {
    "input_tokens": 0, "output_tokens": 0, "thought_tokens": 0,
    "total_tokens": 0, "cached_read_tokens": 0}
for bad in (full(thoughts_token_count=None),  # matches neither convention
            full(total_token_count=None),
            full(total_token_count=14409),
            full(cached_content_token_count=13477),
            full(cached_content_token_count=-1), full(prompt_token_count=-1),
            full(candidates_token_count=502.0),
            full(thoughts_token_count=True, total_token_count=13979),
            full(total_token_count="14408"),
            full(prompt_token_count=2**53,
                 total_token_count=2**53 + 932)):  # above safe integer
    assert run(bad) is None, bad
assert run(None) is None


class RaisingResp:
    @property
    def usage_metadata(self):
        raise RuntimeError("boom")


assert helper(RaisingResp()) is None

wire = {aliases[k]: v for k, v in got.kwargs.items()}
assert wire == {"inputTokens": 13476, "outputTokens": 502,
                "thoughtTokens": 430, "totalTokens": 14408,
                "cachedReadTokens": 100}, wire
adapter = next(n for n in ast.parse(patched).body if isinstance(n, ast.ClassDef) and n.name == "AgyAdapter")
prompt = next(n for n in adapter.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "prompt")
assert isinstance(prompt.body[-1], ast.Return)
final = compile(ast.Expression(prompt.body[-1].value), "patched_prompt_return", "eval")
for status in ("completed", "failed"):
    result = eval(final, ns | {"response": types.SimpleNamespace(usage_metadata=full()),
                              "stop_reason": "end_turn", "unclosed_status": status})
    assert (result.usage is not None) == (status == "completed")
print("all usage-patch checks passed")
