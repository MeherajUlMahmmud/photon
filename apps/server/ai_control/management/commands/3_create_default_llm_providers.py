"""
Seed the LLM provider registry (``LlmProviderModel``).

Providers hold endpoints and model defaults only; users add their own API key
per provider in Settings. Existing rows are never overwritten, so re-running is
safe; pass ``--update`` to refresh endpoint/model defaults on existing rows.
"""
from django.core.management.base import BaseCommand

from ai_control.choices import LlmApiStyleChoices, LlmCapabilityChoices, LlmProviderChoices
from ai_control.models import LlmProviderModel

CHAT_JSON_TOOLS = [
    LlmCapabilityChoices.CHAT.value,
    LlmCapabilityChoices.JSON_OUTPUT.value,
    LlmCapabilityChoices.TOOL_CALLING.value,
]

DEFAULT_PROVIDERS = [
    {
        "provider": LlmProviderChoices.ANTHROPIC.value,
        "name": "Anthropic",
        "api_style": LlmApiStyleChoices.ANTHROPIC.value,
        "api_url": "https://api.anthropic.com",
        "default_model": "claude-sonnet-5",
        "model_ids": ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
        "priority": 10,
        "capabilities": CHAT_JSON_TOOLS + [LlmCapabilityChoices.VISION.value],
    },
    {
        "provider": LlmProviderChoices.OPENAI.value,
        "name": "OpenAI",
        "api_style": LlmApiStyleChoices.OPENAI_COMPATIBLE.value,
        "api_url": "https://api.openai.com/v1",
        "default_model": "gpt-5",
        "model_ids": ["gpt-5", "gpt-5-mini", "gpt-4.1"],
        "priority": 20,
        "capabilities": CHAT_JSON_TOOLS + [LlmCapabilityChoices.VISION.value],
    },
    {
        "provider": LlmProviderChoices.NVIDIA.value,
        "name": "NVIDIA NIM",
        "api_style": LlmApiStyleChoices.OPENAI_COMPATIBLE.value,
        "api_url": "https://integrate.api.nvidia.com/v1",
        # meta/llama-3.3-70b-instruct and llama-3.1-nemotron-70b were retired by NVIDIA in 2026.
        "default_model": "nvidia/nemotron-3-super-120b-a12b",
        "model_ids": [
            "nvidia/nemotron-3-super-120b-a12b",
            "nvidia/nemotron-3.5-lightning-30b-a3b",
            "deepseek-ai/deepseek-v4-flash-0731",
            "openai/gpt-oss-20b",
        ],
        "priority": 30,
        "capabilities": CHAT_JSON_TOOLS,
    },
    {
        "provider": LlmProviderChoices.KIMI.value,
        "name": "Kimi (Moonshot)",
        "api_style": LlmApiStyleChoices.OPENAI_COMPATIBLE.value,
        "api_url": "https://api.moonshot.ai/v1",
        "default_model": "kimi-k2-0905-preview",
        "model_ids": ["kimi-k2-0905-preview", "kimi-k2-turbo-preview"],
        "priority": 40,
        "capabilities": CHAT_JSON_TOOLS,
    },
]


class Command(BaseCommand):
    help = 'Create the default LLM provider rows (anthropic, openai, nvidia, kimi)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--update', action='store_true',
            help='Also refresh api_url, default_model, models and capabilities on existing rows',
        )

    def handle(self, *args, **options):
        created_count = updated_count = skipped_count = 0

        for spec in DEFAULT_PROVIDERS:
            provider = spec["provider"]
            existing = LlmProviderModel.objects.filter(provider=provider).first()
            if existing is None:
                LlmProviderModel.objects.create(**spec)
                created_count += 1
                self.stdout.write(self.style.SUCCESS(
                    f"Created: {spec['name']} (model={spec['default_model']}, priority={spec['priority']})"
                ))
                continue

            if options['update']:
                for field in ("name", "api_style", "api_url", "default_model", "model_ids", "capabilities"):
                    setattr(existing, field, spec[field])
                existing.save()
                updated_count += 1
                self.stdout.write(f"Updated: {spec['name']}")
            else:
                skipped_count += 1
                self.stdout.write(f"Already exists: {spec['name']}")

        self.stdout.write(self.style.SUCCESS(
            f"Done. {created_count} created, {updated_count} updated, {skipped_count} skipped."
        ))
