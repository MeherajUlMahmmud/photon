from unittest import mock

from django.core.cache import cache
from django.core.management import call_command
from rest_framework.test import APITestCase

from ai_control.llm.providers.base import CompletionResult
from ai_control.models import LlmApiCallModel
from user_control.models import UserModel
from user_control.services import SecretService


class AiApiTestsBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('3_create_default_llm_providers', verbosity=0)

    def setUp(self):
        cache.clear()
        self.alice = UserModel.objects.create_user('alice@example.com', 'CorrectHorse1')
        self.bob = UserModel.objects.create_user('bob@example.com', 'CorrectHorse1')
        self.client.force_authenticate(self.alice)


class LlmProviderListTests(AiApiTestsBase):
    def test_lists_providers_with_has_key_flag(self):
        SecretService.set_api_key(self.alice, 'openai', 'sk-o')
        res = self.client.get('/api/ai/provider/list/')
        self.assertEqual(res.status_code, 200)
        rows = res.json()['data']
        self.assertEqual([r['provider'] for r in rows], ['anthropic', 'openai', 'nvidia', 'kimi'])
        by_provider = {r['provider']: r for r in rows}
        self.assertTrue(by_provider['openai']['has_key'])
        self.assertFalse(by_provider['anthropic']['has_key'])
        self.assertIn('kimi-k2-0905-preview', by_provider['kimi']['model_ids'])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/ai/provider/list/').status_code, 401)


class CompletionTests(AiApiTestsBase):
    URL = '/api/ai/completion/create/'

    def test_validation(self):
        res = self.client.post(self.URL, {'messages': []}, format='json')
        self.assertEqual(res.status_code, 400)

        res = self.client.post(self.URL, {'messages': [{'role': 'system', 'content': 'x'}]}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('user message', res.json()['message'])

        res = self.client.post(
            self.URL, {'messages': [{'role': 'user', 'content': 'x'}], 'model': 'gpt-5'}, format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('provider', res.json()['errors'])

    def test_no_key_is_503(self):
        res = self.client.post(self.URL, {'messages': [{'role': 'user', 'content': 'hi'}]}, format='json')
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()['status'], 'error')

    @mock.patch('ai_control.llm.providers.openai_compatible_provider.OpenAICompatibleLLMProvider.complete')
    def test_completion_success(self, complete):
        complete.return_value = CompletionResult(content='42', usage={'input_tokens': 3, 'output_tokens': 1, 'total_tokens': 4})
        SecretService.set_api_key(self.alice, 'nvidia', 'nvapi-x')

        res = self.client.post(
            self.URL,
            {
                'messages': [{'role': 'user', 'content': 'meaning of life?'}],
                'provider': 'nvidia',
                'temperature': 0.7,
                'max_tokens': 64,
                'trace_id': 'run-1',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()['data']
        self.assertEqual(data['content'], '42')
        self.assertEqual(data['provider'], 'nvidia')
        self.assertEqual(data['model'], 'nvidia/nemotron-3-super-120b-a12b')
        self.assertEqual(data['usage']['total_tokens'], 4)
        self.assertEqual(complete.call_args.kwargs['llm_config'], {'temperature': 0.7, 'max_tokens': 64})

        call = LlmApiCallModel.objects.get(id=data['call_id'])
        self.assertEqual(call.trace_id, 'run-1')
        self.assertEqual(call.user, self.alice)


class LlmApiCallListTests(AiApiTestsBase):
    def setUp(self):
        super().setUp()
        LlmApiCallModel.objects.create(user=self.alice, provider='openai', model='gpt-5', prompt_text='p', response_text='r')
        LlmApiCallModel.objects.create(user=self.alice, provider='kimi', model='k', prompt_text='p', status='error', error_type='X')
        LlmApiCallModel.objects.create(user=self.bob, provider='openai', model='gpt-5', prompt_text='secret', response_text='r')

    def test_list_is_per_user_and_filterable(self):
        res = self.client.get('/api/ai/call/list/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['data']['total_records'], 2)

        res = self.client.get('/api/ai/call/list/?status=error')
        self.assertEqual([r['provider'] for r in res.json()['data']['data']], ['kimi'])

    def test_details_hidden_across_users(self):
        bobs = LlmApiCallModel.objects.get(user=self.bob)
        self.assertEqual(self.client.get(f'/api/ai/call/{bobs.id}/details/').status_code, 404)

        mine = LlmApiCallModel.objects.filter(user=self.alice).first()
        res = self.client.get(f'/api/ai/call/{mine.id}/details/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('prompt_text', res.json()['data'])
