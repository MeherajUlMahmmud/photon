from decimal import Decimal, InvalidOperation
import uuid

from django.db import models

from ai_control.choices import (
    LlmApiStyleChoices,
    LlmCallStatusChoices,
    LlmCapabilityChoices,
    LlmProviderChoices,
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
