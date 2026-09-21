from __future__ import annotations

import time
from typing import Any

from ai_control.choices import LlmCallStatusChoices
from ai_control.models import LlmApiCallModel

# Prompts and responses are stored truncated: the row is for debugging and
# usage, not a transcript store.
MAX_STORED_TEXT_CHARS = 20000


def _clip(text: str | None) -> str | None:
    if text is None:
        return None
    if len(text) <= MAX_STORED_TEXT_CHARS:
        return text
    return text[:MAX_STORED_TEXT_CHARS] + f"\n…[truncated {len(text) - MAX_STORED_TEXT_CHARS} chars]"


class LlmCallRecorder:
    """
    Minimal helper for persisting LLM calls.

    Use:
    - rec = LlmCallRecorder.start()
    - ... call provider ...
    - rec.success(...) or rec.error(...)
    """

    def __init__(self, *, started_at_ns: int):
        self.started_at_ns = started_at_ns

    @classmethod
    def start(cls) -> "LlmCallRecorder":
        return cls(started_at_ns=time.perf_counter_ns())

    def _latency_ms(self) -> int:
        return int((time.perf_counter_ns() - self.started_at_ns) / 1_000_000)

    def success(
        self,
        *,
        user,
        provider: str,
        model: str | None,
        task_key: str,
        prompt_text: str,
        response_text: str | None,
        response_json: dict[str, Any] | None = None,
        trace_id: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        total_tokens: int | None = None,
        cost_usd=None,
        prompt_metadata: dict[str, Any] | None = None,
    ) -> LlmApiCallModel:
        return LlmApiCallModel.objects.create(
            user=user,
            created_by=user,
            provider=provider,
            model=model or "",
            task_key=task_key,
            trace_id=trace_id,
            prompt_text=_clip(prompt_text) or "",
            prompt_metadata=prompt_metadata,
            response_text=_clip(response_text),
            response_json=response_json,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            cost_usd=cost_usd,
            latency_ms=self._latency_ms(),
            status=LlmCallStatusChoices.SUCCESS,
        )

    def error(
        self,
        *,
        user,
        provider: str,
        model: str | None,
        task_key: str,
        prompt_text: str,
        error: Exception,
        trace_id: str | None = None,
        prompt_metadata: dict[str, Any] | None = None,
    ) -> LlmApiCallModel:
        return LlmApiCallModel.objects.create(
            user=user,
            created_by=user,
            provider=provider,
            model=model or "",
            task_key=task_key,
            trace_id=trace_id,
            prompt_text=_clip(prompt_text) or "",
            prompt_metadata=prompt_metadata,
            latency_ms=self._latency_ms(),
            status=LlmCallStatusChoices.ERROR,
            error_type=error.__class__.__name__,
            error_message=_clip(str(error)),
        )
