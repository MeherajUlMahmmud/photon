from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Generator, List, Optional

DEFAULT_LLM_CONFIG = {
    "temperature": 0.2,
    "max_tokens": 4000,
    "timeout": 120,
}


@dataclass(frozen=True)
class ProviderConfig:
    """Everything a client needs for one call: resolved by the orchestrator per user."""

    provider: str
    api_key: str
    api_url: str
    model: str


@dataclass
class CompletionResult:
    content: Optional[str]
    usage: Dict[str, int] = field(default_factory=dict)

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


class AbstractLLMProvider(ABC):
    """One implementation per wire protocol (``LlmApiStyleChoices``).

    Clients are stateless: the key, URL and model arrive in ``ProviderConfig``
    on every call, so one instance serves every user and provider row.
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
    ) -> CompletionResult:
        """Run a chat completion. Raises on provider failure; the orchestrator records and falls through."""

    @abstractmethod
    def complete_stream(
        self,
        messages: List[Dict[str, Any]],
        config: ProviderConfig,
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> Generator[str, None, CompletionResult]:
        """
        Run a chat completion, yielding text deltas as they arrive. The
        generator's return value is the finished ``CompletionResult`` (full
        text plus usage). Raises on provider failure, possibly mid-stream.
        """

    @staticmethod
    def build_llm_config(llm_config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return {**DEFAULT_LLM_CONFIG, **(llm_config or {})}
