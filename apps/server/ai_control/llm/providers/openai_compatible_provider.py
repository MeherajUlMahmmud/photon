from __future__ import annotations

import json
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

    def list_models(self, config: ProviderConfig) -> List[str]:
        client = self._build_client(config)
        return sorted(m.id for m in client.models.list())

    # ------------------------------------------------------------ wire format

    @staticmethod
    def _to_wire(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Neutral messages to chat-completions messages. An assistant turn with
        tool calls carries ``tool_calls`` (arguments as a JSON string) and
        ``content`` null when it said nothing; each tool result is its own
        ``tool`` message right after it.
        """
        wire: List[Dict[str, Any]] = []
        for m in messages:
            role = m.get("role")
            if role == "user" and m.get("images"):
                parts: List[Dict[str, Any]] = [
                    {"type": "image_url", "image_url": {"url": f"data:{i['media_type']};base64,{i['data']}"}}
                    for i in m["images"]
                ]
                text = str(m.get("content", ""))
                if text.strip():
                    parts.append({"type": "text", "text": text})
                wire.append({"role": "user", "content": parts})
            elif role in ("system", "user"):
                wire.append({"role": role, "content": str(m.get("content", ""))})
            elif role == "assistant":
                text = str(m.get("content") or "")
                entry: Dict[str, Any] = {"role": "assistant", "content": text or None}
                calls = m.get("tool_calls") or []
                if calls:
                    entry["tool_calls"] = [
                        {
                            "id": c["id"],
                            "type": "function",
                            "function": {"name": c["name"], "arguments": json.dumps(c.get("input") or {})},
                        }
                        for c in calls
                    ]
                if text or calls:
                    wire.append(entry)
            elif role == "tool_results":
                for r in m.get("results") or []:
                    content = str(r.get("content") or "")
                    if r.get("is_error") and not content.lower().startswith("error"):
                        content = f"Error: {content}"
                    wire.append({"role": "tool", "tool_call_id": r["call_id"], "content": content})
        return wire

    @staticmethod
    def _tools_to_wire(tools: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
        if not tools:
            return {}
        return {
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description") or "",
                        "parameters": t["input_schema"],
                    },
                }
                for t in tools
            ]
        }

    # -------------------------------------------------------------- responses

    @staticmethod
    def _parse_arguments(raw: Optional[str]) -> Dict[str, Any]:
        """
        Arguments come back as a JSON string the model wrote; it may be
        malformed. Keep the raw text so the loop can report it as a tool error
        instead of aborting the whole turn.
        """
        text = (raw or "").strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except ValueError:
            return {"_raw": text, "_error": "Tool arguments were not valid JSON"}
        return parsed if isinstance(parsed, dict) else {"_raw": text, "_error": "Tool arguments were not an object"}

    @classmethod
    def _tool_calls_from_message(cls, message: Any) -> List[ToolCall]:
        calls: List[ToolCall] = []
        for tc in getattr(message, "tool_calls", None) or []:
            fn = getattr(tc, "function", None)
            calls.append(ToolCall(
                id=str(getattr(tc, "id", "") or ""),
                name=str(getattr(fn, "name", "") or ""),
                input=cls._parse_arguments(getattr(fn, "arguments", None)),
            ))
        return calls

    @staticmethod
    def _stop_reason(raw: Optional[str], tool_calls: List[ToolCall]) -> str:
        # Some compatible vendors report ``stop`` even when they emitted tool
        # calls, so the presence of calls wins over the reported reason.
        return STOP_TOOL_USE if (tool_calls or raw == "tool_calls") else STOP_END_TURN

    def complete(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> CompletionResult:
        llm_config = self.build_llm_config(llm_config)
        client = self._build_client(config)
        response = client.chat.completions.create(
            model=config.model,
            messages=self._to_wire(messages),
            **self._tools_to_wire(tools),
            **llm_config,
        )
        content: Optional[str] = None
        tool_calls: List[ToolCall] = []
        raw_stop: Optional[str] = None
        if response.choices:
            choice = response.choices[0]
            raw_stop = getattr(choice, "finish_reason", None)
            if choice.message:
                content = choice.message.content
                tool_calls = self._tool_calls_from_message(choice.message)
        return CompletionResult(
            content=content or None,
            usage=self._extract_usage(response),
            tool_calls=tool_calls,
            stop_reason=self._stop_reason(raw_stop, tool_calls),
            raw_stop_reason=raw_stop,
        )

    def complete_stream(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Generator[str, None, CompletionResult]:
        llm_config = self.build_llm_config(llm_config)
        client = self._build_client(config)
        parts: List[str] = []
        usage: Dict[str, int] = {}
        raw_stop: Optional[str] = None
        # Tool calls arrive sliced across chunks keyed by ``index``: id and name
        # on the first slice, ``arguments`` appended piecewise after that.
        pending: Dict[int, Dict[str, str]] = {}
        stream = client.chat.completions.create(
            model=config.model,
            messages=self._to_wire(messages),
            stream=True,
            # Asks for a final usage-only chunk; vendors that do not know the
            # option ignore it, so usage may stay empty for them.
            stream_options={"include_usage": True},
            **self._tools_to_wire(tools),
            **llm_config,
        )
        for chunk in stream:
            if getattr(chunk, "usage", None):
                usage = self._extract_usage(chunk)
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            choice = choices[0]
            if getattr(choice, "finish_reason", None):
                raw_stop = choice.finish_reason
            delta = getattr(choice, "delta", None)
            if delta is None:
                continue
            text = getattr(delta, "content", None)
            if text:
                parts.append(text)
                yield text
            for tc in getattr(delta, "tool_calls", None) or []:
                index = getattr(tc, "index", None)
                slot = pending.setdefault(0 if index is None else int(index), {"id": "", "name": "", "arguments": ""})
                if getattr(tc, "id", None):
                    slot["id"] = tc.id
                fn = getattr(tc, "function", None)
                if fn is not None:
                    if getattr(fn, "name", None):
                        slot["name"] = fn.name
                    if getattr(fn, "arguments", None):
                        slot["arguments"] += fn.arguments
        tool_calls = [
            ToolCall(id=slot["id"], name=slot["name"], input=self._parse_arguments(slot["arguments"]))
            for _, slot in sorted(pending.items())
        ]
        content = "".join(parts)
        return CompletionResult(
            content=content or None,
            usage=usage,
            tool_calls=tool_calls,
            stop_reason=self._stop_reason(raw_stop, tool_calls),
            raw_stop_reason=raw_stop,
        )

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
