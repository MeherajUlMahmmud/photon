from decimal import Decimal, InvalidOperation
import uuid

from django.db import models

from ai_control.choices import (
    AgentMessageRoleChoices,
    AgentSessionStatusChoices,
    AgentToolCallStatusChoices,
    LlmApiStyleChoices,
    LlmCallStatusChoices,
    LlmCapabilityChoices,
    LlmProviderChoices,
    LlmToolExecutorChoices,
    LlmToolRiskChoices,
)
from common.models import BaseModel


class LlmProviderModel(BaseModel):
    """
    Registry of LLM providers Photon can talk to (seeded by
    ``3_create_default_llm_providers``). Holds endpoint and model defaults only:
    Photon is bring-your-own-key, so the API key lives per user in
    ``user_control.UserSecretModel`` under this row's ``provider`` slug.

    The orchestrator tries active rows in ``priority`` order (lower first),
    skipping providers the user has no key for, and falls through to the next
    row when a call fails.
    """

    provider = models.CharField(
        max_length=30,
        choices=LlmProviderChoices.choices,
        unique=True,
        help_text="Slug users store their API key under, e.g. 'anthropic'.",
    )
    name = models.CharField(max_length=120, help_text="Human-friendly label shown in the app.")
    api_style = models.CharField(max_length=30, choices=LlmApiStyleChoices.choices)
    api_url = models.URLField(help_text="Base API URL.")
    default_model = models.CharField(
        max_length=120,
        help_text="Model id used when the caller does not name one.",
    )
    model_ids = models.JSONField(
        blank=True,
        default=list,
        help_text="Known model ids offered in the model picker, e.g. ['claude-sonnet-5'].",
    )
    priority = models.PositiveIntegerField(
        default=100,
        db_index=True,
        help_text="Lower runs first when the caller does not pin a provider.",
    )
    capabilities = models.JSONField(
        blank=True,
        default=list,
        help_text="What the provider supports, e.g. ['chat', 'json_output', 'tool_calling'].",
    )
    input_cost_per_million_usd = models.DecimalField(
        max_digits=12, decimal_places=4, default=0,
        help_text="USD per 1,000,000 input tokens for the default model. 0 = don't cost calls.",
    )
    output_cost_per_million_usd = models.DecimalField(
        max_digits=12, decimal_places=4, default=0,
        help_text="USD per 1,000,000 output tokens for the default model.",
    )

    class Meta:
        db_table = "ai_control_llm_providers"
        verbose_name = "LLM Provider"
        verbose_name_plural = "LLM Providers"
        ordering = ["priority", "created_at"]

    def __str__(self):
        return f"{self.name} ({self.provider}/{self.default_model})"

    def has_capability(self, capability: str) -> bool:
        return capability in (self.capabilities or [])

    def compute_cost_usd(self, input_tokens, output_tokens):
        """
        USD cost for a call with the given token counts, or None when it can't
        be computed (no pricing set, or no token counts reported).
        """

        def _rate(value):
            if value in (None, ''):
                return Decimal("0")
            if isinstance(value, Decimal):
                return value
            try:
                return Decimal(str(value))
            except (InvalidOperation, ValueError):
                return Decimal("0")

        in_rate = _rate(self.input_cost_per_million_usd)
        out_rate = _rate(self.output_cost_per_million_usd)
        if in_rate <= 0 and out_rate <= 0:
            return None
        if input_tokens is None and output_tokens is None:
            return None

        per_million = Decimal("1000000")
        cost = (Decimal(int(input_tokens or 0)) * in_rate + Decimal(int(output_tokens or 0)) * out_rate) / per_million
        return cost.quantize(Decimal("0.000001"))


class LlmApiCallModel(BaseModel):
    """
    Provider-agnostic record of one LLM API call, for debugging and usage
    analytics. Token fields are nullable because providers don't all report them.
    """

    user = models.ForeignKey(
        'user_control.UserModel', on_delete=models.CASCADE, related_name='llm_api_calls',
    )
    provider = models.CharField(max_length=50, db_index=True)
    model = models.CharField(max_length=120, blank=True, default="", db_index=True)
    task_key = models.CharField(max_length=80, blank=True, default="", db_index=True)

    trace_id = models.CharField(max_length=120, null=True, blank=True, db_index=True)
    correlation_id = models.UUIDField(default=uuid.uuid4, db_index=True)

    prompt_text = models.TextField()
    prompt_metadata = models.JSONField(null=True, blank=True)

    response_text = models.TextField(null=True, blank=True)
    response_json = models.JSONField(null=True, blank=True)

    input_tokens = models.IntegerField(null=True, blank=True)
    output_tokens = models.IntegerField(null=True, blank=True)
    total_tokens = models.IntegerField(null=True, blank=True)

    latency_ms = models.IntegerField(null=True, blank=True)
    cost_usd = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)

    status = models.CharField(
        max_length=30, choices=LlmCallStatusChoices.choices,
        default=LlmCallStatusChoices.SUCCESS, db_index=True,
    )
    error_type = models.CharField(max_length=120, null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "ai_control_llm_api_calls"
        verbose_name = "LLM API Call"
        verbose_name_plural = "LLM API Calls"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "created_at"], name="ai_call_user_created_idx"),
            models.Index(fields=["provider", "created_at"], name="ai_call_provider_created_idx"),
            models.Index(fields=["status", "created_at"], name="ai_call_status_created_idx"),
        ]

    def __str__(self):
        return f"{self.provider}/{self.model} {self.status} ({self.created_at:%Y-%m-%d %H:%M})"


class LlmToolModel(BaseModel):
    """
    Registry of tools the agent may ask for (seeded by
    ``4_create_default_llm_tools``). The server sends ``name``, ``description``
    and ``input_schema`` to the model; the client executes a call by ``name``,
    so names must match the desktop's tool implementations exactly.
    """

    name = models.SlugField(max_length=60, unique=True, help_text="Tool id the model calls and the client dispatches on.")
    label = models.CharField(max_length=120, help_text="Human-friendly label shown in the app.")
    description = models.TextField(help_text="Sent to the model. Say what it does and when to use it.")
    input_schema = models.JSONField(default=dict, help_text="JSON Schema (type: object) for the tool's arguments.")
    risk = models.CharField(max_length=20, choices=LlmToolRiskChoices.choices, default=LlmToolRiskChoices.READ)
    executor = models.CharField(
        max_length=20, choices=LlmToolExecutorChoices.choices, default=LlmToolExecutorChoices.CLIENT,
    )
    priority = models.PositiveIntegerField(default=100, db_index=True, help_text="Order tools are listed to the model.")
    task_keys = models.JSONField(
        blank=True, default=list,
        help_text="Task keys this tool is offered for, e.g. ['agent']. Empty = every task.",
    )

    class Meta:
        db_table = "ai_control_llm_tools"
        verbose_name = "LLM Tool"
        verbose_name_plural = "LLM Tools"
        ordering = ["priority", "name"]

    def __str__(self):
        return f"{self.name} ({self.risk})"

    def offered_for(self, task_key: str) -> bool:
        return not self.task_keys or task_key in self.task_keys

    def schema_for_model(self) -> dict:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema or {"type": "object"}}


class SkillModel(BaseModel):
    """
    A reusable prompt the user installs by pasting a Markdown file and invokes
    by typing ``/<name>`` in the composer. The file's YAML front matter gives
    ``name`` and ``description``; the rest is ``content``, which the server
    splices into the user message when the skill is invoked
    (``SkillService.render``). ``$ARGUMENTS`` in the content is replaced by
    whatever the user typed after the command.
    """

    user = models.ForeignKey('user_control.UserModel', on_delete=models.CASCADE, related_name='skills')
    name = models.SlugField(max_length=64, help_text="Slash command id, e.g. 'review' for /review.")
    description = models.CharField(max_length=500, blank=True, default="", help_text="One line shown in the picker.")
    content = models.TextField(help_text="Markdown instructions sent to the model; front matter stripped.")

    class Meta:
        db_table = "ai_control_skills"
        verbose_name = "Skill"
        verbose_name_plural = "Skills"
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["user", "name"], name="skill_unique_user_name")]

    def __str__(self):
        return f"/{self.name}"


class AgentSessionModel(BaseModel):
    """
    One agent conversation. The server owns the transcript and drives the
    model; the client runs tools and posts results back one step at a time.
    """

    user = models.ForeignKey('user_control.UserModel', on_delete=models.CASCADE, related_name='agent_sessions')
    workspace = models.ForeignKey(
        'workspace_control.WorkspaceModel', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='agent_sessions',
    )
    title = models.CharField(max_length=255, blank=True, default="")
    provider = models.CharField(max_length=30, blank=True, default="", help_text="Pinned provider slug, or empty for auto.")
    model = models.CharField(max_length=120, blank=True, default="", help_text="Pinned model id, or empty for the provider default.")
    task_key = models.CharField(max_length=80, default="agent", db_index=True)
    system_prompt = models.TextField(blank=True, default="")
    workspace_path = models.CharField(
        max_length=1024, blank=True, default="",
        help_text="Folder the desktop was in when the session started; overrides the workspace root in the prompt.",
    )
    device = models.JSONField(
        default=dict, blank=True,
        help_text="Client machine as reported at creation: os, os_version, arch, shell, locale, app_version.",
    )
    status = models.CharField(
        max_length=20, choices=AgentSessionStatusChoices.choices,
        default=AgentSessionStatusChoices.IDLE, db_index=True,
    )
    running_since = models.DateTimeField(null=True, blank=True)
    step_count = models.PositiveIntegerField(default=0, help_text="Model calls made so far.")
    max_steps = models.PositiveIntegerField(default=50, help_text="Model calls allowed before the session stops.")
    last_error = models.TextField(blank=True, default="")

    class Meta:
        db_table = "ai_control_agent_sessions"
        verbose_name = "Agent Session"
        verbose_name_plural = "Agent Sessions"
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["user", "updated_at"], name="agent_session_user_upd_idx")]

    def __str__(self):
        return f"{self.title or self.id} [{self.status}]"


class AgentMessageModel(BaseModel):
    """
    A user or assistant turn. Tool calls issued by an assistant turn live in
    ``AgentToolCallModel`` (with their results), not here, so the transcript
    has one source of truth per call.
    """

    session = models.ForeignKey(AgentSessionModel, on_delete=models.CASCADE, related_name='messages')
    seq = models.PositiveIntegerField(help_text="Position in the session transcript, from 0.")
    role = models.CharField(max_length=20, choices=AgentMessageRoleChoices.choices)
    content = models.TextField(blank=True, default="")
    skill = models.CharField(
        max_length=64, blank=True, default="",
        help_text="Name of the skill a user message invoked; its instructions are already spliced into content.",
    )
    stop_reason = models.CharField(max_length=40, blank=True, default="")
    is_partial = models.BooleanField(default=False, help_text="True when the stream was cut before the model finished.")
    llm_call = models.ForeignKey(LlmApiCallModel, on_delete=models.SET_NULL, null=True, blank=True, related_name='agent_messages')

    class Meta:
        db_table = "ai_control_agent_messages"
        verbose_name = "Agent Message"
        verbose_name_plural = "Agent Messages"
        ordering = ["seq"]
        constraints = [models.UniqueConstraint(fields=["session", "seq"], name="agent_message_unique_seq")]

    def __str__(self):
        return f"#{self.seq} {self.role}"


class AgentToolCallModel(BaseModel):
    """One tool invocation the model requested, and what the client reported back."""

    session = models.ForeignKey(AgentSessionModel, on_delete=models.CASCADE, related_name='tool_calls')
    message = models.ForeignKey(AgentMessageModel, on_delete=models.CASCADE, related_name='tool_calls')
    tool = models.ForeignKey(
        LlmToolModel, on_delete=models.SET_NULL, null=True, blank=True, related_name='calls',
        help_text="Null when the model asked for a name that is not registered.",
    )
    call_id = models.CharField(max_length=120, help_text="Provider-issued id; results are matched on it.")
    name = models.CharField(max_length=60, db_index=True)
    input = models.JSONField(default=dict)
    risk = models.CharField(max_length=20, choices=LlmToolRiskChoices.choices, default=LlmToolRiskChoices.READ)
    seq_in_message = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20, choices=AgentToolCallStatusChoices.choices,
        default=AgentToolCallStatusChoices.PENDING, db_index=True,
    )
    output = models.TextField(blank=True, default="")
    error = models.TextField(blank=True, default="")
    duration_ms = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = "ai_control_agent_tool_calls"
        verbose_name = "Agent Tool Call"
        verbose_name_plural = "Agent Tool Calls"
        ordering = ["message__seq", "seq_in_message"]
        constraints = [models.UniqueConstraint(fields=["session", "call_id"], name="agent_tool_call_unique_id")]

    def __str__(self):
        return f"{self.name} [{self.status}]"

    @property
    def is_error(self) -> bool:
        return self.status != AgentToolCallStatusChoices.COMPLETED

    def result_content(self) -> str:
        """Text fed back to the model for this call."""
        if self.status == AgentToolCallStatusChoices.COMPLETED:
            return self.output
        return self.error or self.get_status_display()
