from __future__ import annotations

import logging
from typing import Any, Dict, Generator, List, Optional

from ai_control.choices import LlmApiStyleChoices
from ai_control.llm.providers.base import (
    STOP_END_TURN,
    STOP_TOOL_USE,
    AbstractLLMProvider,
    CompletionResult,
    ProviderConfig,
    ToolCall,
)

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

    # ------------------------------------------------------------ wire format

    @staticmethod
    def _to_wire(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Neutral messages to Messages-API kwargs: ``system`` string plus a
        ``messages`` list of content blocks. Tool results become a single
        ``user`` turn of ``tool_result`` blocks, as the API requires.
        """
        system_parts: List[str] = []
        wire: List[Dict[str, Any]] = []
        for m in messages:
            role = m.get("role")
            if role == "system":
                text = str(m.get("content", ""))
                if text:
                    system_parts.append(text)
            elif role == "user":
                text = str(m.get("content", ""))
                images = m.get("images") or []
                if images:
                    blocks = [
                        {"type": "image", "source": {"type": "base64", "media_type": i["media_type"], "data": i["data"]}}
                        for i in images
                    ]
                    if text.strip():
                        blocks.append({"type": "text", "text": text})
                    wire.append({"role": "user", "content": blocks})
                else:
                    wire.append({"role": "user", "content": text})
            elif role == "assistant":
                blocks: List[Dict[str, Any]] = []
                text = str(m.get("content") or "")
                # The API rejects empty text blocks, so a tool-only turn carries none.
                if text.strip():
                    blocks.append({"type": "text", "text": text})
                for call in m.get("tool_calls") or []:
                    blocks.append({
                        "type": "tool_use",
                        "id": call["id"],
                        "name": call["name"],
                        "input": call.get("input") or {},
                    })
                if blocks:
                    wire.append({"role": "assistant", "content": blocks})
            elif role == "tool_results":
                results = [
                    {
                        "type": "tool_result",
                        "tool_use_id": r["call_id"],
                        "content": str(r.get("content") or ""),
                        "is_error": bool(r.get("is_error")),
                    }
                    for r in m.get("results") or []
                ]
                if results:
                    wire.append({"role": "user", "content": results})
        return {"system": "\n\n".join(system_parts), "messages": wire or [{"role": "user", "content": ""}]}

    @staticmethod
    def _tools_to_wire(tools: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
        if not tools:
            return {}
        return {
            "tools": [
                {"name": t["name"], "description": t.get("description") or "", "input_schema": t["input_schema"]}
                for t in tools
            ]
        }

    @classmethod
    def _request_kwargs(cls, messages, config, llm_config, tools) -> Dict[str, Any]:
        llm_config = cls.build_llm_config(llm_config)
        # No ``temperature``: the Messages API dropped sampling parameters and
        # the SDK (>=1.7) rejects the kwarg outright.
        return {
            "model": config.model,
            "max_tokens": int(llm_config.get("max_tokens", 4000)),
            "timeout": llm_config.get("timeout"),
            **cls._to_wire(messages),
            **cls._tools_to_wire(tools),
        }

    # -------------------------------------------------------------- responses

    @staticmethod
    def _tool_calls_from(response: Any) -> List[ToolCall]:
        calls: List[ToolCall] = []
        for block in getattr(response, "content", []) or []:
            if getattr(block, "type", None) == "tool_use":
                calls.append(ToolCall(
                    id=str(getattr(block, "id", "")),
                    name=str(getattr(block, "name", "")),
                    input=dict(getattr(block, "input", None) or {}),
                ))
        return calls

    @staticmethod
    def _text_from(response: Any) -> str:
        return "".join(
            getattr(block, "text", "") for block in getattr(response, "content", []) or []
            if getattr(block, "type", "text") == "text"
        )

    @staticmethod
    def _stop_reason(raw: Optional[str], tool_calls: List[ToolCall]) -> str:
        return STOP_TOOL_USE if (tool_calls or raw == "tool_use") else STOP_END_TURN

    def _result_from(self, response: Any, content: Optional[str] = None) -> CompletionResult:
        raw = getattr(response, "stop_reason", None)
        text = self._text_from(response) if content is None else content
        tool_calls = self._tool_calls_from(response)
        return CompletionResult(
            content=text or None,
            usage=self._extract_usage(response),
            tool_calls=tool_calls,
            stop_reason=self._stop_reason(raw, tool_calls),
            raw_stop_reason=raw,
        )

    def complete(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> CompletionResult:
        client = self._build_client(config)
        response = client.messages.create(**self._request_kwargs(messages, config, llm_config, tools))
        return self._result_from(response)

    def complete_stream(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Generator[str, None, CompletionResult]:
        client = self._build_client(config)
        parts: List[str] = []
        with client.messages.stream(**self._request_kwargs(messages, config, llm_config, tools)) as stream:
            for text in stream.text_stream:
                if text:
                    parts.append(text)
                    yield text
            # Tool-use blocks and stop reason only exist on the final snapshot.
            # (Never ``get_final_text``: it raises on tool-only replies.)
            final = stream.get_final_message()
        return self._result_from(final, content="".join(parts))

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
