"""
Agent session protocol through the API, with the orchestrator's provider
stream mocked: create -> content step -> tool_use -> tool_results -> end_turn.
"""
import datetime as dt
import json
from unittest import mock

from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APITestCase

from ai_control.llm.orchestrator import LLMOrchestrator
from ai_control.llm.providers.base import CompletionResult, ToolCall
from ai_control.models import AgentSessionModel, AgentToolCallModel, LlmApiCallModel
from ai_control.services import AgentSessionService
from user_control.models import UserModel
from user_control.services import SecretService
from workspace_control.models import WorkspaceModel

STREAM_PATCH = 'ai_control.llm.providers.anthropic_provider.AnthropicLLMProvider.complete_stream'


def _reply(text='', calls=(), stop=None):
    """A fake ``complete_stream``: yields ``text`` in one chunk, returns the result."""
    tool_calls = [ToolCall(id=i, name=n, input=a) for i, n, a in calls]
    stop_reason = stop or ('tool_use' if tool_calls else 'end_turn')

    def gen(*args, **kwargs):
        if text:
            yield text
        return CompletionResult(
            content=text or None, usage={'input_tokens': 2, 'output_tokens': 3},
            tool_calls=tool_calls, stop_reason=stop_reason, raw_stop_reason=stop_reason,
        )
    return gen


def _events(response):
    return response.events


class AgentApiTestsBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('3_create_default_llm_providers', verbosity=0)
        call_command('4_create_default_llm_tools', verbosity=0)

    def setUp(self):
        cache.clear()
        self.alice = UserModel.objects.create_user('alice@example.com', 'CorrectHorse1')
        self.bob = UserModel.objects.create_user('bob@example.com', 'CorrectHorse1')
        SecretService.set_api_key(self.alice, 'anthropic', 'sk-a')
        self.workspace = WorkspaceModel.objects.create(
            user=self.alice, name='photon', root_path='/Users/alice/photon', last_opened_at=timezone.now(),
        )
        self.client.force_authenticate(self.alice)

    def create_session(self, **body):
        res = self.client.post('/api/ai/agent/session/create/', {'workspace_id': str(self.workspace.id), **body}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()['data']['id']

    def step(self, session_id, body):
        # The desktop sends this Accept header; the view must not 406 on it.
        res = self.client.post(
            f'/api/ai/agent/session/{session_id}/step/stream/', body, format='json', HTTP_ACCEPT='application/x-ndjson',
        )
        # The step runs while the body streams, so drain it like a client would.
        if getattr(res, 'streaming', False):
            raw = b''.join(res.streaming_content).decode()
            res.events = [json.loads(line) for line in raw.splitlines() if line]
        else:
            res.events = []
        return res


class SessionCreateTests(AgentApiTestsBase):
    def test_creates_with_workspace_prompt(self):
        sid = self.create_session()
        session = AgentSessionModel.objects.get(id=sid)
        self.assertEqual(session.workspace, self.workspace)
        self.assertEqual(session.status, 'idle')
        self.assertIn('/Users/alice/photon', session.system_prompt)
        self.assertEqual(session.task_key, 'agent')

    def test_rejects_foreign_workspace(self):
        other = WorkspaceModel.objects.create(user=self.bob, name='x', root_path='/x', last_opened_at=timezone.now())
        res = self.client.post('/api/ai/agent/session/create/', {'workspace_id': str(other.id)}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_model_requires_provider(self):
        res = self.client.post('/api/ai/agent/session/create/', {'model': 'claude-opus-5'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_device_shapes_prompt_and_is_stored(self):
        device = {'os': 'darwin', 'os_version': '15.5', 'arch': 'arm64', 'shell': 'zsh', 'locale': 'en-US', 'app_version': '0.1.0'}
        res = self.client.post(
            '/api/ai/agent/session/create/', {'workspace_id': str(self.workspace.id), 'device': device}, format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['data']['device'], device)
        session = AgentSessionModel.objects.get(id=res.json()['data']['id'])
        self.assertEqual(session.device, device)
        self.assertIn('macOS 15.5 (arm64)', session.system_prompt)
        self.assertIn('run in zsh', session.system_prompt)
        self.assertIn('BSD, not GNU', session.system_prompt)
        self.assertIn('en-US', session.system_prompt)
        # Workspace line stays ahead of the environment paragraph.
        self.assertLess(session.system_prompt.index('/Users/alice/photon'), session.system_prompt.index('Environment:'))

    def test_windows_device_gets_powershell_guidance(self):
        res = self.client.post(
            '/api/ai/agent/session/create/',
            {'device': {'os': 'win32', 'os_version': '10.0.22631', 'arch': 'x64', 'shell': 'powershell'}}, format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        prompt = AgentSessionModel.objects.get(id=res.json()['data']['id']).system_prompt
        self.assertIn('Windows 10.0.22631 (x64)', prompt)
        self.assertIn('PowerShell cmdlets', prompt)
        self.assertNotIn('BSD', prompt)

    def test_no_device_keeps_prompt_environment_free(self):
        sid = self.create_session()
        session = AgentSessionModel.objects.get(id=sid)
        self.assertEqual(session.device, {})
        self.assertNotIn('Environment:', session.system_prompt)

    def test_workspace_path_overrides_root_in_prompt(self):
        res = self.client.post(
            '/api/ai/agent/session/create/',
            {'workspace_id': str(self.workspace.id), 'workspace_path': '/Volumes/work/photon'}, format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        session = AgentSessionModel.objects.get(id=res.json()['data']['id'])
        self.assertEqual(session.workspace_path, '/Volumes/work/photon')
        self.assertIn('Workspace: photon (root: /Volumes/work/photon).', session.system_prompt)
        self.assertNotIn('/Users/alice/photon', session.system_prompt)

    def test_update_repins_model(self):
        sid = self.create_session()
        res = self.client.post(f'/api/ai/agent/session/{sid}/update/', {'provider': 'anthropic', 'model': 'claude-opus-5'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        session = AgentSessionModel.objects.get(id=sid)
        self.assertEqual((session.provider, session.model), ('anthropic', 'claude-opus-5'))
        res = self.client.post(f'/api/ai/agent/session/{sid}/update/', {'model': 'x'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_step_errors_are_json_under_ndjson_accept(self):
        sid = self.create_session()
        res = self.step(sid, {'tool_results': [{'call_id': 'nope', 'ok': True}]})
        self.assertEqual(res.status_code, 400)
        self.assertIn('not waiting for tool results', res.json()['message'])

    def test_template_noise_is_stripped_from_tool_names(self):
        sid = self.create_session()
        with mock.patch(STREAM_PATCH, new=_reply(calls=[('t1', 'cs<|channel|>analysis', {'query': 'x'})])):
            res = self.step(sid, {'content': 'search'})
        done = _events(res)[-1]
        self.assertEqual(done['stop_reason'], 'tool_use')
        self.assertEqual(done['pending_tool_calls'][0]['name'], 'cs')
        self.assertEqual(AgentToolCallModel.objects.get(call_id='t1').name, 'cs')

    def test_all_unknown_tools_wait_for_an_empty_results_step(self):
        sid = self.create_session()
        with mock.patch(STREAM_PATCH, new=_reply(calls=[('t1', 'nope', {})])):
            res = self.step(sid, {'content': 'go'})
        done = _events(res)[-1]
        self.assertEqual(done['stop_reason'], 'tool_use')
        self.assertEqual(done['pending_tool_calls'], [])
        self.assertEqual(done['rejected_tool_calls'][0]['name'], 'nope')
        self.assertIn("Unknown tool 'nope'", done['rejected_tool_calls'][0]['error'])
        self.assertEqual(AgentSessionModel.objects.get(id=sid).status, 'awaiting_tools')

        # The client continues with nothing to report; the model sees the rejection and answers.
        with mock.patch(STREAM_PATCH, new=_reply('Sorry, no such tool.')):
            res = self.step(sid, {'tool_results': []})
        self.assertEqual(_events(res)[-1]['stop_reason'], 'end_turn')
        self.assertEqual(AgentSessionModel.objects.get(id=sid).status, 'idle')

    def test_rejects_unknown_os(self):
        res = self.client.post('/api/ai/agent/session/create/', {'device': {'os': 'plan9'}}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/ai/agent/session/create/', {'device': {'shell': 'zsh'}}, format='json')
        self.assertEqual(res.status_code, 400)


class StepLoopTests(AgentApiTestsBase):
    @mock.patch(STREAM_PATCH, new=_reply('Looking.', calls=[('t1', 'ls', {'path': '.'})]))
    def test_content_step_streams_and_waits_for_tools(self):
        sid = self.create_session()
        res = self.step(sid, {'content': 'What is in this repo?'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'application/x-ndjson')
        events = _events(res)
        self.assertEqual([e['type'] for e in events], ['start', 'delta', 'tool_call', 'done'])
        done = events[-1]
        self.assertEqual(done['stop_reason'], 'tool_use')
        self.assertEqual(done['pending_tool_calls'], [{'call_id': 't1', 'name': 'ls', 'input': {'path': '.'}, 'risk': 'read'}])
        self.assertEqual(done['step_count'], 1)

        session = AgentSessionModel.objects.get(id=sid)
        self.assertEqual(session.status, 'awaiting_tools')
        self.assertEqual(session.title, 'What is in this repo?')
        self.assertIsNone(session.running_since)
        roles = list(session.messages.order_by('seq').values_list('seq', 'role', 'content'))
        self.assertEqual(roles, [(0, 'user', 'What is in this repo?'), (1, 'assistant', 'Looking.')])
        call = AgentToolCallModel.objects.get(session=session)
        self.assertEqual(call.status, 'pending')
        self.assertEqual(call.tool.name, 'ls')
        self.assertEqual(session.messages.get(seq=1).llm_call, LlmApiCallModel.objects.get())

    def test_full_loop_feeds_results_back_and_ends_turn(self):
        sid = self.create_session()
        with mock.patch(STREAM_PATCH, new=_reply(calls=[('t1', 'ls', {'path': '.'})])):
            self.step(sid, {'content': 'List files'})

        with mock.patch(STREAM_PATCH, new=_reply('Two files: a.py, b.py')):
            with mock.patch.object(LLMOrchestrator, 'stream_completion', wraps=LLMOrchestrator.stream_completion) as spy:
                res = self.step(sid, {'tool_results': [{'call_id': 't1', 'ok': True, 'output': 'a.py\nb.py'}]})
        events = _events(res)
        self.assertEqual([e['type'] for e in events], ['start', 'delta', 'done'])
        self.assertEqual(events[-1]['stop_reason'], 'end_turn')
        self.assertEqual(events[-1]['pending_tool_calls'], [])

        # The transcript sent to the model carried the grouped tool result.
        sent = spy.call_args.kwargs['messages']
        self.assertEqual([m['role'] for m in sent], ['system', 'user', 'assistant', 'tool_results'])
        self.assertEqual(sent[2]['tool_calls'][0]['id'], 't1')
        self.assertEqual(sent[3]['results'], [{'call_id': 't1', 'name': 'ls', 'content': 'a.py\nb.py', 'is_error': False}])
        self.assertEqual(spy.call_args.kwargs['tools'][0]['name'], 'ls')

        session = AgentSessionModel.objects.get(id=sid)
        self.assertEqual(session.status, 'idle')
        self.assertEqual(session.step_count, 2)
        self.assertEqual(AgentToolCallModel.objects.get(call_id='t1').status, 'completed')

    def test_denied_and_failed_results_are_recorded_as_errors(self):
        sid = self.create_session()
        with mock.patch(STREAM_PATCH, new=_reply(calls=[('a', 'bash', {'command': 'rm -rf /'}), ('b', 'ls', {})])):
            self.step(sid, {'content': 'go'})
        with mock.patch(STREAM_PATCH, new=_reply('ok')):
            res = self.step(sid, {'tool_results': [
                {'call_id': 'a', 'ok': False, 'error': 'denied'},
                {'call_id': 'b', 'ok': False, 'error': 'ENOENT'},
            ]})
        self.assertEqual(_events(res)[-1]['stop_reason'], 'end_turn')
        self.assertEqual(AgentToolCallModel.objects.get(call_id='a').status, 'denied')
        b = AgentToolCallModel.objects.get(call_id='b')
        self.assertEqual(b.status, 'failed')
        self.assertEqual(b.error, 'ENOENT')
        msgs = AgentSessionService.build_messages(AgentSessionModel.objects.get(id=sid))
        results = msgs[3]['results']
        self.assertTrue(all(r['is_error'] for r in results))
        self.assertIn('denied', results[0]['content'])

    @mock.patch(STREAM_PATCH, new=_reply(calls=[('t1', 'teleport', {})]))
    def test_unknown_tool_is_answered_by_server(self):
        sid = self.create_session()
        events = _events(self.step(sid, {'content': 'go'}))
        self.assertEqual(events[-1]['pending_tool_calls'], [])
        call = AgentToolCallModel.objects.get(call_id='t1')
        self.assertEqual(call.status, 'failed')
        self.assertIsNone(call.tool)
        self.assertIn('Unknown tool', call.error)
        # The rejection is part of the transcript the model sees next.
        msgs = AgentSessionService.build_messages(AgentSessionModel.objects.get(id=sid))
        self.assertEqual(msgs[-1]['role'], 'tool_results')
        self.assertTrue(msgs[-1]['results'][0]['is_error'])

    @mock.patch(STREAM_PATCH, new=_reply('hi'))
    def test_non_stream_twin_returns_final_event(self):
        sid = self.create_session()
        res = self.client.post(f'/api/ai/agent/session/{sid}/step/create/', {'content': 'hello'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()['data']
        self.assertEqual(data['stop_reason'], 'end_turn')
        self.assertEqual(data['content'], 'hi')


class StepValidationTests(AgentApiTestsBase):
    def _await_tools(self):
        sid = self.create_session()
        with mock.patch(STREAM_PATCH, new=_reply(calls=[('t1', 'ls', {}), ('t2', 'cs', {'query': 'x'})])):
            self.step(sid, {'content': 'go'})
        return sid

    def test_body_must_have_exactly_one_kind(self):
        sid = self.create_session()
        self.assertEqual(self.step(sid, {}).status_code, 400)
        self.assertEqual(self.step(sid, {'content': 'a', 'tool_results': [{'call_id': 'x', 'ok': True}]}).status_code, 400)

    def test_tool_results_rejected_when_idle(self):
        sid = self.create_session()
        res = self.step(sid, {'tool_results': [{'call_id': 'x', 'ok': True}]})
        self.assertEqual(res.status_code, 400)
        self.assertIn('not waiting', res.json()['message'])

    def test_partial_unknown_and_duplicate_results_rejected(self):
        sid = self._await_tools()
        partial = self.step(sid, {'tool_results': [{'call_id': 't1', 'ok': True, 'output': ''}]})
        self.assertEqual(partial.status_code, 400)
        self.assertIn('t2', partial.json()['message'])
        unknown = self.step(sid, {'tool_results': [
            {'call_id': 't1', 'ok': True}, {'call_id': 't2', 'ok': True}, {'call_id': 'zz', 'ok': True},
        ]})
        self.assertEqual(unknown.status_code, 400)
        dup = self.step(sid, {'tool_results': [
            {'call_id': 't1', 'ok': True}, {'call_id': 't1', 'ok': True},
        ]})
        self.assertEqual(dup.status_code, 400)
        # Nothing changed: still awaiting both.
        self.assertEqual(AgentToolCallModel.objects.filter(session_id=sid, status='pending').count(), 2)
        self.assertEqual(AgentSessionModel.objects.get(id=sid).status, 'awaiting_tools')

    def test_content_while_awaiting_cancels_pending_and_proceeds(self):
        sid = self._await_tools()
        with mock.patch(STREAM_PATCH, new=_reply('fine')):
            res = self.step(sid, {'content': 'never mind'})
        self.assertEqual(_events(res)[-1]['stop_reason'], 'end_turn')
        statuses = set(AgentToolCallModel.objects.filter(session_id=sid).values_list('status', flat=True))
        self.assertEqual(statuses, {'cancelled'})
        msgs = AgentSessionService.build_messages(AgentSessionModel.objects.get(id=sid))
        self.assertEqual([m['role'] for m in msgs], ['system', 'user', 'assistant', 'tool_results', 'user', 'assistant'])
        self.assertTrue(all(r['is_error'] for r in msgs[3]['results']))

    def test_step_while_running_is_409_and_stale_is_reclaimed(self):
        sid = self.create_session()
        AgentSessionModel.objects.filter(id=sid).update(status='running', running_since=timezone.now())
        res = self.step(sid, {'content': 'again'})
        self.assertEqual(res.status_code, 409)

        AgentSessionModel.objects.filter(id=sid).update(running_since=timezone.now() - dt.timedelta(minutes=11))
        with mock.patch(STREAM_PATCH, new=_reply('back')):
            res = self.step(sid, {'content': 'again'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(_events(res)[-1]['stop_reason'], 'end_turn')

    def test_max_steps_returns_done_without_calling_model(self):
        sid = self.create_session()
        AgentSessionModel.objects.filter(id=sid).update(step_count=3, max_steps=3)
        with mock.patch(STREAM_PATCH) as stream:
            events = _events(self.step(sid, {'content': 'more'}))
        stream.assert_not_called()
        self.assertEqual([e['type'] for e in events], ['done'])
        self.assertEqual(events[0]['stop_reason'], 'max_steps')
        self.assertEqual(AgentSessionModel.objects.get(id=sid).status, 'idle')

    def test_provider_error_marks_session_error(self):
        sid = self.create_session()
        with mock.patch(STREAM_PATCH, side_effect=RuntimeError('boom')):
            events = _events(self.step(sid, {'content': 'go'}))
        self.assertEqual(events[-1]['type'], 'error')
        session = AgentSessionModel.objects.get(id=sid)
        self.assertEqual(session.status, 'error')
        self.assertTrue(session.last_error)
        # A new message still works after an error.
        with mock.patch(STREAM_PATCH, new=_reply('ok')):
            self.assertEqual(self.step(sid, {'content': 'retry'}).status_code, 200)

    def test_disconnect_mid_stream_keeps_partial_text(self):
        sid = self.create_session()
        session = AgentSessionService.begin_step(sid, self.alice, content='go')
        with mock.patch(STREAM_PATCH, new=_reply('partial answer')):
            gen = AgentSessionService.stream_step(session)
            next(gen)  # start
            next(gen)  # delta
            gen.close()  # client went away
        session.refresh_from_db()
        self.assertEqual(session.status, 'idle')
        partial = session.messages.get(role='assistant')
        self.assertTrue(partial.is_partial)
        self.assertEqual(partial.content, 'partial answer')


class SessionReadTests(AgentApiTestsBase):
    def test_cancel_drops_pending(self):
        sid = self.create_session()
        with mock.patch(STREAM_PATCH, new=_reply(calls=[('t1', 'ls', {})])):
            self.step(sid, {'content': 'go'})
        res = self.client.post(f'/api/ai/agent/session/{sid}/cancel/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['data']['status'], 'idle')
        self.assertEqual(AgentToolCallModel.objects.get(call_id='t1').status, 'cancelled')

    def test_list_and_details_scoped_to_owner(self):
        sid = self.create_session()
        with mock.patch(STREAM_PATCH, new=_reply('hey', calls=[('t1', 'ls', {})])):
            self.step(sid, {'content': 'hi'})

        res = self.client.get('/api/ai/agent/session/list/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['data']['total_records'], 1)
        self.assertEqual(res.json()['data']['data'][0]['status'], 'awaiting_tools')

        res = self.client.get(f'/api/ai/agent/session/{sid}/details/')
        self.assertEqual(res.status_code, 200)
        data = res.json()['data']
        self.assertEqual([m['seq'] for m in data['messages']], [0, 1])
        self.assertEqual(data['messages'][1]['tool_calls'][0]['call_id'], 't1')
        self.assertEqual(data['pending_tool_calls'][0]['name'], 'ls')

        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.get(f'/api/ai/agent/session/{sid}/details/').status_code, 404)
        self.assertEqual(self.step(sid, {'content': 'x'}).status_code, 404)
        self.assertEqual(self.client.post(f'/api/ai/agent/session/{sid}/cancel/').status_code, 404)
        self.assertEqual(self.client.get('/api/ai/agent/session/list/').json()['data']['total_records'], 0)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post('/api/ai/agent/session/create/', {}, format='json').status_code, 401)
