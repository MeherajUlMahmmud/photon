"""Skills uploaded as zips: unpacking rules, the install API, rendering, and the server-side read_skill_file tool."""
import base64
import io
from unittest import mock
import zipfile

from django.core.cache import cache
from django.core.management import call_command
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from ai_control.models import AgentToolCallModel, SkillFileModel
from ai_control.services import AgentSessionService, SkillError, SkillService
from ai_control.tests.test_agent import STREAM_PATCH, AgentApiTestsBase, _events, _reply
from user_control.models import UserModel

SKILL_MD = """---
name: brand
description: Write in the house style
---
Follow references/voice.md when writing $ARGUMENTS.
"""


def make_zip(files, *, prefix="brand/"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(prefix + name, data)
    return base64.b64encode(buf.getvalue()).decode()


BUNDLE = {
    "SKILL.md": SKILL_MD,
    "references/voice.md": "Short sentences.\nNo jargon.\n",
    "scripts/check.py": "print('ok')\n",
    "assets/logo.png": b"\x89PNG\r\n\x1a\n\x00\x00binary",
    ".DS_Store": b"\x00junk",
}


class ParseArchiveTests(SimpleTestCase):
    def test_takes_skill_folder_and_keeps_text_files(self):
        parsed = SkillService.parse_archive(make_zip(BUNDLE))
        self.assertIn("name: brand", parsed.markdown)
        self.assertEqual([p for p, _ in parsed.files], ["references/voice.md", "scripts/check.py"])
        self.assertEqual(parsed.skipped, ["assets/logo.png (not text)"])

    def test_skill_md_at_zip_root_and_any_case(self):
        parsed = SkillService.parse_archive(make_zip({"skill.MD": SKILL_MD, "notes.txt": "hi"}, prefix=""))
        self.assertEqual(parsed.files, [("notes.txt", "hi")])

    def test_files_outside_the_skill_folder_are_skipped(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("readme.txt", "top level")
            zf.writestr("brand/SKILL.md", SKILL_MD)
        parsed = SkillService.parse_archive(base64.b64encode(buf.getvalue()).decode())
        self.assertEqual(parsed.files, [])
        self.assertEqual(parsed.skipped, ["readme.txt (outside the skill folder)"])

    def test_rejections(self):
        cases = {
            "not base64!": "not valid base64",
            base64.b64encode(b"plain text").decode(): "not a zip",
            make_zip({"README.md": "x"}): "no SKILL.md",
            make_zip({"a/SKILL.md": SKILL_MD, "b/SKILL.md": SKILL_MD}, prefix=""): "more than one skill",
            make_zip({"SKILL.md": SKILL_MD, "../evil.md": "x"}, prefix=""): "unsafe path",
        }
        for archive, message in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(SkillError, message):
                SkillService.parse_archive(archive)

    def test_oversized_file_is_skipped(self):
        big = "x" * (256 * 1024 + 1)
        parsed = SkillService.parse_archive(make_zip({"SKILL.md": SKILL_MD, "big.md": big}))
        self.assertEqual(parsed.skipped, ["big.md (over 256 KB)"])


class ArchiveInstallApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = UserModel.objects.create_user("alice@example.com", "CorrectHorse1")
        self.client.force_authenticate(self.alice)

    def install(self, **body):
        return self.client.post("/api/ai/skill/install/", body, format="json")

    def test_install_from_zip_lists_files_and_skips(self):
        res = self.install(archive=make_zip(BUNDLE))
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()["data"]
        self.assertEqual(data["name"], "brand")
        self.assertEqual([f["path"] for f in data["files"]], ["references/voice.md", "scripts/check.py"])
        self.assertEqual(data["skipped_files"], ["assets/logo.png (not text)"])

        listed = self.client.get("/api/ai/skill/list/").json()["data"][0]
        self.assertEqual(len(listed["files"]), 2)

    def test_replace_swaps_the_bundle(self):
        self.install(archive=make_zip(BUNDLE))
        res = self.install(archive=make_zip({"SKILL.md": SKILL_MD, "new.md": "fresh"}), replace=True)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(list(SkillFileModel.objects.values_list("path", flat=True)), ["new.md"])

    def test_needs_exactly_one_of_markdown_or_archive(self):
        self.assertEqual(self.install().status_code, 400)
        self.assertEqual(self.install(markdown=SKILL_MD, archive=make_zip(BUNDLE)).status_code, 400)

    def test_bad_zip_is_400_with_reason(self):
        res = self.install(archive=make_zip({"README.md": "x"}))
        self.assertEqual(res.status_code, 400)
        self.assertIn("SKILL.md", res.json()["message"])


class ArchiveSkillAgentTests(AgentApiTestsBase):
    def setUp(self):
        super().setUp()
        self.skill, _ = SkillService.install_archive(self.alice, make_zip(BUNDLE))

    def test_render_lists_bundled_files(self):
        text = SkillService.render(self.skill, "the launch post")
        self.assertIn("<skill_files>", text)
        self.assertIn("- references/voice.md (", text)
        self.assertIn('read_skill_file tool (skill="brand"', text)

    def test_read_skill_file_is_offered_only_when_files_exist(self):
        sid = self.create_session()
        session = AgentSessionService.get_for_user(sid, self.alice)
        self.assertIn("read_skill_file", [t.name for t in AgentSessionService.tools_for(session)])

        self.client.force_authenticate(self.bob)
        res = self.client.post("/api/ai/agent/session/create/", {}, format="json")
        bob_session = AgentSessionService.get_for_user(res.json()["data"]["id"], self.bob)
        self.assertNotIn("read_skill_file", [t.name for t in AgentSessionService.tools_for(bob_session)])

    def test_server_answers_read_skill_file_inside_the_step(self):
        sid = self.create_session()
        calls = [
            ("r1", "read_skill_file", {"skill": "/brand", "path": "references/voice.md"}),
            ("r2", "read_skill_file", {"skill": "brand", "path": "missing.md"}),
        ]
        with mock.patch(STREAM_PATCH, new=_reply(calls=calls)):
            res = self.step(sid, {"content": "write the post", "skill": "brand"})
        done = _events(res)[-1]
        self.assertEqual(done["stop_reason"], "tool_use")
        self.assertEqual(done["pending_tool_calls"], [])
        ok, missing = done["resolved_tool_calls"]
        self.assertTrue(ok["ok"])
        self.assertEqual(ok["output"], "1  Short sentences.\n2  No jargon.")
        self.assertFalse(missing["ok"])
        self.assertIn("references/voice.md", missing["error"])
        self.assertEqual(AgentToolCallModel.objects.get(call_id="r1").status, "completed")

        # The desktop posts an empty result list; the model sees the file on its next step.
        with mock.patch(STREAM_PATCH, new=_reply("Done.")) as _:
            res = self.step(sid, {"tool_results": []})
        self.assertEqual(_events(res)[-1]["stop_reason"], "end_turn")
        session = AgentSessionService.get_for_user(sid, self.alice)
        results = [m for m in AgentSessionService.build_messages(session) if m["role"] == "tool_results"][0]
        self.assertIn("No jargon.", results["results"][0]["content"])
