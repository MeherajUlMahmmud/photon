from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from ai_control.choices import LlmApiStyleChoices
from ai_control.llm.providers.base import AbstractLLMProvider, CompletionResult, ProviderConfig

logger = logging.getLogger(__name__)


class OpenAICompatibleLLMProvider(AbstractLLMProvider):
    """
    Shared client for every provider exposing an OpenAI-shaped chat-completions
    API: OpenAI itself, NVIDIA NIM, Kimi (Moonshot), DeepSeek, Groq, ... The
    row's ``api_url`` selects the vendor.
    """

    api_style = LlmApiStyleChoices.OPENAI_COMPATIBLE

    @classmethod
    def _build_client(cls, config: ProviderConfig):
        from openai import OpenAI

        return OpenAI(api_key=config.api_key, base_url=config.api_url or None)

    def complete(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> CompletionResult:
        llm_config = self.build_llm_config(llm_config)
        client = self._build_client(config)
        response = client.chat.completions.create(
            model=config.model,
            messages=messages,
            **llm_config,
        )
        content: Optional[str] = None
        if response.choices and response.choices[0].message:
            content = response.choices[0].message.content
        return CompletionResult(content=content or None, usage=self._extract_usage(response))

    @staticmethod
    def _extract_usage(response: Any) -> Dict[str, int]:
        usage: Dict[str, int] = {}
        u = getattr(response, "usage", None)
        if u is None:
            return usage
        for attr, key in (
            ("prompt_tokens", "input_tokens"),
            ("completion_tokens", "output_tokens"),
            ("total_tokens", "total_tokens"),
        ):
            value = getattr(u, attr, None)
            if value is not None:
                usage[key] = int(value)
        return usage
