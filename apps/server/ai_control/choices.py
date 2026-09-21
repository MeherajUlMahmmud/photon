from django.db import models


class LlmProviderChoices(models.TextChoices):
    # Values must match the provider ids registered in LLMOrchestrator and the
    # `provider` slug users store their API key under (user_control.UserSecretModel).
    ANTHROPIC = "anthropic", "Anthropic"
    OPENAI = "openai", "OpenAI"
    NVIDIA = "nvidia", "NVIDIA NIM"
    KIMI = "kimi", "Kimi (Moonshot)"


class LlmApiStyleChoices(models.TextChoices):
    """Wire protocol a provider speaks; picks the client implementation."""
    ANTHROPIC = "anthropic", "Anthropic Messages API"
    OPENAI_COMPATIBLE = "openai_compatible", "OpenAI-compatible chat completions"


class LlmCapabilityChoices(models.TextChoices):
    CHAT = "chat", "Chat"
    JSON_OUTPUT = "json_output", "JSON output"
    TOOL_CALLING = "tool_calling", "Tool calling"
    VISION = "vision", "Vision"
    TRANSCRIPTION = "transcription", "Speech to text"


class LlmCallStatusChoices(models.TextChoices):
    SUCCESS = "success", "Success"
    ERROR = "error", "Error"
