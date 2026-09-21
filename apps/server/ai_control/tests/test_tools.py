from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APITestCase

from ai_control.models import LlmToolModel
from user_control.models import UserModel


class SeedToolsCommandTests(TestCase):
    def test_seeds_five_tools_in_priority_order(self):
        call_command('4_create_default_llm_tools', verbosity=0)
        names = list(LlmToolModel.objects.order_by('priority').values_list('name', flat=True))
        self.assertEqual(names, ['ls', 'cs', 'read_file', 'write_file', 'bash'])
        bash = LlmToolModel.objects.get(name='bash')
        self.assertEqual(bash.risk, 'shell')
        self.assertEqual(bash.executor, 'client')
        self.assertEqual(bash.task_keys, ['agent'])
        self.assertEqual(bash.input_schema['required'], ['command'])

    def test_rerun_is_idempotent_and_update_refreshes(self):
        call_command('4_create_default_llm_tools', verbosity=0)
        LlmToolModel.objects.filter(name='ls').update(description='stale', risk='shell')
        call_command('4_create_default_llm_tools', verbosity=0)
        self.assertEqual(LlmToolModel.objects.get(name='ls').description, 'stale')
        call_command('4_create_default_llm_tools', '--update', verbosity=0)
        ls = LlmToolModel.objects.get(name='ls')
        self.assertNotEqual(ls.description, 'stale')
        self.assertEqual(ls.risk, 'read')
        self.assertEqual(LlmToolModel.objects.count(), 5)

    def test_schema_for_model_and_task_filter(self):
        tool = LlmToolModel.objects.create(
            name='t', label='T', description='d', input_schema={'type': 'object'}, task_keys=['agent'],
        )
        self.assertEqual(tool.schema_for_model(), {'name': 't', 'description': 'd', 'input_schema': {'type': 'object'}})
        self.assertTrue(tool.offered_for('agent'))
        self.assertFalse(tool.offered_for('chat'))
        tool.task_keys = []
        self.assertTrue(tool.offered_for('chat'))


class ToolListApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('4_create_default_llm_tools', verbosity=0)

    def setUp(self):
        self.user = UserModel.objects.create_user('alice@example.com', 'CorrectHorse1')
        self.client.force_authenticate(self.user)

    def test_lists_active_tools(self):
        LlmToolModel.objects.filter(name='bash').update(is_active=False)
        res = self.client.get('/api/ai/tool/list/')
        self.assertEqual(res.status_code, 200)
        names = [t['name'] for t in res.json()['data']]
        self.assertEqual(names, ['ls', 'cs', 'read_file', 'write_file'])
        self.assertIn('input_schema', res.json()['data'][0])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/ai/tool/list/').status_code, 401)
