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


class LlmToolRiskChoices(models.TextChoices):
    """How much a tool can damage; the client picks an approval flow from it."""
    READ = "read", "Read only"
    WRITE = "write", "Writes files"
    SHELL = "shell", "Runs shell commands"
    DESTRUCTIVE = "destructive", "Destructive"


class LlmToolExecutorChoices(models.TextChoices):
    """
    Where a tool runs. Client tools go to the desktop as pending calls; server
    tools (``read_skill_file``) are answered inside the step by
    ``ServerToolService`` and reported in ``done.resolved_tool_calls``.
    """
    CLIENT = "client", "Client (desktop)"
    SERVER = "server", "Server"


class AgentSessionStatusChoices(models.TextChoices):
    IDLE = "idle", "Idle"
    RUNNING = "running", "Running"
    AWAITING_TOOLS = "awaiting_tools", "Awaiting tool results"
    ERROR = "error", "Error"


class AgentMessageRoleChoices(models.TextChoices):
    USER = "user", "User"
    ASSISTANT = "assistant", "Assistant"


class AgentToolCallStatusChoices(models.TextChoices):
    PENDING = "pending", "Pending"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"
    DENIED = "denied", "Denied by user"
    CANCELLED = "cancelled", "Cancelled"


class AgentStopReasonChoices(models.TextChoices):
    """Why a step ended, as reported to the client."""
    END_TURN = "end_turn", "End of turn"
    TOOL_USE = "tool_use", "Waiting for tools"
    MAX_STEPS = "max_steps", "Step limit reached"
