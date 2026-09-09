#!/usr/bin/env python3
"""Check the pinned native proxy patch with actual wrappers, no credentials or model calls."""
import argparse
import ast
import asyncio
import json
from pathlib import Path
import subprocess
import tempfile
import time
import types
import uuid
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--par", required=True)
args = parser.parse_args()
here = Path(__file__).resolve().parent
base = "google3/cloud/developer_experience/antigravity_extensions/acp_server/"
with zipfile.ZipFile(args.par) as archive:
    source = archive.read(base + "server.py").decode()
    schema = archive.read("google3/third_party/py/acp/schema.py").decode()
    assert 'agy_acp_server_20260818_01_RC01' in archive.read(base + "_version.py").decode()
response_node = next(n for n in ast.parse(schema).body if isinstance(n, ast.ClassDef) and n.name == "PromptResponse")
meta = next(n for n in response_node.body if isinstance(n, ast.AnnAssign) and n.target.id == "field_meta")
assert 'alias="_meta"' in ast.get_source_segment(schema, meta)
info_base = next(n for n in ast.parse(schema).body if isinstance(n, ast.ClassDef) and n.name == "_SessionInfoUpdate")
info_meta = next(n for n in info_base.body if isinstance(n, ast.AnnAssign) and n.target.id == "field_meta")
assert 'alias="_meta"' in ast.get_source_segment(schema, info_meta)
info_update = next(n for n in ast.parse(schema).body if isinstance(n, ast.ClassDef) and n.name == "SessionInfoUpdate")
info_disc = next(st for st in info_update.body if isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name) and st.target.id == "session_update")
assert info_disc.value is None
from typing import Optional, Dict, Any, Literal
from pydantic.v1 import BaseModel as V1Model, Field as V1Field, ValidationError as V1Error
class _ACP(V1Model):
    class Config:
        allow_population_by_field_name = True
class _SessionInfoUpdate(_ACP):
    title: Optional[str] = None
    updated_at: Optional[str] = V1Field(default=None, alias="updatedAt")
    field_meta: Optional[Dict[str, Any]] = V1Field(default=None, alias="_meta")
class SessionInfoUpdate(_SessionInfoUpdate):
    session_update: Literal["session_info_update"] = V1Field(alias="sessionUpdate")
try:
    SessionInfoUpdate(field_meta={"agy.requestTelemetry": {"version": 1}})
    raise AssertionError("SessionInfoUpdate must require session_update")
except V1Error:
    pass
real = SessionInfoUpdate(session_update="session_info_update", field_meta={"agy.requestTelemetry": {"version": 1, "provenance": "ccpa-proxy", "scope": "session", "promptId": "p", "sessionKey": "s", "requests": []}})
assert real.session_update == "session_info_update" and real.field_meta["agy.requestTelemetry"]["scope"] == "session"
with tempfile.TemporaryDirectory() as directory:
    target = Path(directory) / "server.py"
    target.write_text(source)
    for name in ("agy-usage-forwarding.patch", "agy-request-telemetry.patch"):
        subprocess.run(["patch", "--batch", "--forward", "--fuzz=0", str(target)], input=(here / name).read_bytes(), cwd=directory, check=True)
    patched = target.read_text()
ast.parse(patched)
assert "agy.usageSnapshots" in patched
assert "session_info_update" in patched and "run_coroutine_threadsafe" in patched
block = patched.split("# BEGIN AGY-REQUEST-TELEMETRY\n", 1)[1].split("# END AGY-REQUEST-TELEMETRY", 1)[0]
namespace = {"json": json, "uuid": uuid}
exec(compile(block, "native_request_telemetry", "exec"), namespace)

def _cumulative_usage(agent):
    try:
        return agent.conversation.total_usage
    except Exception:
        return None

def _usage_snapshot(usage):
    if usage is None:
        return None
    snapshot = {}
    for name in ("prompt_token_count", "candidates_token_count", "thoughts_token_count", "total_token_count", "cached_content_token_count"):
        try:
            snapshot[name] = getattr(usage, name)
        except Exception:
            snapshot[name] = None
    return snapshot

namespace.update(_cumulative_usage=_cumulative_usage, _usage_snapshot=_usage_snapshot)
slot = namespace["_request_telemetry_slot"]
usage = {"promptTokenCount": 100, "candidatesTokenCount": 20, "thoughtsTokenCount": 30, "totalTokenCount": 150}
line = b"data: " + json.dumps({"response": {"usageMetadata": usage, "text": "not retained"}}).encode()
records = []
slot.current = {"sessionKey": "agent-a", "records": records}

def clock(*values):
    ticks = iter(values)
    namespace["_request_time"] = types.SimpleNamespace(monotonic=lambda: next(ticks))

def stream(lines, code=200):
    return namespace["_request_telemetry_wrap_stream"](lambda **kwargs: (code, {}, iter(lines)))

clock(1, 3)
assert list(stream([b"noise", line, b"data: [DONE]"])(model="gemini")[2]) == [b"noise", line, b"data: [DONE]"]
assert records[-1]["durationMs"] == 2000 and records[-1]["status"] == "completed"
assert records[-1]["usageMetadata"] == usage
assert "cachedContentTokenCount" not in records[-1]["usageMetadata"]
assert set(records[-1]) == {"requestId", "model", "durationMs", "status", "usageMetadata"}
zero = b'data: {"response":{"usageMetadata":{"cachedContentTokenCount":0}}}'
clock(0, .00025)
list(stream([line, zero])(model="gemini")[2])
assert records[-1]["usageMetadata"] == {"cachedContentTokenCount": 0}
assert records[-1]["durationMs"] == .25

for consume in (False, True):
    clock(1, 2)
    iterator = stream([line])(model="gemini")[2]
    if consume:
        next(iterator)
    count = len(records)
    iterator.close()
    iterator.close()
    assert len(records) == count + 1 and records[-1]["status"] == "cancelled"

clock(0, 1)
list(stream([line], 503)(model="gemini")[2])
assert records[-1]["status"] == "failed"

def fail(**kwargs):
    raise RuntimeError("upstream failure")

clock(0, 1)
try:
    namespace["_request_telemetry_wrap_stream"](fail)(model="gemini")
    raise AssertionError("must propagate upstream failure")
except RuntimeError:
    pass
assert records[-1]["status"] == "failed" and records[-1]["usageMetadata"] is None
clock(1, 2)
unary = namespace["_request_telemetry_wrap_unary"](lambda **kwargs: (200, {}, json.dumps({"usageMetadata": usage}).encode()))
unary(model="gemini")
assert records[-1]["status"] == "completed" and records[-1]["usageMetadata"] == usage

# An in-flight request retains its prompt bucket even after the session starts another prompt.
clock(1, 2)
old = stream([line])(model="gemini")[2]
new_records = []
slot.current = {"sessionKey": "agent-a", "records": new_records}
list(old)
assert not new_records and records[-1]["status"] == "completed"
slot.current = None
count = len(records)
list(stream([line])(model="gemini")[2])
assert len(records) == count
namespace["_request_time"] = time

class Response:
    field_meta = {"agy.usageSnapshots": {"preserved": True}}
    def copy(self, update):
        result = Response()
        result.__dict__.update(update)
        return result

class SessionInfoUpdate:
    def __init__(self, session_update=None, field_meta=None, **kwargs):
        assert session_update == "session_info_update"
        self.session_update = session_update
        self.field_meta = field_meta

class Client:
    def __init__(self):
        self.updates = []
        self.fail = False
    async def session_update(self, session_id, update):
        if self.fail:
            raise RuntimeError("session_update failed")
        self.updates.append((session_id, update))

namespace["schema"] = types.SimpleNamespace(SessionInfoUpdate=SessionInfoUpdate)

client = types.SimpleNamespace(stream_generate_content=lambda **kwargs: (200, {}, iter([line])), generate_content=lambda **kwargs: (200, {}, b"{}"))
class Handler:
    def __init__(self, key):
        self.headers = {"X-ACP-Trajectory-Id": key}
    def do_POST(self):
        list(client.stream_generate_content(model=self.headers["X-ACP-Trajectory-Id"])[2])

class Adapter:
    def __init__(self):
        self._prompt_ids = {}
        self._prompt_seq = 0
        self._client = Client()
        self._sessions = {}
        self.steps = []
    def _next_prompt_id(self, session_id):
        self._prompt_seq += 1
        prompt_id = "prompt-" + session_id + "-" + str(self._prompt_seq)
        self._prompt_ids[session_id] = prompt_id
        return prompt_id
    async def _stream_live_step(self, session_id, step, *args, **kwargs):
        self.steps.append(step)
    async def prompt(self, prompt, session_id, **kwargs):
        if prompt == "stale":
            await self._stream_live_step(session_id, "early")
            self._next_prompt_id(session_id)
            await self._stream_live_step(session_id, "late")
            await asyncio.to_thread(Handler("agent-" + session_id).do_POST)
            await asyncio.sleep(0)
            return Response()
        self._next_prompt_id(session_id)
        if prompt == "sdk":
            await self._stream_live_step(session_id, "thought")
            usage = self._sessions[session_id].agent.conversation.total_usage
            usage.cached_content_token_count = 0
            await self._stream_live_step(session_id, "text")
            return Response()
        await asyncio.to_thread(Handler("agent-" + session_id).do_POST)
        if prompt == "flush":
            await asyncio.sleep(0)
        if prompt == "twice":
            await asyncio.sleep(0)
            await asyncio.to_thread(Handler("agent-" + session_id).do_POST)
            await asyncio.sleep(0)
        if prompt == "fail":
            raise RuntimeError("prompt failed")
        return Response()

namespace.update(ccpa_client=client, proxy_server=types.SimpleNamespace(ProxyHandler=Handler), session_store=types.SimpleNamespace(SESSION_FILE_PREFIX="agent-"))
Adapter = namespace["_install_request_telemetry"](Adapter)

async def check_prompts():
    caught = []
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(lambda _loop, context: caught.append(context))
    adapter = Adapter()
    first, second = await asyncio.gather(adapter.prompt("ok", "a"), adapter.prompt("ok", "b"))
    for result, key in ((first, "a"), (second, "b")):
        assert result.field_meta["agy.usageSnapshots"] == {"preserved": True}
        evidence = result.field_meta["agy.requestTelemetry"]
        assert evidence["sessionKey"] == "agent-" + key and evidence["promptId"].startswith("prompt-" + key + "-")
        assert evidence["scope"] == "session" and evidence["version"] == 1
        assert len(evidence["requests"]) == 1 and evidence["requests"][0]["model"] == "agent-" + key
    assert first.field_meta["agy.requestTelemetry"]["requests"][0]["requestId"] != second.field_meta["agy.requestTelemetry"]["requests"][0]["requestId"]
    assert namespace["_request_telemetry_by_session"] == {}
    try:
        await adapter.prompt("fail", "a")
        raise AssertionError("must propagate prompt failure")
    except RuntimeError:
        pass
    assert namespace["_request_telemetry_by_session"] == {}
    await asyncio.sleep(0)
    assert caught == []

    flushed = Adapter()
    result = await flushed.prompt("flush", "c")
    bags = [update.field_meta["agy.requestTelemetry"] for _, update in flushed._client.updates]
    assert bags, "completed upstream must emit session_info_update before terminal attach can drop"
    assert all(update.session_update == "session_info_update" for _, update in flushed._client.updates)
    assert all(_id == "c" for _id, _ in flushed._client.updates)
    assert bags[0]["promptId"] == result.field_meta["agy.requestTelemetry"]["promptId"]
    assert bags[0]["sessionKey"] == "agent-c" and bags[0]["scope"] == "session"
    flushed._client.updates.clear()
    second = await flushed.prompt("flush", "c")
    bags2 = [update.field_meta["agy.requestTelemetry"] for _, update in flushed._client.updates]
    assert bags2 and {bag["promptId"] for bag in bags2} == {second.field_meta["agy.requestTelemetry"]["promptId"]}
    assert result.field_meta["agy.requestTelemetry"]["promptId"] != second.field_meta["agy.requestTelemetry"]["promptId"]
    assert len(bags[0]["requests"]) == 1 and bags[0]["requests"][0]["status"] == "completed"
    assert bags[0]["requests"][0]["usageMetadata"] == usage
    assert "text" not in bags[0]["requests"][0]["usageMetadata"]
    terminal = result.field_meta["agy.requestTelemetry"]
    assert terminal["requests"][0]["requestId"] == bags[0]["requests"][0]["requestId"]
    assert len(terminal["requests"]) == 1

    twice = Adapter()
    result = await twice.prompt("twice", "d")
    bags = [update.field_meta["agy.requestTelemetry"] for _, update in twice._client.updates]
    assert [len(bag["requests"]) for bag in bags] == [1, 2]
    assert all(req["status"] == "completed" for bag in bags for req in bag["requests"])
    assert len(result.field_meta["agy.requestTelemetry"]["requests"]) == 2
    assert result.field_meta["agy.requestTelemetry"]["requests"][0]["requestId"] == bags[1]["requests"][0]["requestId"]

    boom = Adapter()
    boom._client.fail = True
    wrapped_stream = client.stream_generate_content
    def boom_stream(**kwargs):
        return 200, {}, iter([b"noise", line, b"data: [DONE]"])
    client.stream_generate_content = boom_stream
    pending = set()
    slot.current = {
        "records": [], "adapter": boom, "loop": loop, "session_id": "e",
        "sessionKey": "agent-e", "pending": pending, "closed": False,
    }
    boom._prompt_ids["e"] = "prompt-e"
    clock(0, 1)
    yielded = list(stream([b"noise", line, b"data: [DONE]"])(model="gemini")[2])
    assert yielded == [b"noise", line, b"data: [DONE]"]
    await asyncio.sleep(0)
    assert boom._client.updates == []
    for fut in list(pending):
        fut.cancel()
    client.stream_generate_content = wrapped_stream
    await asyncio.sleep(0)
    assert caught == []

    # close() is cancelled: no completed progressive emit.
    live = Adapter()
    pending = set()
    slot.current = {
        "records": [], "adapter": live, "loop": loop, "session_id": "f",
        "sessionKey": "agent-f", "pending": pending, "closed": False,
    }
    live._prompt_ids["f"] = "prompt-f"
    clock(0, 1)
    iterator = stream([line])(model="gemini")[2]
    next(iterator)
    iterator.close()
    namespace["_request_time"] = time
    await asyncio.sleep(0)
    assert live._client.updates == []
    assert pending == [] or all(fut.cancelled() or fut.done() for fut in list(pending))
    slot.current = None
    await asyncio.sleep(0)
    assert caught == []

    sdk_usage = types.SimpleNamespace(
        prompt_token_count=10562, candidates_token_count=83,
        thoughts_token_count=268, total_token_count=10913)
    session = types.SimpleNamespace(
        usage_epoch_is_fresh=True,
        agent=types.SimpleNamespace(conversation=types.SimpleNamespace(total_usage=sdk_usage)))
    sdk = Adapter()
    sdk._sessions["g"] = session
    result = await sdk.prompt("sdk", "g")
    metas = [update.field_meta for _, update in sdk._client.updates]
    snaps = [meta["agy.usageSnapshots"] for meta in metas if "agy.usageSnapshots" in meta]
    assert snaps, "SDK snapshots must arrive from _stream_live_step while prompt is pending"
    assert sdk.steps == ["thought", "text"]
    first, last = snaps[0], snaps[-1]
    assert first["completed"] is False and first["provenance"] == "sdk-cumulative"
    assert first["baseline"] == "fresh-session" and first["promptId"] == result.field_meta["agy.requestTelemetry"]["promptId"]
    assert first["start"]["prompt_token_count"] == 10562
    assert first["start"]["cached_content_token_count"] is None
    assert [s["end"]["cached_content_token_count"] for s in snaps] == [0]
    assert last["start"]["prompt_token_count"] == 10562
    assert all(meta["agy.requestTelemetry"]["requests"] == [] for meta in metas)
    assert result.field_meta["agy.usageSnapshots"] == {"preserved": True}
    sdk_usage.prompt_token_count = 1
    assert first["start"]["prompt_token_count"] == 10562

    stale = Adapter()
    first_stale = await stale.prompt("flush", "h")
    stale._client.updates.clear()
    second_stale = await stale.prompt("stale", "h")
    progress_ids = [update.field_meta["agy.requestTelemetry"]["promptId"] for _, update in stale._client.updates]
    terminal_id = second_stale.field_meta["agy.requestTelemetry"]["promptId"]
    assert progress_ids and set(progress_ids) == {terminal_id}
    assert first_stale.field_meta["agy.requestTelemetry"]["promptId"] != terminal_id
    assert stale.steps == ["early", "late"]

    real_emit = namespace["_request_telemetry_emit_live"]
    async def boom_emit(*args, **kwargs):
        raise RuntimeError("emit-live")
    namespace["_request_telemetry_emit_live"] = boom_emit
    boom_live = Adapter()
    await boom_live._stream_live_step("z", "kept")
    assert boom_live.steps == ["kept"]
    namespace["_request_telemetry_emit_live"] = real_emit

asyncio.run(check_prompts())
print("native request telemetry checks passed")
