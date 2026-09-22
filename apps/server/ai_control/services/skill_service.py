"""
Skills: Markdown files the user pastes in once and invokes as ``/<name>``.

A skill file looks like::

    ---
    name: review
    description: Review the diff for bugs
    ---
    Review the changes in $ARGUMENTS for correctness...

Front matter is optional. Without a ``name`` there, the first ``# Heading``
(slugified) is used; without a ``description``, the first paragraph. When the
skill is invoked, ``render`` splices its content into the user message the
model sees, so the transcript is self-contained.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Dict, Optional

from django.utils.text import slugify

from ai_control.llm.exceptions import AiControlError
from ai_control.models import SkillModel

#: Placeholder in skill content replaced by what the user typed after the command.
ARGUMENTS_PLACEHOLDER = "$ARGUMENTS"

SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}$")
MAX_CONTENT_CHARS = 100_000
MAX_DESCRIPTION_CHARS = 500

_FRONT_MATTER = re.compile(r"\A\s*---[ \t]*\r?\n(?P<meta>.*?)(?:\r?\n)?---[ \t]*(?:\r?\n|\Z)(?P<body>.*)\Z", re.DOTALL)
_HEADING = re.compile(r"^#{1,6}[ \t]+(?P<title>.+?)[ \t]*#*[ \t]*$", re.MULTILINE)


class SkillError(AiControlError):
    """Bad skill file or unknown skill; ``status_code`` maps to the HTTP reply."""

    status_code = 400


class SkillNotFound(SkillError):
    status_code = 404


@dataclass
class ParsedSkill:
    name: str
    description: str
    content: str


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _parse_front_matter(block: str) -> Dict[str, str]:
    """
    ``key: value`` lines only: enough for the ``name`` / ``description`` pairs
    skill files carry, without pulling in a YAML parser. A folded (``>``) or
    literal (``|``) block scalar collects its indented continuation lines.
    """
    meta: Dict[str, str] = {}
    lines = block.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep or not key.strip() or key[0].isspace():
            continue
        key = key.strip().lower()
        value = value.strip()
        if value in (">", "|", ">-", "|-"):
            collected = []
            while i < len(lines) and (not lines[i].strip() or lines[i][0].isspace()):
                collected.append(lines[i].strip())
                i += 1
            joiner = "\n" if value.startswith("|") else " "
            value = joiner.join(part for part in collected if part).strip()
        meta[key] = _unquote(value)
    return meta


def _first_paragraph(body: str) -> str:
    for block in re.split(r"\n\s*\n", body.strip()):
        text = block.strip()
        if not text or text.startswith("#"):
            continue
        return " ".join(text.split())
    return ""


class SkillService:
    # --------------------------------------------------------------- parsing

    @staticmethod
    def parse(markdown: str, *, name: Optional[str] = None) -> ParsedSkill:
        """
        Split a pasted skill file into its parts. ``name`` (from the request)
        beats the front matter, which beats the first heading.
        """
        text = (markdown or "").replace("\r\n", "\n").strip()
        if not text:
            raise SkillError("The skill file is empty.")

        meta: Dict[str, str] = {}
        body = text
        match = _FRONT_MATTER.match(text)
        if match:
            meta = _parse_front_matter(match.group("meta"))
            body = match.group("body").strip()

        heading = _HEADING.search(body)
        chosen = (name or meta.get("name") or (heading.group("title") if heading else "")).strip()
        chosen = slugify(chosen) if chosen else ""
        if not chosen:
            raise SkillError("Give the skill a name: add 'name:' to the front matter or a '# Heading'.")
        if not SKILL_NAME_PATTERN.match(chosen):
            raise SkillError("Skill names are lowercase letters, digits, '-' and '_', at most 64 characters.")

        description = " ".join((meta.get("description") or _first_paragraph(body)).split())[:MAX_DESCRIPTION_CHARS]

        if not body:
            raise SkillError("The skill has no instructions after the front matter.")
        if len(body) > MAX_CONTENT_CHARS:
            raise SkillError(f"The skill is too long: at most {MAX_CONTENT_CHARS} characters of instructions.")
        return ParsedSkill(name=chosen, description=description, content=body)

    # ----------------------------------------------------------------- crud

    @staticmethod
    def get(user, name: str) -> SkillModel:
        skill = SkillModel.objects.filter(user=user, name=name).first()
        if skill is None:
            raise SkillNotFound(f"No skill named '/{name}'.")
        return skill

    @classmethod
    def install(cls, user, markdown: str, *, name: Optional[str] = None, replace: bool = False) -> SkillModel:
        """
        Create a skill from a pasted file. An existing skill with the same
        name is an error unless ``replace`` is set, in which case it is updated.
        """
        parsed = cls.parse(markdown, name=name)
        existing = SkillModel.objects.filter(user=user, name=parsed.name).first()
        if existing is not None and not replace:
            raise SkillError(f"A skill named '/{parsed.name}' already exists. Remove it first or replace it.")
        if existing is not None:
            existing.description = parsed.description
            existing.content = parsed.content
            existing.updated_by = user
            existing.save(update_fields=["description", "content", "updated_by", "updated_at"])
            return existing
        return SkillModel.objects.create(
            user=user, name=parsed.name, description=parsed.description, content=parsed.content,
            created_by=user, updated_by=user,
        )

    @classmethod
    def update(cls, user, name: str, markdown: str) -> SkillModel:
        """Replace a skill's file; the name in the file may differ (a rename) as long as it stays unique."""
        skill = cls.get(user, name)
        parsed = cls.parse(markdown)
        if parsed.name != skill.name and SkillModel.objects.filter(user=user, name=parsed.name).exists():
            raise SkillError(f"A skill named '/{parsed.name}' already exists.")
        skill.name = parsed.name
        skill.description = parsed.description
        skill.content = parsed.content
        skill.updated_by = user
        skill.save(update_fields=["name", "description", "content", "updated_by", "updated_at"])
        return skill

    @classmethod
    def delete(cls, user, name: str) -> None:
        cls.get(user, name).delete()

    # ------------------------------------------------------------- rendering

    @staticmethod
    def render(skill: SkillModel, arguments: str = "") -> str:
        """
        The user message the model sees when ``/<name> <arguments>`` is sent:
        a short framing line, the instructions, and the arguments (either in
        place of ``$ARGUMENTS`` or appended after the instructions).
        """
        arguments = (arguments or "").strip()
        content = skill.content.strip()
        if ARGUMENTS_PLACEHOLDER in content:
            body = content.replace(ARGUMENTS_PLACEHOLDER, arguments)
            trailing = ""
        else:
            body = content
            trailing = f"\n\n{arguments}" if arguments else ""
        return (
            f"The user invoked the /{skill.name} skill. Follow its instructions for this message.\n\n"
            f"<skill name=\"{skill.name}\">\n{body}\n</skill>"
            f"{trailing}"
        )

    @classmethod
    def expand(cls, user, name: str, arguments: str = "") -> str:
        """``render`` for the user's skill called ``name``; unknown names raise ``SkillNotFound``."""
        return cls.render(cls.get(user, name), arguments)

    @staticmethod
    def to_markdown(skill: SkillModel) -> str:
        """The skill as a file again, for editing or export."""
        description = skill.description.replace('"', '\\"')
        return f"---\nname: {skill.name}\ndescription: \"{description}\"\n---\n{skill.content}\n"
