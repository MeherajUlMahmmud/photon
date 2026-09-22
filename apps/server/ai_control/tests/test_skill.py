"""
Skills: parsing pasted Markdown, the CRUD endpoints, and invocation through
the agent step and completion endpoints (provider stream mocked).
"""
import json
from unittest import mock

from django.core.cache import cache
from django.core.management import call_command
from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from ai_control.llm.orchestrator import LLMOrchestrator
from ai_control.llm.providers.base import CompletionResult
from ai_control.models import AgentSessionModel, SkillModel
from ai_control.services import SkillError, SkillService
from ai_control.tests.test_agent import STREAM_PATCH, _events, _reply
from user_control.models import UserModel
from user_control.services import SecretService
from workspace_control.models import WorkspaceModel

REVIEW_MD = """---
name: review
description: "Review a diff for bugs"
---
# Code review

Review $ARGUMENTS for correctness. List findings, worst first.
"""

PLAIN_MD = """# Daily Standup

Summarise what changed since yesterday.

Keep it to three bullets.
"""


class SkillParseTests(SimpleTestCase):
    def test_front_matter_gives_name_and_description(self):
        parsed = SkillService.parse(REVIEW_MD)
        self.assertEqual(parsed.name, 'review')
        self.assertEqual(parsed.description, 'Review a diff for bugs')
        self.assertTrue(parsed.content.startswith('# Code review'))
        self.assertNotIn('---', parsed.content)

    def test_heading_and_first_paragraph_are_the_fallback(self):
        parsed = SkillService.parse(PLAIN_MD)
        self.assertEqual(parsed.name, 'daily-standup')
        self.assertEqual(parsed.description, 'Summarise what changed since yesterday.')
        self.assertEqual(parsed.content, PLAIN_MD.strip())

    def test_explicit_name_wins_and_is_slugified(self):
        self.assertEqual(SkillService.parse(REVIEW_MD, name='Deep Review').name, 'deep-review')

    def test_folded_description_and_crlf(self):
        md = "---\r\nname: x\r\ndescription: >\r\n  one\r\n  two\r\n---\r\nBody\r\n"
        parsed = SkillService.parse(md)
        self.assertEqual(parsed.description, 'one two')
        self.assertEqual(parsed.content, 'Body')

    def test_rejects_empty_nameless_and_bodyless(self):
        with self.assertRaises(SkillError):
            SkillService.parse('   ')
        with self.assertRaises(SkillError):
            SkillService.parse('just some text without a heading')
        with self.assertRaises(SkillError):
            SkillService.parse('---\nname: empty\n---\n')

    def test_render_substitutes_or_appends_arguments(self):
        skill = SkillModel(name='review', content='Review $ARGUMENTS carefully.')
        self.assertIn('Review src/a.py carefully.', SkillService.render(skill, 'src/a.py'))
        self.assertNotIn('$ARGUMENTS', SkillService.render(skill, ''))
        plain = SkillModel(name='standup', content='Summarise.')
        rendered = SkillService.render(plain, 'since Monday')
        self.assertTrue(rendered.startswith('The user invoked the /standup skill.'))
        self.assertIn('<skill name="standup">\nSummarise.\n</skill>\n\nsince Monday', rendered)
        self.assertTrue(SkillService.render(plain, '').endswith('</skill>'))


class SkillApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = UserModel.objects.create_user('alice@example.com', 'CorrectHorse1')
        self.bob = UserModel.objects.create_user('bob@example.com', 'CorrectHorse1')
        self.client.force_authenticate(self.alice)

    def install(self, markdown=REVIEW_MD, **extra):
        return self.client.post('/api/ai/skill/install/', {'markdown': markdown, **extra}, format='json')

    def test_install_list_details(self):
        res = self.install()
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()['data']
        self.assertEqual(data['name'], 'review')
        self.assertEqual(data['description'], 'Review a diff for bugs')

        rows = self.client.get('/api/ai/skill/list/').json()['data']
        self.assertEqual([r['name'] for r in rows], ['review'])
        self.assertEqual(self.client.get('/api/ai/skill/review/details/').json()['data']['name'], 'review')

    def test_duplicate_needs_replace(self):
        self.install()
        self.assertEqual(self.install().status_code, 400)
        res = self.install(REVIEW_MD.replace('worst first', 'best first'), replace=True)
        self.assertEqual(res.status_code, 201)
        self.assertIn('best first', SkillModel.objects.get(user=self.alice, name='review').content)
        self.assertEqual(SkillModel.objects.filter(user=self.alice).count(), 1)

    def test_bad_file_is_400_with_reason(self):
        res = self.install('no heading here')
        self.assertEqual(res.status_code, 400)
        self.assertIn('name', res.json()['message'])

    def test_update_renames_and_delete_removes(self):
        self.install()
        res = self.client.put(
            '/api/ai/skill/review/update/', {'markdown': REVIEW_MD.replace('name: review', 'name: audit')}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['data']['name'], 'audit')
        self.assertEqual(self.client.get('/api/ai/skill/review/details/').status_code, 404)

        self.assertEqual(self.client.delete('/api/ai/skill/audit/delete/').status_code, 200)
        self.assertFalse(SkillModel.objects.filter(user=self.alice).exists())
        self.assertEqual(self.client.delete('/api/ai/skill/audit/delete/').status_code, 404)

    def test_scoped_to_owner(self):
        self.install()
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.get('/api/ai/skill/list/').json().get('data', []), [])
        self.assertEqual(self.client.get('/api/ai/skill/review/details/').status_code, 404)
        # Bob may install his own /review.
        self.assertEqual(self.install().status_code, 201)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/ai/skill/list/').status_code, 401)


class SkillInvocationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('3_create_default_llm_providers', verbosity=0)
        call_command('4_create_default_llm_tools', verbosity=0)

    def setUp(self):
        cache.clear()
        self.alice = UserModel.objects.create_user('alice@example.com', 'CorrectHorse1')
        SecretService.set_api_key(self.alice, 'anthropic', 'sk-a')
        self.workspace = WorkspaceModel.objects.create(
            user=self.alice, name='photon', root_path='/Users/alice/photon', last_opened_at=timezone.now(),
        )
        self.client.force_authenticate(self.alice)
        SkillService.install(self.alice, REVIEW_MD)

    def create_session(self):
        res = self.client.post('/api/ai/agent/session/create/', {'workspace_id': str(self.workspace.id)}, format='json')
        return res.json()['data']['id']

    def step(self, sid, body):
        res = self.client.post(f'/api/ai/agent/session/{sid}/step/stream/', body, format='json')
        if getattr(res, 'streaming', False):
            raw = b''.join(res.streaming_content).decode()
            res.events = [json.loads(line) for line in raw.splitlines() if line]
        else:
            res.events = []
        return res

    @mock.patch(STREAM_PATCH, new=_reply('Looks fine.'))
    def test_agent_step_expands_skill_into_user_turn(self):
        sid = self.create_session()
        with mock.patch.object(LLMOrchestrator, 'stream_completion', wraps=LLMOrchestrator.stream_completion) as spy:
            res = self.step(sid, {'content': 'src/agent.ts', 'skill': 'review'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(_events(res)[-1]['stop_reason'], 'end_turn')

        sent = spy.call_args.kwargs['messages']
        self.assertEqual(sent[1]['role'], 'user')
        self.assertIn('<skill name="review">', sent[1]['content'])
        self.assertIn('Review src/agent.ts for correctness.', sent[1]['content'])

        session = AgentSessionModel.objects.get(id=sid)
        self.assertEqual(session.title, '/review src/agent.ts')
        user_msg = session.messages.get(seq=0)
        self.assertEqual(user_msg.skill, 'review')
        self.assertIn('<skill name="review">', user_msg.content)
        details = self.client.get(f'/api/ai/agent/session/{sid}/details/').json()['data']
        self.assertEqual(details['messages'][0]['skill'], 'review')

    @mock.patch(STREAM_PATCH, new=_reply('ok'))
    def test_skill_alone_allows_blank_content(self):
        sid = self.create_session()
        res = self.step(sid, {'content': '', 'skill': 'review'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(AgentSessionModel.objects.get(id=sid).title, '/review')

    def test_blank_content_without_skill_is_400(self):
        sid = self.create_session()
        self.assertEqual(self.step(sid, {'content': '   '}).status_code, 400)

    def test_unknown_skill_is_400_and_session_stays_idle(self):
        sid = self.create_session()
        res = self.step(sid, {'content': 'x', 'skill': 'nope'})
        self.assertEqual(res.status_code, 400)
        self.assertIn('/nope', res.json()['message'])
        session = AgentSessionModel.objects.get(id=sid)
        self.assertEqual(session.status, 'idle')
        self.assertEqual(session.messages.count(), 0)

    def test_skill_with_tool_results_is_400(self):
        sid = self.create_session()
        res = self.step(sid, {'tool_results': [], 'skill': 'review'})
        self.assertEqual(res.status_code, 400)

    @mock.patch('ai_control.llm.providers.anthropic_provider.AnthropicLLMProvider.complete')
    def test_completion_expands_skill_on_user_messages(self, complete):
        complete.return_value = CompletionResult(content='done', usage={}, tool_calls=[], stop_reason='end_turn')
        res = self.client.post(
            '/api/ai/completion/create/',
            {'messages': [
                {'role': 'system', 'content': 'sys'},
                {'role': 'user', 'content': 'a.py', 'skill': 'review'},
                {'role': 'assistant', 'content': 'ok'},
                {'role': 'user', 'content': 'thanks'},
            ]},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        sent = complete.call_args[0][0]
        self.assertIn('Review a.py for correctness.', sent[1]['content'])
        self.assertNotIn('skill', sent[1])
        self.assertEqual(sent[3]['content'], 'thanks')

    def test_completion_unknown_skill_is_404_and_non_user_skill_is_400(self):
        res = self.client.post(
            '/api/ai/completion/create/', {'messages': [{'role': 'user', 'content': 'x', 'skill': 'nope'}]}, format='json',
        )
        self.assertEqual(res.status_code, 404)
        res = self.client.post(
            '/api/ai/completion/create/',
            {'messages': [{'role': 'system', 'content': 'x', 'skill': 'review'}, {'role': 'user', 'content': 'y'}]},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
