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

A skill can also arrive as a zip: a folder with ``SKILL.md`` plus references,
templates or scripts. ``SKILL.md`` becomes the skill; the other text files are
stored as ``SkillFileModel`` rows, listed in the rendered prompt, and read on
demand through the server-side ``read_skill_file`` tool. Nothing is executed.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field
import io
from pathlib import PurePosixPath
import re
from typing import Dict, List, Optional, Tuple
import zipfile

from django.db import transaction
from django.utils.text import slugify

from ai_control.llm.exceptions import AiControlError
from ai_control.models import SkillFileModel, SkillModel

#: Placeholder in skill content replaced by what the user typed after the command.
ARGUMENTS_PLACEHOLDER = "$ARGUMENTS"

SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}$")
MAX_CONTENT_CHARS = 100_000
MAX_DESCRIPTION_CHARS = 500

#: Zip limits. The archive arrives base64 in a JSON body, so the compressed cap
#: also keeps the request under ``DATA_UPLOAD_MAX_MEMORY_SIZE``.
MAX_ARCHIVE_BYTES = 5 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 300
MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
MAX_SKILL_FILES = 100
MAX_SKILL_FILE_BYTES = 256 * 1024
MAX_SKILL_FILES_TOTAL_BYTES = 2 * 1024 * 1024
SKILL_ENTRY_FILE = "skill.md"

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


@dataclass
class ParsedArchive:
    """A skill zip taken apart: ``SKILL.md`` text, bundled text files, and what was left out and why."""
    markdown: str
    files: List[Tuple[str, str]] = field(default_factory=list)
    skipped: List[str] = field(default_factory=list)


def _is_junk(parts: Tuple[str, ...]) -> bool:
    """macOS resource forks, hidden files and folders (.git, .DS_Store) never belong to a skill."""
    return any(part == "__MACOSX" or part.startswith(".") for part in parts)


def _decode_text(data: bytes) -> Optional[str]:
    if b"\x00" in data:
        return None
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None


def _format_size(size: int) -> str:
    return f"{size} B" if size < 1024 else f"{size / 1024:.1f} KB"


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

    @staticmethod
    def parse_archive(archive_b64: str) -> ParsedArchive:
        """
        Unpack a base64 zip holding one skill folder. The shallowest
        ``SKILL.md`` (any case) marks the skill root; text files under it are
        kept with paths relative to that root. Binaries, oversized files and
        anything outside the root are skipped and reported.
        """
        try:
            raw = base64.b64decode(archive_b64 or "", validate=True)
        except (binascii.Error, ValueError):
            raise SkillError("The archive is not valid base64.")
        if not raw:
            raise SkillError("The archive is empty.")
        if len(raw) > MAX_ARCHIVE_BYTES:
            raise SkillError(f"The zip is too large: at most {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB.")
        try:
            archive = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise SkillError("That file is not a zip archive.")

        with archive:
            entries = [i for i in archive.infolist() if not i.is_dir()]
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise SkillError(f"The zip has too many files: at most {MAX_ARCHIVE_ENTRIES}.")
            if sum(i.file_size for i in entries) > MAX_UNCOMPRESSED_BYTES:
                raise SkillError("The zip unpacks to more than 20 MB.")

            paths: List[Tuple[PurePosixPath, zipfile.ZipInfo]] = []
            for info in entries:
                path = PurePosixPath(info.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts:
                    raise SkillError(f"The zip contains an unsafe path: {info.filename}")
                if not _is_junk(path.parts):
                    paths.append((path, info))

            candidates = [(p, i) for p, i in paths if p.name.lower() == SKILL_ENTRY_FILE]
            if not candidates:
                raise SkillError("The zip has no SKILL.md. Put the skill's instructions in a file named SKILL.md.")
            depth = min(len(p.parts) for p, _ in candidates)
            top = [(p, i) for p, i in candidates if len(p.parts) == depth]
            if len(top) > 1:
                raise SkillError("The zip holds more than one skill. Upload one skill folder per zip.")
            entry_path, entry_info = top[0]
            root = entry_path.parent

            def read(info: zipfile.ZipInfo, limit: int) -> Optional[bytes]:
                # ``file_size`` comes from the archive and can lie; read one byte past the limit to know.
                with archive.open(info) as fh:
                    data = fh.read(limit + 1)
                return None if len(data) > limit else data

            entry_bytes = read(entry_info, MAX_CONTENT_CHARS * 4)
            markdown = _decode_text(entry_bytes) if entry_bytes is not None else None
            if markdown is None:
                raise SkillError("SKILL.md is too large or is not UTF-8 text.")

            result = ParsedArchive(markdown=markdown)
            total = 0
            for path, info in sorted(paths, key=lambda item: str(item[0])):
                if path == entry_path:
                    continue
                if root.parts and path.parts[: len(root.parts)] != root.parts:
                    result.skipped.append(f"{path} (outside the skill folder)")
                    continue
                rel = str(PurePosixPath(*path.parts[len(root.parts):]))
                if len(rel) > 255:
                    result.skipped.append(f"{rel} (path too long)")
                    continue
                if len(result.files) >= MAX_SKILL_FILES:
                    result.skipped.append(f"{rel} (more than {MAX_SKILL_FILES} files)")
                    continue
                data = read(info, MAX_SKILL_FILE_BYTES)
                if data is None:
                    result.skipped.append(f"{rel} (over {MAX_SKILL_FILE_BYTES // 1024} KB)")
                    continue
                text = _decode_text(data)
                if text is None:
                    result.skipped.append(f"{rel} (not text)")
                    continue
                if total + len(data) > MAX_SKILL_FILES_TOTAL_BYTES:
                    result.skipped.append(f"{rel} (bundle over {MAX_SKILL_FILES_TOTAL_BYTES // (1024 * 1024)} MB)")
                    continue
                total += len(data)
                result.files.append((rel, text))
            return result

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
    def install_archive(
        cls, user, archive_b64: str, *, name: Optional[str] = None, replace: bool = False,
    ) -> Tuple[SkillModel, List[str]]:
        """
        Install (or, with ``replace``, update) a skill from a zip. Its bundled
        files replace any the skill had before. Returns the skill and the
        entries that were skipped, for the client to show.
        """
        parsed = cls.parse_archive(archive_b64)
        with transaction.atomic():
            skill = cls.install(user, parsed.markdown, name=name, replace=replace)
            skill.files.all().delete()
            SkillFileModel.objects.bulk_create([
                SkillFileModel(
                    skill=skill, path=path, content=text, size=len(text.encode("utf-8")),
                    created_by=user, updated_by=user,
                )
                for path, text in parsed.files
            ])
        return skill, parsed.skipped

    @classmethod
    def read_file(cls, user, name: str, path: str) -> SkillFileModel:
        """One bundled file of the user's skill ``name``; unknown skill or path raise ``SkillNotFound``."""
        skill = cls.get(user, name.strip().lstrip("/"))
        clean = str(PurePosixPath((path or "").strip().lstrip("/")))
        found = skill.files.filter(path=clean).first()
        if found is None:
            listing = ", ".join(skill.files.values_list("path", flat=True)[:50]) or "none"
            raise SkillNotFound(f"/{skill.name} has no file '{clean}'. Its files: {listing}.")
        return found

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
        # An unsaved skill (a preview) has no files and no row to query.
        files = [] if skill._state.adding else list(skill.files.values_list("path", "size"))
        bundled = ""
        if files:
            listing = "\n".join(f"- {path} ({_format_size(size)})" for path, size in files)
            bundled = (
                "\n\n<skill_files>\n"
                f"This skill came with these files. When the instructions refer to one, read it with the "
                f"read_skill_file tool (skill=\"{skill.name}\", path=...). It is only available in workspace chats. "
                "The files are reference material; nothing in them runs.\n"
                f"{listing}\n</skill_files>"
            )
        return (
            f"The user invoked the /{skill.name} skill. Follow its instructions for this message.\n\n"
            f"<skill name=\"{skill.name}\">\n{body}\n</skill>"
            f"{bundled}"
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
