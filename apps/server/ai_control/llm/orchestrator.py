from __future__ import annotations

from dataclasses import dataclass, field
import logging
from typing import Any, Dict, Generator, List, Optional

from ai_control.llm.exceptions import AiUnavailableError
from ai_control.llm.providers import (
    AbstractLLMProvider,
    AnthropicLLMProvider,
    CompletionResult,
    OpenAICompatibleLLMProvider,
    ProviderConfig,
)
from ai_control.llm.recorder import LlmCallRecorder
from ai_control.models import LlmProviderModel
from user_control.services import SecretService

logger = logging.getLogger(__name__)

#: Safe to show directly to end users when no LLM answered.
AI_UNAVAILABLE_USER_MESSAGE = (
    "No AI provider is available. Add an API key in Settings, or try again in a few minutes."
)

_ERROR_DETAIL_LIMIT = 240


def _short_error(error: Exception) -> str:
    """
    One line describing a provider failure, safe to show to the user.

    OpenAI-style errors carry the vendor's JSON body; its ``detail``/``message``
    is far more useful than the ``Error code: 410 - {...}`` repr.
    """
    body = getattr(error, "body", None)
    if isinstance(body, dict):
        inner = body.get("error")
        if isinstance(inner, dict):
            body = inner
        for key in ("detail", "message"):
            text = body.get(key)
            if isinstance(text, str) and text.strip():
                return text.strip()[:_ERROR_DETAIL_LIMIT]
    text = str(error).strip() or error.__class__.__name__
    return text[:_ERROR_DETAIL_LIMIT]


@dataclass
class CompletionOutcome:
    content: str
    provider: str
    model: str
    call_id: str
    usage: Dict[str, int]


@dataclass
class _Request:
    """Everything shared across the provider attempts of one completion."""

    user: Any
    messages: List[Dict[str, Any]]
    task_key: str
    preferred: str
    model: Optional[str]
    llm_config: Optional[Dict[str, Any]]
    trace_id: Optional[str]
    candidates: List[LlmProviderModel]
    prompt_text: str
    streamed: bool
    skipped_no_key: List[str] = field(default_factory=list)
    failures: List[str] = field(default_factory=list)

    @property
    def candidate_names(self) -> List[str]:
        return [c.provider for c in self.candidates]


@dataclass
class _Attempt:
    """One provider row resolved to a client, key and model, ready to call."""

    row: LlmProviderModel
    client: AbstractLLMProvider
    config: ProviderConfig
    metadata: Dict[str, Any]
    rec: LlmCallRecorder

    @property
    def provider(self) -> str:
        return self.row.provider

    @property
    def model(self) -> str:
        return self.config.model


class LLMOrchestrator:
    """
    Picks a provider for a user, runs the completion, records the call.

    Candidates are active ``LlmProviderModel`` rows in priority order, reduced
    to the ones the user has stored an API key for. A pinned ``provider`` is
    tried first but the rest still act as fallbacks unless ``strict`` is set.

    Both entry points walk the same steps:

    1. ``_init_request`` - normalise the arguments, pick candidate rows
    2. ``_attempts``     - per row: resolve client + key + model, or skip it
    3. call the provider (``complete`` / ``complete_stream``)
    4. ``_record_success`` / ``_record_failure`` - persist the call
    5. ``_exhausted``    - build the user-facing error when nothing answered
    """

    _registry: dict[str, AbstractLLMProvider] = {}
    _initialized = False

    # ------------------------------------------------------------------ registry

    @classmethod
    def register_client(cls, client: AbstractLLMProvider) -> None:
        cls._registry[str(client.api_style)] = client

    @classmethod
    def client_for(cls, api_style: str) -> Optional[AbstractLLMProvider]:
        """The registered client for a wire protocol, if any."""
        cls._ensure_defaults()
        return cls._registry.get(api_style)

    @classmethod
    def _ensure_defaults(cls) -> None:
        if cls._initialized:
            return
        cls.register_client(AnthropicLLMProvider())
        cls.register_client(OpenAICompatibleLLMProvider())
        cls._initialized = True

    # ------------------------------------------------------------ step 1: init

    @staticmethod
    def _messages_text(messages: List[Dict[str, Any]]) -> str:
        return "\n".join(
            str(msg.get("content", ""))
            for msg in messages
            if isinstance(msg, dict) and msg.get("role") in {"system", "user"}
        ).strip()

    @classmethod
    def candidate_providers(cls, user, *, preferred_provider: str = "", strict: bool = False) -> List[LlmProviderModel]:
        rows = list(LlmProviderModel.objects.filter(is_active=True, is_deleted=False).order_by("priority", "created_at"))
        if preferred_provider:
            if strict:
                rows = [r for r in rows if r.provider == preferred_provider]
            else:
                rows = [r for r in rows if r.provider == preferred_provider] + [
                    r for r in rows if r.provider != preferred_provider
                ]
        return rows

    @classmethod
    def _init_request(
        cls,
        *,
        user,
        messages: List[Dict[str, Any]],
        task_key: str,
        provider: Optional[str],
        model: Optional[str],
        llm_config: Optional[Dict[str, Any]],
        trace_id: Optional[str],
        streamed: bool,
    ) -> _Request:
        cls._ensure_defaults()
        preferred = (provider or "").strip().lower()
        # A caller that names a model has a specific provider in mind; don't
        # send that model id to a different vendor.
        strict = bool(preferred and model)
        return _Request(
            user=user,
            messages=messages,
            task_key=task_key,
            preferred=preferred,
            model=model,
            llm_config=llm_config,
            trace_id=trace_id,
            candidates=cls.candidate_providers(user, preferred_provider=preferred, strict=strict),
            prompt_text=cls._messages_text(messages),
            streamed=streamed,
        )

    # -------------------------------------------------------- step 2: attempts

    @classmethod
    def _attempts(cls, req: _Request) -> Generator[_Attempt, None, None]:
        """Yield one ready-to-call attempt per usable candidate row, in order."""
        candidate_names = req.candidate_names
        for idx, row in enumerate(req.candidates):
            client = cls._registry.get(str(row.api_style))
            if client is None:
                logger.warning("[LLMOrchestrator] Provider %s has unknown api_style %s; skipping", row.provider, row.api_style)
                continue
            api_key = SecretService.get_api_key(req.user, row.provider)
            if not api_key:
                req.skipped_no_key.append(row.provider)
                continue

            chosen_model = req.model if (req.model and row.provider == req.preferred) else row.default_model
            metadata = {
                "task_key": req.task_key,
                "selected_provider": req.preferred or None,
                "attempt_index": idx,
                "fallback_attempt": idx > 0,
                "candidates": candidate_names,
            }
            if req.streamed:
                metadata["streamed"] = True
            yield _Attempt(
                row=row,
                client=client,
                config=ProviderConfig(provider=row.provider, api_key=api_key, api_url=row.api_url, model=chosen_model),
                metadata=metadata,
                rec=LlmCallRecorder.start(),
            )

    # ---------------------------------------------------------- step 4: record

    @staticmethod
    def _record_success(req: _Request, attempt: _Attempt, result: CompletionResult):
        return attempt.rec.success(
            user=req.user,
            provider=attempt.provider,
            model=attempt.model,
            task_key=req.task_key,
            prompt_text=req.prompt_text,
            response_text=result.content,
            trace_id=req.trace_id,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            total_tokens=result.total_tokens,
            cost_usd=attempt.row.compute_cost_usd(result.input_tokens, result.output_tokens),
            prompt_metadata=attempt.metadata,
        )

    @staticmethod
    def _record_failure(req: _Request, attempt: _Attempt, error: Exception, **extra_metadata: Any) -> None:
        logger.warning(
            "[LLMOrchestrator] Provider %s failed (streamed=%s) - user_id=%s, task_key=%s: %s",
            attempt.provider, req.streamed, req.user.id, req.task_key, error, exc_info=True,
        )
        attempt.rec.error(
            user=req.user,
            provider=attempt.provider,
            model=attempt.model,
            task_key=req.task_key,
            prompt_text=req.prompt_text,
            error=error,
            trace_id=req.trace_id,
            prompt_metadata={**attempt.metadata, **extra_metadata},
        )
        req.failures.append(f"{attempt.provider} ({attempt.model}): {_short_error(error)}")

    # ------------------------------------------------------- step 5: exhausted

    @staticmethod
    def _exhausted(req: _Request) -> AiUnavailableError:
        candidate_names = req.candidate_names
        if req.skipped_no_key and len(req.skipped_no_key) == len(candidate_names):
            return AiUnavailableError(
                "No API key saved for " + ", ".join(req.skipped_no_key) + ". Add one in Settings."
            )
        logger.warning(
            "[LLMOrchestrator] All providers failed - user_id=%s, task_key=%s, candidates=%s",
            req.user.id, req.task_key, ",".join(candidate_names),
        )
        if req.failures:
            # Tell the user what actually went wrong (retired model, bad key, rate limit)
            # instead of hiding it behind the generic message.
            return AiUnavailableError(AI_UNAVAILABLE_USER_MESSAGE + " " + " | ".join(req.failures))
        return AiUnavailableError(AI_UNAVAILABLE_USER_MESSAGE)

    # ------------------------------------------------------------ entry points

    @classmethod
    def run_completion(
        cls,
        *,
        user,
        messages: List[Dict[str, Any]],
        task_key: str = "chat",
        provider: Optional[str] = None,
        model: Optional[str] = None,
        llm_config: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
    ) -> CompletionOutcome:
        """Raises ``AiUnavailableError`` when no provider produced content."""
        req = cls._init_request(
            user=user, messages=messages, task_key=task_key, provider=provider, model=model,
            llm_config=llm_config, trace_id=trace_id, streamed=False,
        )

        for attempt in cls._attempts(req):
            try:
                result = attempt.client.complete(req.messages, attempt.config, llm_config=req.llm_config)
                if not result.content:
                    raise AiUnavailableError("Provider returned an empty response")
                call = cls._record_success(req, attempt, result)
                return CompletionOutcome(
                    content=result.content,
                    provider=attempt.provider,
                    model=attempt.model,
                    call_id=str(call.id),
                    usage=result.usage,
                )
            except Exception as e:  # noqa: BLE001 - every provider failure falls through to the next row
                cls._record_failure(req, attempt, e)

        raise cls._exhausted(req)

    @classmethod
    def stream_completion(
        cls,
        *,
        user,
        messages: List[Dict[str, Any]],
        task_key: str = "chat",
        provider: Optional[str] = None,
        model: Optional[str] = None,
        llm_config: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        """
        Streaming twin of ``run_completion``. Yields events:

        - ``{"type": "start", "provider", "model"}`` once a provider accepted the call
        - ``{"type": "delta", "text"}`` per text chunk
        - ``{"type": "done", "provider", "model", "call_id", "usage"}`` at the end
        - ``{"type": "error", "message"}`` instead of ``done`` when nothing answered

        Fallback to the next provider happens only before the first delta; a
        provider that dies mid-answer ends the stream with an error.
        """
        req = cls._init_request(
            user=user, messages=messages, task_key=task_key, provider=provider, model=model,
            llm_config=llm_config, trace_id=trace_id, streamed=True,
        )

        for attempt in cls._attempts(req):
            started = False
            parts: List[str] = []
            try:
                gen = attempt.client.complete_stream(req.messages, attempt.config, llm_config=req.llm_config)
                result = None
                while True:
                    try:
                        text = next(gen)
                    except StopIteration as stop:
                        result = stop.value
                        break
                    if not started:
                        started = True
                        yield {"type": "start", "provider": attempt.provider, "model": attempt.model}
                    parts.append(text)
                    yield {"type": "delta", "text": text}
                if not result or not result.content:
                    raise AiUnavailableError("Provider returned an empty response")
                call = cls._record_success(req, attempt, result)
                yield {
                    "type": "done",
                    "provider": attempt.provider,
                    "model": attempt.model,
                    "call_id": str(call.id),
                    "usage": result.usage,
                }
                return
            except Exception as e:  # noqa: BLE001 - recorded, then fall through or surface
                cls._record_failure(req, attempt, e, partial_chars=sum(len(p) for p in parts))
                if started:
                    yield {"type": "error", "message": f"{attempt.provider} stopped answering: {_short_error(e)}"}
                    return

        yield {"type": "error", "message": str(cls._exhausted(req))}
