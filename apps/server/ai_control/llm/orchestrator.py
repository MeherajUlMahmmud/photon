from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any, Dict, List, Optional

from ai_control.llm.exceptions import AiUnavailableError
from ai_control.llm.providers import (
    AbstractLLMProvider,
    AnthropicLLMProvider,
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


class LLMOrchestrator:
    """
    Picks a provider for a user, runs the completion, records the call.

    Candidates are active ``LlmProviderModel`` rows in priority order, reduced
    to the ones the user has stored an API key for. A pinned ``provider`` is
    tried first but the rest still act as fallbacks unless ``strict`` is set.
    """

    _registry: dict[str, AbstractLLMProvider] = {}
    _initialized = False

    @classmethod
    def register_client(cls, client: AbstractLLMProvider) -> None:
        cls._registry[str(client.api_style)] = client

    @classmethod
    def _ensure_defaults(cls) -> None:
        if cls._initialized:
            return
        cls.register_client(AnthropicLLMProvider())
        cls.register_client(OpenAICompatibleLLMProvider())
        cls._initialized = True

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
        cls._ensure_defaults()

        preferred = (provider or "").strip().lower()
        # A caller that names a model has a specific provider in mind; don't
        # send that model id to a different vendor.
        strict = bool(preferred and model)
        candidates = cls.candidate_providers(user, preferred_provider=preferred, strict=strict)
        prompt_text = cls._messages_text(messages)
        candidate_names = [c.provider for c in candidates]
        skipped_no_key: List[str] = []
        failures: List[str] = []

        for idx, row in enumerate(candidates):
            client = cls._registry.get(str(row.api_style))
            if client is None:
                logger.warning("[LLMOrchestrator] Provider %s has unknown api_style %s; skipping", row.provider, row.api_style)
                continue
            api_key = SecretService.get_api_key(user, row.provider)
            if not api_key:
                skipped_no_key.append(row.provider)
                continue

            chosen_model = model if (model and row.provider == preferred) else row.default_model
            config = ProviderConfig(provider=row.provider, api_key=api_key, api_url=row.api_url, model=chosen_model)
            metadata = {
                "task_key": task_key,
                "selected_provider": preferred or None,
                "attempt_index": idx,
                "fallback_attempt": idx > 0,
                "candidates": candidate_names,
            }
            rec = LlmCallRecorder.start()
            try:
                result = client.complete(messages, config, llm_config=llm_config)
                if not result.content:
                    raise AiUnavailableError("Provider returned an empty response")
                call = rec.success(
                    user=user,
                    provider=row.provider,
                    model=chosen_model,
                    task_key=task_key,
                    prompt_text=prompt_text,
                    response_text=result.content,
                    trace_id=trace_id,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    total_tokens=result.total_tokens,
                    cost_usd=row.compute_cost_usd(result.input_tokens, result.output_tokens),
                    prompt_metadata=metadata,
                )
                return CompletionOutcome(
                    content=result.content,
                    provider=row.provider,
                    model=chosen_model,
                    call_id=str(call.id),
                    usage=result.usage,
                )
            except Exception as e:  # noqa: BLE001 - every provider failure falls through to the next row
                logger.warning(
                    "[LLMOrchestrator] Provider %s failed - user_id=%s, task_key=%s: %s",
                    row.provider, user.id, task_key, e, exc_info=True,
                )
                rec.error(
                    user=user,
                    provider=row.provider,
                    model=chosen_model,
                    task_key=task_key,
                    prompt_text=prompt_text,
                    error=e,
                    trace_id=trace_id,
                    prompt_metadata=metadata,
                )
                failures.append(f"{row.provider} ({chosen_model}): {_short_error(e)}")

        if skipped_no_key and len(skipped_no_key) == len(candidates):
            raise AiUnavailableError(
                "No API key saved for " + ", ".join(skipped_no_key) + ". Add one in Settings."
            )
        logger.warning(
            "[LLMOrchestrator] All providers failed - user_id=%s, task_key=%s, candidates=%s",
            user.id, task_key, ",".join(candidate_names),
        )
        if failures:
            # Tell the user what actually went wrong (retired model, bad key, rate limit)
            # instead of hiding it behind the generic message.
            raise AiUnavailableError(AI_UNAVAILABLE_USER_MESSAGE + " " + " | ".join(failures))
        raise AiUnavailableError(AI_UNAVAILABLE_USER_MESSAGE)
