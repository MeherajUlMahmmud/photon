from __future__ import annotations

import logging
from typing import Any, Dict, Generator, List, Optional

from ai_control.choices import LlmApiStyleChoices
from ai_control.llm.providers.base import AbstractLLMProvider, CompletionResult, ProviderConfig

logger = logging.getLogger(__name__)


class AnthropicLLMProvider(AbstractLLMProvider):
    api_style = LlmApiStyleChoices.ANTHROPIC

    @classmethod
    def _build_client(cls, config: ProviderConfig):
        # Lazy import so this module loads even without the SDK installed.
        from anthropic import Anthropic

        return Anthropic(api_key=config.api_key, base_url=config.api_url or None)

    def list_models(self, config: ProviderConfig) -> List[str]:
        client = self._build_client(config)
        return sorted(m.id for m in client.models.list(limit=1000))

    def complete(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> CompletionResult:
        llm_config = self.build_llm_config(llm_config)
        system_parts = [str(m.get("content", "")) for m in messages if m.get("role") == "system"]
        user_messages = [m for m in messages if m.get("role") != "system"]

        client = self._build_client(config)
        response = client.messages.create(
            model=config.model,
            max_tokens=int(llm_config.get("max_tokens", 4000)),
            temperature=llm_config.get("temperature", 0.2),
            system="\n\n".join(p for p in system_parts if p),
            messages=user_messages or [{"role": "user", "content": ""}],
            timeout=llm_config.get("timeout"),
        )
        content = "".join(
            getattr(block, "text", "") for block in getattr(response, "content", []) or []
            if getattr(block, "type", "text") == "text"
        )
        return CompletionResult(content=content or None, usage=self._extract_usage(response))

    def complete_stream(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> Generator[str, None, CompletionResult]:
        llm_config = self.build_llm_config(llm_config)
        system_parts = [str(m.get("content", "")) for m in messages if m.get("role") == "system"]
        user_messages = [m for m in messages if m.get("role") != "system"]

        client = self._build_client(config)
        parts: List[str] = []
        with client.messages.stream(
            model=config.model,
            max_tokens=int(llm_config.get("max_tokens", 4000)),
            temperature=llm_config.get("temperature", 0.2),
            system="\n\n".join(p for p in system_parts if p),
            messages=user_messages or [{"role": "user", "content": ""}],
            timeout=llm_config.get("timeout"),
        ) as stream:
            for text in stream.text_stream:
                if text:
                    parts.append(text)
                    yield text
            final = stream.get_final_message()
        content = "".join(parts)
        return CompletionResult(content=content or None, usage=self._extract_usage(final))

    @staticmethod
    def _extract_usage(response: Any) -> Dict[str, int]:
        usage: Dict[str, int] = {}
        u = getattr(response, "usage", None)
        if u is None:
            return usage
        for attr, key in (("input_tokens", "input_tokens"), ("output_tokens", "output_tokens")):
            value = getattr(u, attr, None)
            if value is not None:
                usage[key] = int(value)
        return usage
