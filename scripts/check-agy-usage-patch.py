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
assert 'stop_reason="cancelled"' in patched
assert 'PromptResponse(stop_reason="end_turn")' in patched

wanted = {"_prompt_token_usage", "_is_usage_count", "_MAX_SAFE_INTEGER", "_count_delta", "_usage_field", "_cumulative_usage", "_usage_snapshot"}
body = [n for n in ast.parse(patched).body
        if (isinstance(n, ast.FunctionDef) and n.name in wanted)
        or (isinstance(n, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_MAX_SAFE_INTEGER"
            for t in n.targets))]
assert len(body) == 7, "helpers missing after patch"
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
    return helper(usage, None, True)


def full(**kw):
    base = {"prompt_token_count": 13476, "candidates_token_count": 502,
            "thoughts_token_count": 430, "total_token_count": 14408,
            "cached_content_token_count": 100}
    base.update(kw)
    return types.SimpleNamespace(**base)


# ACP aggregate = SDK uncached + cache. Independently: 13476+100, 14408+100.
EXPECT = {"input_tokens": 13576, "output_tokens": 502,
          "thought_tokens": 430, "total_tokens": 14508,
          "cached_read_tokens": 100}
got = run(full())
assert got.kwargs == EXPECT, got.kwargs  # output is candidates only
assert run(full(cached_content_token_count=None)) is None  # missing cache is not 0
assert run(full(thoughts_token_count=None,
                total_token_count=13978)).kwargs == {
    "input_tokens": 13576, "output_tokens": 502, "total_tokens": 14078,
    "cached_read_tokens": 100}
assert run(full(prompt_token_count=0, candidates_token_count=0,
                thoughts_token_count=0, total_token_count=0,
                cached_content_token_count=0)).kwargs == {
    "input_tokens": 0, "output_tokens": 0, "thought_tokens": 0,
    "total_tokens": 0, "cached_read_tokens": 0}
# SDK prompt excludes cache, so cache may exceed uncached prompt.
assert run(full(cached_content_token_count=13477)).kwargs == {
    "input_tokens": 26953, "output_tokens": 502, "thought_tokens": 430,
    "total_tokens": 27885, "cached_read_tokens": 13477}
for bad in (full(thoughts_token_count=None),  # matches neither convention
            full(total_token_count=None),
            full(total_token_count=14409),
            full(cached_content_token_count=-1), full(prompt_token_count=-1),
            full(candidates_token_count=502.0),
            full(thoughts_token_count=True, total_token_count=13979),
            full(total_token_count="14408"),
            full(prompt_token_count=2**53,
                 total_token_count=2**53 + 932),  # above safe integer
            full(prompt_token_count=2**53 - 5, candidates_token_count=0,
                 thoughts_token_count=0, total_token_count=2**53 - 5,
                 cached_content_token_count=10)):  # aggregate overflows
    assert run(bad) is None, bad
assert run(None) is None


class RaisingResp:
    @property
    def usage_metadata(self):
        raise RuntimeError("boom")


assert helper(RaisingResp()) is None

wire = {aliases[k]: v for k, v in got.kwargs.items()}
assert wire == {"inputTokens": 13576, "outputTokens": 502,
                "thoughtTokens": 430, "totalTokens": 14508,
                "cachedReadTokens": 100}, wire
adapter = next(n for n in ast.parse(patched).body if isinstance(n, ast.ClassDef) and n.name == "AgyAdapter")
prompt = next(n for n in adapter.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "prompt")
assert isinstance(prompt.body[-1], ast.Return)
final = compile(ast.Expression(prompt.body[-1].value), "patched_prompt_return", "eval")
# Sidecar 21b0f0fb… seq 16/17. SDK delta 8259/1722/0/9981/4050; raw 12309/1722/14031/4050.
start = full(prompt_token_count=59957, candidates_token_count=434, thoughts_token_count=657,
            total_token_count=61048, cached_content_token_count=8107)
end = full(prompt_token_count=68216, candidates_token_count=2156, thoughts_token_count=657,
          total_token_count=71029, cached_content_token_count=12157)
assert helper(end, start).kwargs == {"input_tokens": 12309, "output_tokens": 1722,
    "thought_tokens": 0, "total_tokens": 14031, "cached_read_tokens": 4050}
# Sidecar seq 13. SDK 49395/351/389/50135/8107; raw prompt 57502 cached 8107 output 740.
start2 = full(prompt_token_count=10562, candidates_token_count=83, thoughts_token_count=268,
             total_token_count=10913, cached_content_token_count=0)
end2 = full(prompt_token_count=59957, candidates_token_count=434, thoughts_token_count=657,
           total_token_count=61048, cached_content_token_count=8107)
assert helper(end2, start2).kwargs == {"input_tokens": 57502, "output_tokens": 351,
    "thought_tokens": 389, "total_tokens": 58242, "cached_read_tokens": 8107}
assert helper(full(cached_content_token_count=None), start) is None
assert helper(full(cached_content_token_count=0)) is None
assert helper(end, types.SimpleNamespace()) is None
fresh = helper(full(cached_content_token_count=0), None, True)
assert fresh.kwargs == {"input_tokens": 13476, "output_tokens": 502,
    "thought_tokens": 430, "total_tokens": 14408, "cached_read_tokens": 0}, fresh.kwargs
rewind = full(prompt_token_count=68216, candidates_token_count=2156, thoughts_token_count=657,
             total_token_count=71029, cached_content_token_count=4000)
assert helper(rewind, start) is None
assert helper(end, full(cached_content_token_count=None,
    prompt_token_count=59957, candidates_token_count=434, thoughts_token_count=657,
    total_token_count=61048)) is None

# Execute the actual final conditional and return, not a hand-built approximation.
final_start = next(i for i, node in enumerate(prompt.body)
                   if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "usage" for t in node.targets))
finish_fn = ast.FunctionDef(name="finish", args=ast.arguments(posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]),
                           body=prompt.body[final_start:], decorator_list=[])
finish_module = ast.fix_missing_locations(ast.Module(body=[finish_fn], type_ignores=[]))
exec(compile(finish_module, "actual_prompt_finish", "exec"), ns)
ns.update(self=types.SimpleNamespace(_prompt_ids={"session": "prompt"}), session_id="session",
          session_store=types.SimpleNamespace(SESSION_FILE_PREFIX="agy_"),
          stop_reason="end_turn", unclosed_status="completed", start_usage=start, fresh_epoch=False,
          agent=types.SimpleNamespace(conversation=types.SimpleNamespace(total_usage=end)), response=None)
assert ns["finish"]().usage.kwargs == {"input_tokens": 12309, "output_tokens": 1722,
    "thought_tokens": 0, "total_tokens": 14031, "cached_read_tokens": 4050}
ns.update(agent=types.SimpleNamespace(conversation=types.SimpleNamespace(total_usage=None)),
          response=types.SimpleNamespace(usage_metadata=full(cached_content_token_count=0)))
assert ns["finish"]().usage is None, "SDK zero-filled fallback must not replace unavailable raw snapshots"
ns["unclosed_status"] = "failed"
assert ns["finish"]().usage is None

# Actual except AntigravityCancelledError return, not a reconstructed stand-in.
cancelled_handler = next(
    h for h in ast.walk(prompt)
    if isinstance(h, ast.ExceptHandler) and h.type is not None
    and "AntigravityCancelledError" in ast.dump(h.type))
cancelled_tail = [s for s in cancelled_handler.body if isinstance(s, (ast.Assign, ast.Return))]
assert cancelled_tail and isinstance(cancelled_tail[-1], ast.Return)
assert "_prompt_token_usage" not in ast.dump(cancelled_tail[-1])
cancel_fn = ast.FunctionDef(name="cancelled_finish", args=ast.arguments(
    posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]),
    body=cancelled_tail, decorator_list=[])
exec(compile(ast.fix_missing_locations(ast.Module(body=[cancel_fn], type_ignores=[])),
             "actual_cancelled_return", "exec"), ns)
ns.update(start_usage=start, fresh_epoch=False,
          agent=types.SimpleNamespace(conversation=types.SimpleNamespace(total_usage=end)))
cancelled = ns["cancelled_finish"]()
assert cancelled.usage is None
meta = cancelled.field_meta["agy.usageSnapshots"]
assert meta["completed"] is False
assert meta["baseline"] == "cumulative"
assert meta["start"]["prompt_token_count"] == 59957
assert meta["end"]["prompt_token_count"] == 68216
assert None not in (meta["start"]["cached_content_token_count"], meta["end"]["cached_content_token_count"])
ns.update(start_usage=None,
          agent=types.SimpleNamespace(conversation=types.SimpleNamespace(total_usage=None)))
unavailable = ns["cancelled_finish"]()
assert unavailable.usage is None
empty = unavailable.field_meta["agy.usageSnapshots"]
assert empty["completed"] is False
assert empty["start"] is None and empty["end"] is None
print("all usage-patch checks passed")
