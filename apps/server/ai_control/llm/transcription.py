from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Optional

from ai_control.choices import LlmApiStyleChoices, LlmCapabilityChoices
from ai_control.llm.exceptions import AiUnavailableError
from ai_control.llm.orchestrator import _short_error
from ai_control.llm.recorder import LlmCallRecorder
from ai_control.models import LlmProviderModel
from user_control.services import SecretService

logger = logging.getLogger(__name__)

#: Speech-to-text model per provider. Only OpenAI-compatible vendors expose
#: the /audio/transcriptions route, and each names its model differently.
TRANSCRIPTION_MODELS = {
    "openai": "gpt-4o-mini-transcribe",
    "groq": "whisper-large-v3-turbo",
}

TASK_KEY = "transcribe"


@dataclass
class TranscriptionOutcome:
    text: str
    provider: str
    model: str
    call_id: str


class Transcriber:
    """
    Turns a short audio clip into text with the user's own key, trying each
    provider that advertises the transcription capability in priority order.
    """

    @staticmethod
    def candidate_providers() -> list[LlmProviderModel]:
        rows = LlmProviderModel.objects.filter(
            is_active=True, is_deleted=False, api_style=LlmApiStyleChoices.OPENAI_COMPATIBLE,
        ).order_by("priority", "created_at")
        return [
            r for r in rows
            if r.has_capability(LlmCapabilityChoices.TRANSCRIPTION.value) and r.provider in TRANSCRIPTION_MODELS
        ]

    @classmethod
    def run(cls, *, user, audio: bytes, mime: str, language: Optional[str] = None) -> TranscriptionOutcome:
        """Raises ``AiUnavailableError`` when no provider produced text."""
        from openai import OpenAI

        candidates = cls.candidate_providers()
        if not candidates:
            raise AiUnavailableError("No provider is set up for speech to text.")

        filename = "clip." + _extension_for(mime)
        skipped_no_key: list[str] = []
        failures: list[str] = []

        for row in candidates:
            api_key = SecretService.get_api_key(user, row.provider)
            if not api_key:
                skipped_no_key.append(row.provider)
                continue
            model = TRANSCRIPTION_MODELS[row.provider]
            metadata = {"task_key": TASK_KEY, "mime": mime, "bytes": len(audio), "language": language}
            rec = LlmCallRecorder.start()
            try:
                client = OpenAI(api_key=api_key, base_url=row.api_url or None)
                kwargs = {"model": model, "file": (filename, audio, mime)}
                if language:
                    kwargs["language"] = language
                response = client.audio.transcriptions.create(**kwargs)
                text = (getattr(response, "text", None) or "").strip()
                if not text:
                    raise AiUnavailableError("Provider returned no text")
                call = rec.success(
                    user=user, provider=row.provider, model=model, task_key=TASK_KEY,
                    prompt_text="", response_text=text, prompt_metadata=metadata,
                )
                return TranscriptionOutcome(text=text, provider=row.provider, model=model, call_id=str(call.id))
            except Exception as e:  # noqa: BLE001 - fall through to the next provider
                logger.warning("[Transcriber] Provider %s failed - user_id=%s: %s", row.provider, user.id, e, exc_info=True)
                rec.error(
                    user=user, provider=row.provider, model=model, task_key=TASK_KEY,
                    prompt_text="", error=e, prompt_metadata=metadata,
                )
                failures.append(f"{row.provider} ({model}): {_short_error(e)}")

        if skipped_no_key and len(skipped_no_key) == len(candidates):
            raise AiUnavailableError(
                "Speech to text needs an API key for " + " or ".join(skipped_no_key) + ". Add one in Settings."
            )
        raise AiUnavailableError("Could not transcribe the recording. " + " | ".join(failures))


def _extension_for(mime: str) -> str:
    base = mime.split(";", 1)[0].strip().lower()
    return {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/mp4": "m4a",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
    }.get(base, "webm")
