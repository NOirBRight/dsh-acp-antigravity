#!/usr/bin/env python3
"""OPT-IN check for scripts/agy-subagent-ownership.patch.

Needs stdlib plus the patch binary. Reads the pinned server sources
straight from the archive under test: no extraction directory, no
machine-specific paths, no production touch, no model spend.

  python3 scripts/check-agy-subagent-ownership.py --par <agy_acp_server.par>

This checks patched source only: helper behavior, exact emission sites,
deliberately unpatched sites, and clean combined application with the
usage patch. Native loader verification must use a separately rebuilt
executable with matching Python 3.14 bytecode.
"""

import argparse
import ast
import subprocess
import sys
import tempfile
import types
import zipfile
from pathlib import Path

VERSION = 'agy_acp_server_20260818_01_RC01'
BASE = 'google3/cloud/developer_experience/antigravity_extensions/acp_server/'

ap = argparse.ArgumentParser()
ap.add_argument('--par', required=True)
ap.add_argument('--patch', default=str(
    Path(__file__).with_name('agy-subagent-ownership.patch')))
ap.add_argument('--usage-patch', default=str(
    Path(__file__).with_name('agy-usage-forwarding.patch')))
args = ap.parse_args()

zf = zipfile.ZipFile(args.par)
server = zf.read(BASE + 'server.py').decode()
version_src = zf.read(BASE + '_version.py').decode()

assert 'agy.trajectory' not in server, 'stock source already carries ownership'
assert '__version__ = "' + VERSION + '"' in version_src, 'version drift'
anchors = {
    'return tool_call_id == step_str or tool_call_id.endswith(f":{step_str}")': 1,
    'field_meta=stream_meta,': 2,
    'type=' + chr(34) + 'text' + chr(34) + ', text=step.thinking_delta': 1,
    'type=' + chr(34) + 'text' + chr(34) + ', text=step.content_delta': 1,
    'status="failed" if is_error else "completed",': 1,
}
for anchor, want in anchors.items():
    assert server.count(anchor) == want, 'anchor drift: ' + anchor[:45]

def apply_patch(target, patch):
    try:
        subprocess.run(['patch', '-p0', '--batch', '--fuzz=0', str(target)],
                       input=Path(patch).read_bytes(), check=True, cwd=target.parent)
    except FileNotFoundError:
        sys.exit('patch binary not installed')

with tempfile.TemporaryDirectory() as tmp:
    lone = Path(tmp) / 'stock.py'
    lone.write_text(server)
    apply_patch(lone, args.patch)
    target = Path(tmp) / 'server.py'
    target.write_text(server)
    for patch in (args.usage_patch, args.patch):
        apply_patch(target, patch)
    patched = target.read_text()
assert 'PromptResponse(' in patched  # usage hunk applied alongside
assert 'agy-subagent-ownership' not in patched  # patch header leaves no marker
assert patched.count('_with_trajectory_meta(step, stream_meta)') == 2
assert patched.count('_with_trajectory_meta(step, None)') == 3
assert 'PromptResponse' not in Path(args.patch).read_text()
assert patched.count('"agy.toolName"') == 2, 'toolName at exactly the two announce sites'
assert patched.count('"agy.toolName": str(call.name)') == 2, 'toolName forwards raw str(call.name)'
assert patched.count('**(_with_trajectory_meta(step, stream_meta) or {})') == 2, 'toolName spread preserves trajectory+MCP meta'
for helper in ('_extract_tool_display_title', '_infer_tool_kind', '_tool_call_name', '_extract_tool_locations', '_extract_tool_content'):
    assert patched.count(helper) == server.count(helper), helper + ' must not feed toolName'
added = [l for l in Path(args.patch).read_text().splitlines() if l.startswith('+') and not l.startswith('+++')]
assert not any('title=' in l for l in added), 'patch must not touch title behavior'

tree = ast.parse(patched)
fns = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
assert set(('_trajectory_meta', '_with_trajectory_meta')) <= set(fns)
adapter = next(n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == 'AgyAdapter')
methods = {n.name: n for n in adapter.body if isinstance(n, ast.AsyncFunctionDef)}
live = ast.get_source_segment(patched, methods['_stream_live_step'])
hist = ast.get_source_segment(patched, methods['_stream_historical_step'])
reject = ast.get_source_segment(patched, methods['_reject_tool_call'])
sweep = ast.get_source_segment(patched, methods['_close_open_tool_calls'])
assert live.count('_with_trajectory_meta') == 5
assert live.count('agy.toolName') == 2, 'toolName confined to live announce sites'
for name, src in (('historical', hist), ('reject', reject), ('sweep', sweep)):
    assert '_trajectory_meta' not in src, name + ' must not attribute foreign rows'

wanted = {'_trajectory_meta', '_with_trajectory_meta'}
body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted]
assert len(body) == 2, 'helpers missing after patch'
mod = ast.Module(body=body, type_ignores=[])
ns = {}
exec(compile(mod, 'patched_server.py', 'exec'), ns)  # noqa: S102
meta = ns['_trajectory_meta']
merge = ns['_with_trajectory_meta']

step = types.SimpleNamespace(trajectory_id='child-9', parent_trajectory_id='main', depth=2)
assert meta(step) == {'agy.trajectory': {'trajectoryId': 'child-9', 'parentTrajectoryId': 'main', 'depth': 2}}
root = types.SimpleNamespace(trajectory_id='main', parent_trajectory_id='', depth=0)
assert meta(root) == {'agy.trajectory': {'trajectoryId': 'main', 'depth': 0}}
assert meta(types.SimpleNamespace(trajectory_id='', parent_trajectory_id='main', depth=1)) is None
assert meta(types.SimpleNamespace(trajectory_id=None, parent_trajectory_id='main', depth=1)) is None
assert meta(types.SimpleNamespace(trajectory_id=42, parent_trajectory_id='main', depth=1)) is None
assert meta(types.SimpleNamespace()) is None
assert meta(types.SimpleNamespace(trajectory_id='t', parent_trajectory_id='', depth=True)) == {'agy.trajectory': {'trajectoryId': 't'}}
assert meta(types.SimpleNamespace(trajectory_id='t', parent_trajectory_id='', depth=-1)) == {'agy.trajectory': {'trajectoryId': 't'}}
assert meta(types.SimpleNamespace(trajectory_id='t', parent_trajectory_id='', depth=1.5)) == {'agy.trajectory': {'trajectoryId': 't'}}
assert meta(types.SimpleNamespace(trajectory_id='t', parent_trajectory_id=7, depth=0)) == {'agy.trajectory': {'trajectoryId': 't', 'depth': 0}}

existing = {'mcp': {'tool': 'read'}}
merged = merge(step, existing)
assert merged == {'mcp': {'tool': 'read'}, 'agy.trajectory': {'trajectoryId': 'child-9', 'parentTrajectoryId': 'main', 'depth': 2}}
assert existing == {'mcp': {'tool': 'read'}}, 'input mapping must not be mutated'
assert merge(step, None) == {'agy.trajectory': {'trajectoryId': 'child-9', 'parentTrajectoryId': 'main', 'depth': 2}}
assert merge(types.SimpleNamespace(trajectory_id=''), existing) is existing
assert merge(step, 'nope') == {'agy.trajectory': {'trajectoryId': 'child-9', 'parentTrajectoryId': 'main', 'depth': 2}}
stale = {'agy.trajectory': {'trajectoryId': 'old'}}
assert merge(step, stale)['agy.trajectory']['trajectoryId'] == 'child-9'
assert stale == {'agy.trajectory': {'trajectoryId': 'old'}}

call = types.SimpleNamespace(name='read')
def site(st, sm, c):
    return {**(merge(st, sm) or {}), 'agy.toolName': str(c.name)}  # mirrors pinned site expression
assert site(step, existing, call) == {'mcp': {'tool': 'read'}, 'agy.trajectory': {'trajectoryId': 'child-9', 'parentTrajectoryId': 'main', 'depth': 2}, 'agy.toolName': 'read'}
assert site(step, None, call) == {'agy.trajectory': {'trajectoryId': 'child-9', 'parentTrajectoryId': 'main', 'depth': 2}, 'agy.toolName': 'read'}
assert site(types.SimpleNamespace(trajectory_id=''), None, call) == {'agy.toolName': 'read'}

print('all subagent-ownership checks passed')
