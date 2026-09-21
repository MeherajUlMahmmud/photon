from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Generator, List, Optional

DEFAULT_LLM_CONFIG = {
    "temperature": 0.2,
    "max_tokens": 4000,
    "timeout": 120,
}

#: Provider-neutral stop reasons. Anything the vendor reports that is not a
#: tool request maps to ``END_TURN``; the raw value is kept alongside.
STOP_END_TURN = "end_turn"
STOP_TOOL_USE = "tool_use"


@dataclass(frozen=True)
class ProviderConfig:
    """Everything a client needs for one call: resolved by the orchestrator per user."""

    provider: str
    api_key: str
    api_url: str
    model: str


@dataclass
class ToolCall:
    """One tool invocation the model asked for. ``input`` is the parsed JSON argument object."""

    id: str
    name: str
    input: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "name": self.name, "input": self.input}


@dataclass
class CompletionResult:
    content: Optional[str]
    usage: Dict[str, int] = field(default_factory=dict)
    tool_calls: List[ToolCall] = field(default_factory=list)
    stop_reason: Optional[str] = None
    raw_stop_reason: Optional[str] = None

    @property
    def input_tokens(self) -> Optional[int]:
        return self.usage.get("input_tokens")

    @property
    def output_tokens(self) -> Optional[int]:
        return self.usage.get("output_tokens")

    @property
    def total_tokens(self) -> Optional[int]:
        total = self.usage.get("total_tokens")
        if total is None and self.input_tokens is not None and self.output_tokens is not None:
            total = self.input_tokens + self.output_tokens
        return total

    @property
    def is_empty(self) -> bool:
        return not self.content and not self.tool_calls


class AbstractLLMProvider(ABC):
    """One implementation per wire protocol (``LlmApiStyleChoices``).

    Clients are stateless: the key, URL and model arrive in ``ProviderConfig``
    on every call, so one instance serves every user and provider row.

    Messages arrive in a provider-neutral shape and each client converts them
    to its wire format:

    - ``{"role": "system" | "user", "content": str}``
    - ``{"role": "assistant", "content": str, "tool_calls": [{"id", "name", "input"}]}``
    - ``{"role": "tool_results", "results": [{"call_id", "name", "content", "is_error"}]}``
      (all results for the preceding assistant turn, grouped)

    ``tools`` is a list of ``{"name", "description", "input_schema"}`` where
    ``input_schema`` is a JSON Schema object.
    """

    api_style: str

    @classmethod
    @abstractmethod
    def _build_client(cls, config: ProviderConfig) -> Any:
        """Build the provider SDK client."""

    @abstractmethod
    def list_models(self, config: ProviderConfig) -> List[str]:
        """Model ids the key can use, sorted. Cheap: no tokens spent. Raises on a bad key or endpoint."""

    @abstractmethod
    def complete(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> CompletionResult:
        """Run a chat completion. Raises on provider failure; the orchestrator records and falls through."""

    @abstractmethod
    def complete_stream(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Generator[str, None, CompletionResult]:
        """
        Run a chat completion, yielding text deltas as they arrive. The
        generator's return value is the finished ``CompletionResult`` (full
        text, tool calls, usage). Raises on provider failure, possibly mid-stream.
        """

    @staticmethod
    def build_llm_config(llm_config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return {**DEFAULT_LLM_CONFIG, **(llm_config or {})}
