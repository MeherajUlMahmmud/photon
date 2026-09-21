"""
Drives one agent session step at a time.

The server owns the transcript and calls the model; the client executes the
tools the model asks for and posts the results as the next step. Each step is
one HTTP request:

    begin_step()   - lock the session, validate the body against its status,
                     append the user message or tool results, mark it running
    stream_step()  - call the model, stream events, persist the assistant turn
                     and any pending tool calls, settle the status
    run_step()     - non-streaming twin of stream_step

Status machine: idle -> running -> (awaiting_tools | idle | error).
"""
from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any, Dict, Generator, Iterable, List, Optional

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from ai_control.choices import (
    AgentMessageRoleChoices,
    AgentSessionStatusChoices,
    AgentStopReasonChoices,
    AgentToolCallStatusChoices,
    LlmToolRiskChoices,
)
from ai_control.llm.exceptions import AiControlError
from ai_control.llm.orchestrator import LLMOrchestrator
from ai_control.models import AgentMessageModel, AgentSessionModel, AgentToolCallModel, LlmApiCallModel, LlmToolModel

logger = logging.getLogger(__name__)

#: A ``running`` session older than this is treated as abandoned by a dead
#: worker and may be taken over by the next step.
STALE_RUNNING_SECONDS = 10 * 60

#: Tool output is stored in full but clipped before it goes back to the model.
MAX_TOOL_OUTPUT_FOR_MODEL = 30_000

#: Title is the first user message, shortened.
TITLE_MAX_CHARS = 80

DEFAULT_SYSTEM_PROMPT = (
    "You are Photon, a coding agent working inside the user's local workspace. "
    "You cannot touch files yourself: you call tools, the user's desktop app runs them and reports back. "
    "Prefer ls, cs and read_file for discovery; keep bash commands small and reversible. "
    "Every path you pass to a tool is relative to the workspace root. "
    "When the task is done, answer in plain text without calling more tools."
)

#: Per-OS guidance appended to the system prompt. Keys are Node's ``process.platform``
#: values, which is what the desktop reports.
OS_LABELS = {"darwin": "macOS", "linux": "Linux", "win32": "Windows"}
OS_GUIDANCE = {
    "darwin": (
        "Paths use '/'. The userland is BSD, not GNU: sed -i needs an explicit backup suffix (sed -i ''), "
        "grep/find/date lack GNU-only flags, and readlink -f may be missing. "
        "Homebrew is the usual package manager and 'open' opens files or URLs. "
        "Avoid commands that trigger permission prompts (Contacts, Photos, Full Disk Access)."
    ),
    "linux": (
        "Paths use '/'. The userland is GNU. Package managers vary by distro (apt, dnf, pacman) so check before installing; "
        "'xdg-open' opens files or URLs. Never assume sudo is available."
    ),
    "win32": (
        "Paths use '\\' and drive letters, though forward slashes work in most tools. "
        "Unix commands (ls, grep, sed, rm -rf) do not exist unless the reported shell is bash: "
        "use PowerShell cmdlets (Get-ChildItem, Select-String, Remove-Item) or their cmd equivalents, "
        "quote paths containing spaces, and expect CRLF line endings and case-insensitive filenames. "
        "'start' opens files or URLs."
    ),
}


class AgentSessionError(AiControlError):
    """Base for step-protocol violations. ``status_code`` maps to the HTTP reply."""

    status_code = 400


class AgentSessionNotFound(AgentSessionError):
    status_code = 404


class AgentSessionBusy(AgentSessionError):
    status_code = 409


class AgentStepRejected(AgentSessionError):
    status_code = 400


@dataclass
class ToolResultInput:
    call_id: str
    ok: bool
    output: str = ""
    error: str = ""


class AgentSessionService:
    # ------------------------------------------------------------- creation

    @classmethod
    def create_session(
        cls, user, *, workspace=None, provider: str = "", model: str = "", task_key: str = "agent",
        device: Optional[Dict[str, Any]] = None, workspace_path: str = "",
    ) -> AgentSessionModel:
        device = dict(device or {})
        workspace_path = (workspace_path or "").strip()
        session = AgentSessionModel.objects.create(
            user=user,
            created_by=user,
            workspace=workspace,
            provider=(provider or "").strip().lower(),
            model=(model or "").strip(),
            task_key=task_key or "agent",
            device=device,
            workspace_path=workspace_path,
            system_prompt=cls.build_system_prompt(workspace, device, workspace_path),
        )
        logger.info(
            '[AgentSessionService] Session created - user_id=%s, session_id=%s, workspace_id=%s, os=%s',
            user.id, session.id, getattr(workspace, 'id', None), device.get("os") or "unknown",
        )
        return session

    @staticmethod
    def update_model(session: AgentSessionModel, *, provider: str, model: str) -> AgentSessionModel:
        """Re-pin the session to another provider/model; the transcript carries over untouched."""
        session.provider = (provider or "").strip().lower()
        session.model = (model or "").strip()
        session.save(update_fields=["provider", "model", "updated_at"])
        return session

    @classmethod
    def build_system_prompt(cls, workspace=None, device: Optional[Dict[str, Any]] = None, workspace_path: str = "") -> str:
        prompt = DEFAULT_SYSTEM_PROMPT
        # The desktop reports the folder it is actually in; the workspace row's
        # root is the fallback for sessions created without it.
        root = workspace_path or (workspace.root_path if workspace is not None else "")
        if workspace is not None:
            prompt += f"\n\nWorkspace: {workspace.name} (root: {root})."
        elif root:
            prompt += f"\n\nWorkspace root: {root}."
        environment = cls.describe_device(device)
        if environment:
            prompt += f"\n\n{environment}"
        return prompt

    @staticmethod
    def describe_device(device: Optional[Dict[str, Any]]) -> str:
        """
        The environment paragraph of the system prompt, or "" when the client
        reported nothing. Only known ``os`` values get OS-specific guidance;
        anything else is described verbatim so the model can still adapt.
        """
        if not device:
            return ""
        os_key = str(device.get("os") or "").strip().lower()
        if not os_key:
            return ""
        label = OS_LABELS.get(os_key, os_key)
        version = str(device.get("os_version") or "").strip()
        arch = str(device.get("arch") or "").strip()
        shell = str(device.get("shell") or "").strip()
        locale = str(device.get("locale") or "").strip()

        head = label + (f" {version}" if version else "") + (f" ({arch})" if arch else "")
        lines = [f"Environment: the user's machine runs {head}."]
        if shell:
            lines.append(f"Shell commands run in {shell}; write them in that shell's syntax.")
        if locale:
            lines.append(f"The user's locale is {locale}.")
        guidance = OS_GUIDANCE.get(os_key)
        if guidance:
            lines.append(guidance)
        lines.append("Tailor commands, paths, keyboard shortcuts and install instructions to this OS and shell.")
        return " ".join(lines)

    @staticmethod
    def get_for_user(session_id, user) -> AgentSessionModel:
        session = AgentSessionModel.objects.filter(id=session_id, user=user, is_deleted=False).first()
        if session is None:
            raise AgentSessionNotFound("Agent session not found")
        return session

    # ---------------------------------------------------------------- tools

    @staticmethod
    def tools_for(session: AgentSessionModel) -> List[LlmToolModel]:
        rows = LlmToolModel.objects.filter(is_active=True, is_deleted=False).order_by("priority", "name")
        return [t for t in rows if t.offered_for(session.task_key)]

    # ------------------------------------------------------------ transcript

    @classmethod
    def build_messages(cls, session: AgentSessionModel) -> List[Dict[str, Any]]:
        """Provider-neutral transcript: system prompt, then turns with grouped tool results."""
        messages: List[Dict[str, Any]] = []
        if session.system_prompt:
            messages.append({"role": "system", "content": session.system_prompt})
        rows = list(session.messages.filter(is_deleted=False).order_by("seq").prefetch_related("tool_calls"))
        for msg in rows:
            if msg.role == AgentMessageRoleChoices.USER:
                messages.append({"role": "user", "content": msg.content})
                continue
            calls = sorted(msg.tool_calls.all(), key=lambda c: c.seq_in_message)
            entry: Dict[str, Any] = {"role": "assistant", "content": msg.content}
            if calls:
                entry["tool_calls"] = [{"id": c.call_id, "name": c.name, "input": c.input} for c in calls]
            messages.append(entry)
            settled = [c for c in calls if c.status != AgentToolCallStatusChoices.PENDING]
            if settled:
                messages.append({
                    "role": "tool_results",
                    "results": [
                        {
                            "call_id": c.call_id,
                            "name": c.name,
                            "content": cls._clip_output(c.result_content()),
                            "is_error": c.is_error,
                        }
                        for c in settled
                    ],
                })
        return messages

    @staticmethod
    def _clip_output(text: str) -> str:
        if len(text) <= MAX_TOOL_OUTPUT_FOR_MODEL:
            return text
        return text[:MAX_TOOL_OUTPUT_FOR_MODEL] + f"\n…[truncated {len(text) - MAX_TOOL_OUTPUT_FOR_MODEL} chars]"

    @staticmethod
    def _next_seq(session: AgentSessionModel) -> int:
        current = session.messages.aggregate(m=Max("seq"))["m"]
        return 0 if current is None else current + 1

    # ------------------------------------------------------------ begin step

    @classmethod
    def begin_step(
        cls,
        session_id,
        user,
        *,
        content: Optional[str] = None,
        tool_results: Optional[Iterable[ToolResultInput]] = None,
    ) -> AgentSessionModel:
        """
        Validate and apply the step body, then mark the session ``running``.
        Runs in one short transaction so concurrent steps serialise on the row.
        """
        if (content is None) == (tool_results is None):
            raise AgentStepRejected("Send exactly one of 'content' or 'tool_results'.")

        with transaction.atomic():
            session = (
                AgentSessionModel.objects.select_for_update()
                .filter(id=session_id, user=user, is_deleted=False)
                .first()
            )
            if session is None:
                raise AgentSessionNotFound("Agent session not found")

            if session.status == AgentSessionStatusChoices.RUNNING:
                if not cls._is_stale(session):
                    raise AgentSessionBusy("A step is already running for this session.")
                logger.warning('[AgentSessionService] Reclaiming stale running session - session_id=%s', session.id)
                cls._settle_partial(session, error="Previous step was abandoned")

            if content is not None:
                if session.status == AgentSessionStatusChoices.AWAITING_TOOLS:
                    # The user moved on; the pending calls get a result anyway so
                    # the transcript stays valid for the provider.
                    cls._cancel_pending(session, reason="Cancelled: the user sent a new message before the tool ran")
                cls._append_user(session, content)
            else:
                if session.status != AgentSessionStatusChoices.AWAITING_TOOLS:
                    raise AgentStepRejected("This session is not waiting for tool results.")
                cls._apply_tool_results(session, list(tool_results or []))

            session.status = AgentSessionStatusChoices.RUNNING
            session.running_since = timezone.now()
            session.last_error = ""
            session.updated_by = user
            session.save(update_fields=["status", "running_since", "last_error", "updated_by", "updated_at"])
        return session

    @staticmethod
    def _is_stale(session: AgentSessionModel) -> bool:
        if session.running_since is None:
            return True
        return (timezone.now() - session.running_since).total_seconds() > STALE_RUNNING_SECONDS

    @classmethod
    def _append_user(cls, session: AgentSessionModel, content: str) -> AgentMessageModel:
        msg = AgentMessageModel.objects.create(
            session=session, seq=cls._next_seq(session), role=AgentMessageRoleChoices.USER,
            content=content, created_by=session.user,
        )
        if not session.title:
            session.title = content.strip().splitlines()[0][:TITLE_MAX_CHARS] if content.strip() else ""
            session.save(update_fields=["title"])
        return msg

    @staticmethod
    def _cancel_pending(session: AgentSessionModel, *, reason: str) -> int:
        return session.tool_calls.filter(status=AgentToolCallStatusChoices.PENDING).update(
            status=AgentToolCallStatusChoices.CANCELLED, error=reason, updated_at=timezone.now(),
        )

    @staticmethod
    def _apply_tool_results(session: AgentSessionModel, results: List[ToolResultInput]) -> None:
        pending = {c.call_id: c for c in session.tool_calls.filter(status=AgentToolCallStatusChoices.PENDING)}
        seen: set = set()
        for r in results:
            if r.call_id in seen:
                raise AgentStepRejected(f"Duplicate tool result for call '{r.call_id}'.")
            seen.add(r.call_id)
            if r.call_id not in pending:
                raise AgentStepRejected(f"No pending tool call with id '{r.call_id}'.")
        missing = set(pending) - seen
        if missing:
            raise AgentStepRejected("Missing tool results for: " + ", ".join(sorted(missing)) + ".")

        now = timezone.now()
        for r in results:
            call = pending[r.call_id]
            if r.ok:
                call.status = AgentToolCallStatusChoices.COMPLETED
                call.output = r.output or ""
                call.error = ""
            else:
                error = (r.error or "").strip()
                denied = error.lower() == "denied"
                call.status = AgentToolCallStatusChoices.DENIED if denied else AgentToolCallStatusChoices.FAILED
                call.output = r.output or ""
                call.error = "The user denied this tool call" if denied else (error or "Tool failed")
            call.duration_ms = int((now - call.created_at).total_seconds() * 1000)
            call.save(update_fields=["status", "output", "error", "duration_ms", "updated_at"])

    # ----------------------------------------------------------- run / stream

    @classmethod
    def stream_step(cls, session: AgentSessionModel) -> Generator[Dict[str, Any], None, None]:
        """
        Call the model and re-yield orchestrator events. The ``done`` event is
        enriched with ``pending_tool_calls``; the assistant turn and its calls
        are persisted before it is emitted.
        """
        if session.step_count >= session.max_steps:
            cls._finish(session, status=AgentSessionStatusChoices.IDLE)
            yield {
                "type": "done", "stop_reason": AgentStopReasonChoices.MAX_STEPS.value, "raw_stop_reason": None,
                "call_id": None, "usage": {}, "pending_tool_calls": [], "step_count": session.step_count,
            }
            return

        tools = cls.tools_for(session)
        parts: List[str] = []
        settled = False
        try:
            events = LLMOrchestrator.stream_completion(
                user=session.user,
                messages=cls.build_messages(session),
                task_key=session.task_key,
                provider=session.provider or None,
                model=session.model or None,
                tools=[t.schema_for_model() for t in tools],
                trace_id=str(session.id),
            )
            for event in events:
                kind = event.get("type")
                if kind == "delta":
                    parts.append(event.get("text") or "")
                    yield event
                elif kind == "done":
                    settled = True
                    yield cls._persist_assistant(session, tools, event, text="".join(parts))
                elif kind == "error":
                    settled = True
                    cls._finish(session, status=AgentSessionStatusChoices.ERROR, error=event.get("message") or "")
                    yield event
                else:
                    yield event
        except Exception as e:  # noqa: BLE001 - surfaced as an event, never a broken stream
            logger.exception('[AgentSessionService] Step failed - session_id=%s', session.id)
            settled = True
            cls._finish(session, status=AgentSessionStatusChoices.ERROR, error=str(e))
            yield {"type": "error", "message": "The agent step failed unexpectedly."}
        finally:
            if not settled:
                # Client went away mid-stream (GeneratorExit) or the provider
                # stream ended without done/error: keep what was said.
                cls._settle_partial(session, text="".join(parts), error="Stream ended before the model finished")

    @classmethod
    def run_step(cls, session: AgentSessionModel) -> Dict[str, Any]:
        """Non-streaming twin: returns the final ``done`` (or ``error``) event."""
        final: Dict[str, Any] = {"type": "error", "message": "No response"}
        for event in cls.stream_step(session):
            if event.get("type") in ("done", "error"):
                final = event
        return final

    @classmethod
    def cancel(cls, session: AgentSessionModel) -> AgentSessionModel:
        cancelled = cls._cancel_pending(session, reason="Cancelled by the user")
        session.status = AgentSessionStatusChoices.IDLE
        session.running_since = None
        session.save(update_fields=["status", "running_since", "updated_at"])
        logger.info('[AgentSessionService] Session cancelled - session_id=%s, pending_cancelled=%s', session.id, cancelled)
        return session

    # ------------------------------------------------------------ persistence

    @classmethod
    def _persist_assistant(
        cls, session: AgentSessionModel, tools: List[LlmToolModel], done: Dict[str, Any], *, text: str,
    ) -> Dict[str, Any]:
        by_name = {t.name: t for t in tools}
        raw_calls = done.get("tool_calls") or []
        llm_call = LlmApiCallModel.objects.filter(id=done.get("call_id")).first() if done.get("call_id") else None
        stop_reason = done.get("stop_reason") or AgentStopReasonChoices.END_TURN.value

        with transaction.atomic():
            msg = AgentMessageModel.objects.create(
                session=session,
                seq=cls._next_seq(session),
                role=AgentMessageRoleChoices.ASSISTANT,
                content=text,
                stop_reason=stop_reason,
                llm_call=llm_call,
                created_by=session.user,
            )
            pending: List[Dict[str, Any]] = []
            for idx, call in enumerate(raw_calls):
                tool = by_name.get(call.get("name") or "")
                risk = tool.risk if tool else LlmToolRiskChoices.DESTRUCTIVE
                row = AgentToolCallModel(
                    session=session, message=msg, tool=tool,
                    call_id=str(call.get("id") or f"call_{msg.seq}_{idx}"),
                    name=str(call.get("name") or ""),
                    input=call.get("input") or {},
                    risk=risk, seq_in_message=idx, created_by=session.user,
                )
                if tool is None:
                    # Unknown tool: answer it ourselves so the model can recover.
                    row.status = AgentToolCallStatusChoices.FAILED
                    row.error = f"Unknown tool '{row.name}'. Available: {', '.join(sorted(by_name))}."
                row.save()
                if row.status == AgentToolCallStatusChoices.PENDING:
                    pending.append(cls._pending_payload(row))

            session.step_count += 1
            if pending:
                session.status = AgentSessionStatusChoices.AWAITING_TOOLS
                stop_reason = AgentStopReasonChoices.TOOL_USE.value
            elif raw_calls:
                # Every call was unknown: keep the session idle but tell the
                # client the model tried tools, so it can immediately continue.
                session.status = AgentSessionStatusChoices.IDLE
                stop_reason = AgentStopReasonChoices.END_TURN.value
            else:
                session.status = AgentSessionStatusChoices.IDLE
            session.running_since = None
            session.save(update_fields=["step_count", "status", "running_since", "updated_at"])
            if msg.stop_reason != stop_reason:
                msg.stop_reason = stop_reason
                msg.save(update_fields=["stop_reason"])

        return {
            **done,
            "stop_reason": stop_reason,
            "message_id": str(msg.id),
            "pending_tool_calls": pending,
            "step_count": session.step_count,
        }

    @staticmethod
    def _pending_payload(row: AgentToolCallModel) -> Dict[str, Any]:
        return {"call_id": row.call_id, "name": row.name, "input": row.input, "risk": row.risk}

    @classmethod
    def _settle_partial(cls, session: AgentSessionModel, *, text: str = "", error: str = "") -> None:
        if text:
            AgentMessageModel.objects.create(
                session=session, seq=cls._next_seq(session), role=AgentMessageRoleChoices.ASSISTANT,
                content=text, is_partial=True, created_by=session.user,
            )
        cls._finish(session, status=AgentSessionStatusChoices.IDLE, error=error)

    @staticmethod
    def _finish(session: AgentSessionModel, *, status: str, error: str = "") -> None:
        session.status = status
        session.running_since = None
        session.last_error = error or ""
        session.save(update_fields=["status", "running_since", "last_error", "updated_at"])
