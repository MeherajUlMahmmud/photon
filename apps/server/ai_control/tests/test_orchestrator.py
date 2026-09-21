from decimal import Decimal
from unittest import mock

from django.core.management import call_command
from django.test import TestCase

from ai_control.llm.exceptions import AiUnavailableError
from ai_control.llm.orchestrator import LLMOrchestrator
from ai_control.llm.providers.base import CompletionResult
from ai_control.models import LlmApiCallModel, LlmProviderModel
from user_control.models import UserModel
from user_control.services import SecretService

MESSAGES = [{'role': 'system', 'content': 'Be brief.'}, {'role': 'user', 'content': 'Hi'}]


def _ok(content='hello', usage=None):
    return CompletionResult(content=content, usage=usage or {'input_tokens': 10, 'output_tokens': 5})


class OrchestratorTestsBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('3_create_default_llm_providers', verbosity=0)

    def setUp(self):
        self.user = UserModel.objects.create_user('ada@example.com', 'CorrectHorse1')


class SeedCommandTests(OrchestratorTestsBase):
    def test_seeds_four_providers_in_priority_order(self):
        providers = list(LlmProviderModel.objects.order_by('priority').values_list('provider', flat=True))
        self.assertEqual(providers, ['anthropic', 'openai', 'nvidia', 'kimi'])

    def test_rerun_is_idempotent(self):
        call_command('3_create_default_llm_providers', verbosity=0)
        self.assertEqual(LlmProviderModel.objects.count(), 4)

    def test_update_refreshes_defaults(self):
        LlmProviderModel.objects.filter(provider='kimi').update(default_model='old')
        call_command('3_create_default_llm_providers', '--update', verbosity=0)
        self.assertEqual(LlmProviderModel.objects.get(provider='kimi').default_model, 'kimi-k2-0905-preview')


class RunCompletionTests(OrchestratorTestsBase):
    def test_no_keys_raises_with_helpful_message(self):
        with self.assertRaises(AiUnavailableError) as ctx:
            LLMOrchestrator.run_completion(user=self.user, messages=MESSAGES)
        self.assertIn('No API key saved', str(ctx.exception))
        self.assertEqual(LlmApiCallModel.objects.count(), 0)

    @mock.patch('ai_control.llm.providers.anthropic_provider.AnthropicLLMProvider.complete', return_value=_ok())
    def test_uses_highest_priority_provider_with_key_and_records_call(self, complete):
        SecretService.set_api_key(self.user, 'anthropic', 'sk-ant-x')
        SecretService.set_api_key(self.user, 'kimi', 'sk-kimi-x')
        LlmProviderModel.objects.filter(provider='anthropic').update(
            input_cost_per_million_usd=Decimal('3'), output_cost_per_million_usd=Decimal('15'),
        )

        outcome = LLMOrchestrator.run_completion(user=self.user, messages=MESSAGES, task_key='chat')

        self.assertEqual(outcome.provider, 'anthropic')
        self.assertEqual(outcome.model, 'claude-sonnet-5')
        self.assertEqual(outcome.content, 'hello')
        config = complete.call_args.args[1]
        self.assertEqual(config.api_key, 'sk-ant-x')
        self.assertEqual(config.api_url, 'https://api.anthropic.com')

        call = LlmApiCallModel.objects.get(id=outcome.call_id)
        self.assertEqual(call.user, self.user)
        self.assertEqual(call.status, 'success')
        self.assertEqual(call.total_tokens, 15)
        self.assertEqual(call.cost_usd, Decimal('0.000105'))
        self.assertNotIn('sk-ant-x', call.prompt_text)

    @mock.patch('ai_control.llm.providers.openai_compatible_provider.OpenAICompatibleLLMProvider.complete')
    def test_pinned_provider_and_model(self, complete):
        complete.return_value = _ok('from kimi')
        SecretService.set_api_key(self.user, 'openai', 'sk-o')
        SecretService.set_api_key(self.user, 'kimi', 'sk-k')

        outcome = LLMOrchestrator.run_completion(
            user=self.user, messages=MESSAGES, provider='kimi', model='kimi-k2-turbo-preview',
        )
        self.assertEqual(outcome.provider, 'kimi')
        self.assertEqual(outcome.model, 'kimi-k2-turbo-preview')
        self.assertEqual(complete.call_args.args[1].api_url, 'https://api.moonshot.ai/v1')

    @mock.patch('ai_control.llm.providers.openai_compatible_provider.OpenAICompatibleLLMProvider.complete')
    @mock.patch('ai_control.llm.providers.anthropic_provider.AnthropicLLMProvider.complete', side_effect=RuntimeError('boom'))
    def test_falls_through_to_next_provider_and_records_error(self, anthropic_complete, openai_complete):
        openai_complete.return_value = _ok('from openai')
        SecretService.set_api_key(self.user, 'anthropic', 'sk-a')
        SecretService.set_api_key(self.user, 'openai', 'sk-o')

        outcome = LLMOrchestrator.run_completion(user=self.user, messages=MESSAGES)

        self.assertEqual(outcome.provider, 'openai')
        statuses = list(LlmApiCallModel.objects.order_by('created_at').values_list('provider', 'status'))
        self.assertEqual(statuses, [('anthropic', 'error'), ('openai', 'success')])
        error_call = LlmApiCallModel.objects.get(status='error')
        self.assertEqual(error_call.error_type, 'RuntimeError')
        self.assertTrue(error_call.prompt_metadata['candidates'])

    @mock.patch('ai_control.llm.providers.openai_compatible_provider.OpenAICompatibleLLMProvider.complete', side_effect=RuntimeError('down'))
    def test_all_fail_raises(self, complete):
        SecretService.set_api_key(self.user, 'openai', 'sk-o')
        with self.assertRaises(AiUnavailableError):
            LLMOrchestrator.run_completion(user=self.user, messages=MESSAGES)


def _stream(chunks, result=None, fail_after=None):
    """Generator factory mimicking ``complete_stream``: yields chunks, returns a result."""
    def gen(*args, **kwargs):
        for i, chunk in enumerate(chunks):
            if fail_after is not None and i == fail_after:
                raise RuntimeError('cut')
            yield chunk
        return result or _ok(''.join(chunks))
    return gen


class StreamCompletionTests(OrchestratorTestsBase):
    @mock.patch('ai_control.llm.providers.anthropic_provider.AnthropicLLMProvider.complete_stream', new=_stream(['hel', 'lo']))
    def test_streams_deltas_then_done_and_records_call(self):
        SecretService.set_api_key(self.user, 'anthropic', 'sk-a')

        events = list(LLMOrchestrator.stream_completion(user=self.user, messages=MESSAGES))

        self.assertEqual([e['type'] for e in events], ['start', 'delta', 'delta', 'done'])
        self.assertEqual(events[0]['provider'], 'anthropic')
        self.assertEqual(''.join(e['text'] for e in events if e['type'] == 'delta'), 'hello')
        call = LlmApiCallModel.objects.get(id=events[-1]['call_id'])
        self.assertEqual(call.status, 'success')
        self.assertEqual(call.response_text, 'hello')
        self.assertTrue(call.prompt_metadata['streamed'])

    @mock.patch('ai_control.llm.providers.openai_compatible_provider.OpenAICompatibleLLMProvider.complete_stream', new=_stream(['ok']))
    @mock.patch('ai_control.llm.providers.anthropic_provider.AnthropicLLMProvider.complete_stream', new=_stream(['x'], fail_after=0))
    def test_falls_through_when_provider_fails_before_first_delta(self):
        SecretService.set_api_key(self.user, 'anthropic', 'sk-a')
        SecretService.set_api_key(self.user, 'openai', 'sk-o')

        events = list(LLMOrchestrator.stream_completion(user=self.user, messages=MESSAGES))

        self.assertEqual([e['type'] for e in events], ['start', 'delta', 'done'])
        self.assertEqual(events[0]['provider'], 'openai')
        statuses = list(LlmApiCallModel.objects.order_by('created_at').values_list('provider', 'status'))
        self.assertEqual(statuses, [('anthropic', 'error'), ('openai', 'success')])

    @mock.patch('ai_control.llm.providers.openai_compatible_provider.OpenAICompatibleLLMProvider.complete_stream', new=_stream(['ok']))
    @mock.patch('ai_control.llm.providers.anthropic_provider.AnthropicLLMProvider.complete_stream', new=_stream(['a', 'b'], fail_after=1))
    def test_mid_stream_failure_ends_with_error_and_no_fallback(self):
        SecretService.set_api_key(self.user, 'anthropic', 'sk-a')
        SecretService.set_api_key(self.user, 'openai', 'sk-o')

        events = list(LLMOrchestrator.stream_completion(user=self.user, messages=MESSAGES))

        self.assertEqual([e['type'] for e in events], ['start', 'delta', 'error'])
        self.assertIn('anthropic stopped answering', events[-1]['message'])
        error_call = LlmApiCallModel.objects.get(status='error')
        self.assertEqual(error_call.prompt_metadata['partial_chars'], 1)
        self.assertFalse(LlmApiCallModel.objects.filter(provider='openai').exists())

    def test_no_keys_yields_single_error(self):
        events = list(LLMOrchestrator.stream_completion(user=self.user, messages=MESSAGES))
        self.assertEqual([e['type'] for e in events], ['error'])
        self.assertIn('No API key saved', events[0]['message'])
