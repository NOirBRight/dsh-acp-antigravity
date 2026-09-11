#!/usr/bin/env python3
"""OPT-IN check for scripts/agy-user-question.patch.

Needs stdlib, pydantic.v1, and the patch binary. Reads pinned sources
straight from the archive: no leftover extraction, no production touch,
no model spend.

  python3 scripts/check-agy-user-question.py --par <agy_acp_server.par>
"""

import argparse
import ast
import asyncio
import subprocess
import sys
import tempfile
import textwrap
import types
import zipfile
from pathlib import Path
from typing import Any, Dict, Literal, Optional, Union

VERSION = "agy_acp_server_20260818_01_RC01"
BASE = "google3/cloud/developer_experience/antigravity_extensions/acp_server/"
HERE = Path(__file__).resolve().parent

ap = argparse.ArgumentParser()
ap.add_argument("--par", required=True)
ap.add_argument("--patch", default=str(HERE / "agy-user-question.patch"))
args = ap.parse_args()

zf = zipfile.ZipFile(args.par)
server = zf.read(BASE + "server.py").decode()
hooks = zf.read(BASE + "hooks.py").decode()
schema_src = zf.read("google3/third_party/py/acp/schema.py").decode()
event_src = zf.read(
    "google3/third_party/py/google/antigravity/connections/local/event_processor.py"
).decode()
version_src = zf.read(BASE + "_version.py").decode()

assert f'__version__ = "{VERSION}"' in version_src, "version drift"
assert "agy.supportsFreeform" not in server
assert "agy.freeformResponse" not in server
assert "QuestionResponse | None" not in server
assert "Awaitable[types.QuestionResponse | None]" not in hooks

tree = ast.parse(schema_src)
for name in ("RequestPermissionRequest", "RequestPermissionResponse"):
    node = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == name)
    meta = next(
        st
        for st in node.body
        if isinstance(st, ast.AnnAssign)
        and isinstance(st.target, ast.Name)
        and st.target.id == "field_meta"
    )
    assert 'alias="_meta"' in ast.get_source_segment(schema_src, meta), name
assert "if r.freeform_response:" in event_src
assert "mc_ans.freeform_response = r.freeform_response" in event_src

from pydantic.v1 import BaseModel as V1Model, Field as V1Field, ValidationError as V1Error


class _ACP(V1Model):
    class Config:
        allow_population_by_field_name = True


class DeniedOutcome(_ACP):
    outcome: Literal["cancelled"] = "cancelled"


class AllowedOutcome(_ACP):
    outcome: Literal["selected"] = "selected"
    option_id: str = V1Field(alias="optionId")
    field_meta: Optional[Dict[str, Any]] = V1Field(default=None, alias="_meta")


class RequestPermissionResponse(_ACP):
    outcome: Union[DeniedOutcome, AllowedOutcome] = V1Field(discriminator="outcome")
    field_meta: Optional[Dict[str, Any]] = V1Field(default=None, alias="_meta")


class RequestPermissionRequest(_ACP):
    session_id: str = V1Field(alias="sessionId")
    tool_call: Dict[str, Any] = V1Field(alias="toolCall")
    options: list
    field_meta: Optional[Dict[str, Any]] = V1Field(default=None, alias="_meta")


wire = RequestPermissionRequest(
    session_id="s",
    tool_call={"toolCallId": "interaction_abcd"},
    options=[],
    field_meta={"agy.supportsFreeform": True},
).dict(by_alias=True, exclude_none=True)
assert wire["_meta"] == {"agy.supportsFreeform": True}
assert "field_meta" not in wire
assert "agy" not in wire["_meta"]

parsed = RequestPermissionResponse.parse_obj(
    {"outcome": {"outcome": "cancelled"}, "_meta": {"agy.freeformResponse": "hello"}}
)
assert parsed.outcome.outcome == "cancelled"
assert parsed.field_meta["agy.freeformResponse"] == "hello"
assert (
    RequestPermissionResponse.parse_obj(
        {"outcome": {"outcome": "cancelled"}, "field_meta": {"agy.freeformResponse": "via-name"}}
    ).field_meta["agy.freeformResponse"]
    == "via-name"
)
try:
    RequestPermissionResponse.parse_obj({"field_meta": {"agy.freeformResponse": "x"}})
    raise AssertionError("response must require outcome")
except V1Error:
    pass

nested_only = RequestPermissionResponse.parse_obj(
    {"outcome": {"outcome": "cancelled"}, "_meta": {"agy": {"freeformResponse": "nested"}}}
)
assert "agy.freeformResponse" not in (nested_only.field_meta or {})

with tempfile.TemporaryDirectory() as tmp:
    Path(tmp, "server.py").write_text(server)
    Path(tmp, "hooks.py").write_text(hooks)
    try:
        subprocess.run(
            ["patch", "-p0", "--batch", "--fuzz=0"],
            input=Path(args.patch).read_bytes(),
            cwd=tmp,
            check=True,
        )
    except FileNotFoundError:
        sys.exit("patch binary not installed")
    patched_server = Path(tmp, "server.py").read_text()
    patched_hooks = Path(tmp, "hooks.py").read_text()

ast.parse(patched_server)
ast.parse(patched_hooks)
assert patched_server.count('**{"agy.supportsFreeform": True}') == 1
assert patched_server.count("agy.supportsFreeform") == 1
assert patched_server.count("agy.freeformResponse") >= 2
perm = patched_server.split("async def _permission_handler", 1)[1]
perm = perm.split("def _agy_question_freeform", 1)[0]
assert "agy.supportsFreeform" not in perm
assert "agy.freeformResponse" not in perm
assert patched_hooks.count("Awaitable[types.QuestionResponse | None]") == 6
assert "selected_option_ids=[selected_id]" not in patched_hooks
assert "isinstance(answer, types.QuestionResponse)" not in patched_hooks
assert "ids = answer.selected_option_ids or []" in patched_hooks


class QuestionResponse:
    def __init__(self, selected_option_ids=None, freeform_response="", skipped=False):
        self.selected_option_ids = selected_option_ids
        self.freeform_response = freeform_response
        self.skipped = skipped


class Allowed:
    def __init__(self, option_id):
        self.option_id = option_id


class Denied:
    pass


class Bag:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class FakeClient:
    def __init__(self, response):
        self.response = response
        self.perms = []
        self.updates = []

    async def session_update(self, **kwargs):
        self.updates.append(kwargs)

    async def request_permission(self, **kwargs):
        self.perms.append(kwargs)
        return self.response


adapter_cls = next(n for n in ast.parse(patched_server).body if isinstance(n, ast.ClassDef) and n.name == "AgyAdapter")
wanted = []
for member in adapter_cls.body:
    if isinstance(member, ast.FunctionDef) and member.name == "_agy_question_freeform":
        wanted.append(member)
    if isinstance(member, ast.AsyncFunctionDef) and member.name == "_ask_user_handler":
        wanted.append(member)
assert [m.name for m in wanted] == ["_agy_question_freeform", "_ask_user_handler"]
chunks = []
for member in wanted:
    src = ast.get_source_segment(patched_server, member)
    chunks.append(textwrap.indent(textwrap.dedent(src), "    "))
g = {
    "schema": types.SimpleNamespace(
        AllowedOutcome=Allowed,
        DeniedOutcome=Denied,
        PermissionOption=lambda **kwargs: kwargs,
        ToolCallStart=lambda **kwargs: Bag(**kwargs),
        ToolCallUpdate=lambda **kwargs: Bag(**kwargs),
        ToolCallProgress=lambda **kwargs: Bag(**kwargs),
    ),
    "sdk_types_module": types.SimpleNamespace(QuestionResponse=QuestionResponse),
    "uuid": types.SimpleNamespace(uuid4=lambda: types.SimpleNamespace(hex="deadbeefdeadbeef")),
    "Sequence": list,
}
exec("class AgyAdapter:\n" + "\n".join(chunks), g)
Adapter = g["AgyAdapter"]


class Meta:
    def __init__(self, field_meta=None, outcome=None):
        self.field_meta = field_meta
        self.outcome = Denied() if outcome is None else outcome


read = Adapter()._agy_question_freeform
assert read(Meta()) is None
assert read(Meta({})) is None
assert read(Meta({"agy": {"freeformResponse": "nested-must-not-count"}})) is None
assert read(Meta({"agy.freeformResponse": "hello"})) == "hello"
assert read(Meta({"agy.freeformResponse": "1"})) == "1"
assert read(Meta({"agy.freeformResponse": ""})) == ""
for bad in (1, True, ["x"], {"x": 1}, None):
    try:
        read(Meta({"agy.freeformResponse": bad}))
        raise AssertionError("malformed freeform must raise")
    except ValueError as err:
        assert "malformed" in str(err)
try:
    read(Meta("nope"))
    raise AssertionError("non-dict meta must raise")
except ValueError as err:
    assert "malformed" in str(err)


async def invoke(response):
    adapter = Adapter()
    client = FakeClient(response)
    adapter._client = client
    option = types.SimpleNamespace(id="1", text="First")
    result = await adapter._ask_user_handler(session_id="s", title="Pick", options=[option])
    return client, result


def go(response):
    return asyncio.run(invoke(response))


client, result = go(Meta({"agy.freeformResponse": "typed other"}))
assert isinstance(result, QuestionResponse)
assert result.freeform_response == "typed other"
assert result.selected_option_ids is None
assert client.perms[0]["agy.supportsFreeform"] is True
assert client.updates[-1]["update"].status == "completed"

client, result = go(Meta({"agy.freeformResponse": "1"}))
assert result.freeform_response == "1"
assert result.selected_option_ids is None

client, result = go(Meta(None, Allowed("2")))
assert result.selected_option_ids == ["2"]
assert result.freeform_response == ""

client, result = go(Meta())
assert result is None
assert client.updates[-1]["update"].status == "failed"

client, result = go(Meta({"agy": {"freeformResponse": "nested"}}))
assert result is None

try:
    go(Meta({"agy.freeformResponse": 9}))
    raise AssertionError("malformed freeform must not become an answer")
except ValueError as err:
    assert "malformed" in str(err)

adapter = Adapter()
adapter._client = None
assert asyncio.run(adapter._ask_user_handler(session_id="s", title="t", options=[])) is None


class Hook:
    def __init__(self, fn):
        self._ask_user_fn = fn

    async def run(self, data):
        responses = []
        for q in data.questions:
            answer = await self._ask_user_fn(q.question, q.options)
            if answer is None:
                return types.SimpleNamespace(responses=responses, cancelled=True)
            responses.append(answer)
        return types.SimpleNamespace(responses=responses, cancelled=False)


questions = types.SimpleNamespace(questions=[types.SimpleNamespace(question="Q", options=[])])
got = asyncio.run(Hook(lambda title, options: asyncio.sleep(0, result=QuestionResponse(selected_option_ids=["2"]))).run(questions))
assert got.cancelled is False and got.responses[0].selected_option_ids == ["2"]
got = asyncio.run(Hook(lambda title, options: asyncio.sleep(0, result=QuestionResponse(freeform_response="not-an-id"))).run(questions))
assert got.responses[0].freeform_response == "not-an-id"
assert got.responses[0].selected_option_ids is None
got = asyncio.run(Hook(lambda title, options: asyncio.sleep(0, result=None)).run(questions))
assert got.cancelled is True and got.responses == []


class MultipleChoiceAnswer:
    def __init__(self):
        self.selected_choice_indices = []
        self.freeform_response = ""


def to_harness(r):
    mc_ans = MultipleChoiceAnswer()
    if r.selected_option_ids:
        indices = []
        for opt_id in r.selected_option_ids:
            try:
                indices.append(int(opt_id) - 1)
            except ValueError:
                pass
        mc_ans.selected_choice_indices[:] = indices
    if r.freeform_response:
        mc_ans.freeform_response = r.freeform_response
    return mc_ans


copied = to_harness(QuestionResponse(freeform_response="typed other"))
assert copied.freeform_response == "typed other"
assert copied.selected_choice_indices == []
copied = to_harness(QuestionResponse(freeform_response="1"))
assert copied.freeform_response == "1" and copied.selected_choice_indices == []
copied = to_harness(QuestionResponse(selected_option_ids=["2"]))
assert copied.selected_choice_indices == [1] and copied.freeform_response == ""
copied = to_harness(QuestionResponse(selected_option_ids=["nope"]))
assert copied.selected_choice_indices == []

TRUST = ("trust", "allow", "allow_once", "allow_always", "yes")
DENY = ("deny", "dont_trust", "dont trust", "don't trust", "don't_trust", "block", "reject", "no")


def trust_status(answer):
    selected = None
    if answer is not None:
        ids = answer.selected_option_ids or []
        if ids:
            selected = ids[0]
    if selected and selected.lower() in TRUST:
        return "trusted"
    if selected and selected.lower() in DENY:
        return "untrusted"
    return "dismissed"


assert "ids = answer.selected_option_ids or []" in patched_hooks
assert trust_status(QuestionResponse(selected_option_ids=["trust"])) == "trusted"
assert trust_status(QuestionResponse(selected_option_ids=["Trust"])) == "trusted"
assert trust_status(QuestionResponse(freeform_response="trust")) == "dismissed"
assert trust_status(QuestionResponse(freeform_response="allow_always")) == "dismissed"
assert trust_status(QuestionResponse(selected_option_ids=["deny"])) == "untrusted"
assert trust_status(None) == "dismissed"

print("agy-user-question patch ok")
