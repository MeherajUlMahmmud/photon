"""
Tools the server answers itself (``LlmToolModel.executor == server``).

Client tools touch the user's machine, so they go to the desktop as pending
calls. Server tools only read data the server already holds, so the step
answers them on the spot: the call is stored completed (or failed), reported
in ``done.resolved_tool_calls``, and the model sees the result on its next
step like any other tool result.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict

from ai_control.models import SkillFileModel
from ai_control.services.skill_service import SkillError, SkillService


@dataclass
class ServerToolResult:
    ok: bool
    output: str = ""
    error: str = ""


def _number_lines(text: str, offset: int, limit: int) -> str:
    lines = text.splitlines()
    start = max(1, offset)
    chosen = lines[start - 1 : start - 1 + limit] if limit > 0 else lines[start - 1 :]
    width = len(str(start + len(chosen)))
    return "\n".join(f"{str(n).rjust(width)}  {line}" for n, line in enumerate(chosen, start))


def _read_skill_file(user, args: Dict[str, Any]) -> ServerToolResult:
    skill = str(args.get("skill") or "").strip()
    path = str(args.get("path") or "").strip()
    if not skill or not path:
        return ServerToolResult(ok=False, error="Pass both 'skill' (the skill name) and 'path' (a file it lists).")
    try:
        found = SkillService.read_file(user, skill, path)
    except SkillError as e:
        return ServerToolResult(ok=False, error=str(e))
    offset = int(args.get("offset") or 1)
    limit = int(args.get("limit") or 0)
    return ServerToolResult(ok=True, output=_number_lines(found.content, offset, limit))


#: name -> (handler, availability check). A tool whose check fails is not offered to the model at all.
_TOOLS: Dict[str, tuple[Callable[[Any, Dict[str, Any]], ServerToolResult], Callable[[Any], bool]]] = {
    "read_skill_file": (
        _read_skill_file,
        lambda user: SkillFileModel.objects.filter(skill__user=user).exists(),
    ),
}


class ServerToolService:
    @staticmethod
    def available(name: str, user) -> bool:
        entry = _TOOLS.get(name)
        return bool(entry and entry[1](user))

    @staticmethod
    def run(name: str, user, args: Dict[str, Any]) -> ServerToolResult:
        entry = _TOOLS.get(name)
        if entry is None:
            return ServerToolResult(ok=False, error=f"'{name}' is not a server tool.")
        try:
            return entry[0](user, args or {})
        except (TypeError, ValueError) as e:
            return ServerToolResult(ok=False, error=f"Bad arguments: {e}")
