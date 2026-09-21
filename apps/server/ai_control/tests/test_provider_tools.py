"""Wire-format conversion and tool-call extraction for both provider clients, SDK mocked."""
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from ai_control.llm.providers.anthropic_provider import AnthropicLLMProvider
from ai_control.llm.providers.base import ProviderConfig
from ai_control.llm.providers.openai_compatible_provider import OpenAICompatibleLLMProvider

CONFIG = ProviderConfig(provider='x', api_key='k', api_url='', model='m')

NEUTRAL = [
    {'role': 'system', 'content': 'Be brief.'},
    {'role': 'user', 'content': 'List files'},
    {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'c1', 'name': 'ls', 'input': {'path': '.'}}]},
    {'role': 'tool_results', 'results': [{'call_id': 'c1', 'name': 'ls', 'content': 'a.py\nb.py', 'is_error': False}]},
    {'role': 'assistant', 'content': 'Two files.', 'tool_calls': [
        {'id': 'c2', 'name': 'read_file', 'input': {'path': 'a.py'}},
        {'id': 'c3', 'name': 'read_file', 'input': {'path': 'b.py'}},
    ]},
    {'role': 'tool_results', 'results': [
        {'call_id': 'c2', 'name': 'read_file', 'content': 'print(1)', 'is_error': False},
        {'call_id': 'c3', 'name': 'read_file', 'content': 'denied', 'is_error': True},
    ]},
]

TOOLS = [{'name': 'ls', 'description': 'List', 'input_schema': {'type': 'object', 'properties': {}}}]


class AnthropicWireTests(SimpleTestCase):
    def test_to_wire_groups_results_and_drops_empty_text(self):
        wire = AnthropicLLMProvider._to_wire(NEUTRAL)
        self.assertEqual(wire['system'], 'Be brief.')
        msgs = wire['messages']
        self.assertEqual([m['role'] for m in msgs], ['user', 'assistant', 'user', 'assistant', 'user'])
        # Tool-only turn: no empty text block.
        self.assertEqual([b['type'] for b in msgs[1]['content']], ['tool_use'])
        self.assertEqual(msgs[1]['content'][0]['id'], 'c1')
        # Text + two calls.
        self.assertEqual([b['type'] for b in msgs[3]['content']], ['text', 'tool_use', 'tool_use'])
        # Both results in ONE user message, in order, with is_error.
        results = msgs[4]['content']
        self.assertEqual([r['tool_use_id'] for r in results], ['c2', 'c3'])
        self.assertTrue(results[1]['is_error'])
        self.assertFalse(results[0]['is_error'])

    def test_tools_to_wire(self):
        self.assertEqual(
            AnthropicLLMProvider._tools_to_wire(TOOLS)['tools'][0],
            {'name': 'ls', 'description': 'List', 'input_schema': {'type': 'object', 'properties': {}}},
        )
        self.assertEqual(AnthropicLLMProvider._tools_to_wire(None), {})

    @mock.patch.object(AnthropicLLMProvider, '_build_client')
    def test_complete_extracts_tool_use_blocks(self, build_client):
        response = SimpleNamespace(
            content=[
                SimpleNamespace(type='text', text='Let me look.'),
                SimpleNamespace(type='tool_use', id='toolu_1', name='ls', input={'path': '.'}),
            ],
            stop_reason='tool_use',
            usage=SimpleNamespace(input_tokens=5, output_tokens=7),
        )
        build_client.return_value.messages.create.return_value = response

        result = AnthropicLLMProvider().complete(NEUTRAL[:2], CONFIG, tools=TOOLS)

        self.assertEqual(result.content, 'Let me look.')
        self.assertEqual(result.stop_reason, 'tool_use')
        self.assertEqual(result.raw_stop_reason, 'tool_use')
        self.assertEqual(len(result.tool_calls), 1)
        self.assertEqual(result.tool_calls[0].as_dict(), {'id': 'toolu_1', 'name': 'ls', 'input': {'path': '.'}})
        kwargs = build_client.return_value.messages.create.call_args.kwargs
        self.assertEqual(kwargs['tools'][0]['name'], 'ls')

    @mock.patch.object(AnthropicLLMProvider, '_build_client')
    def test_stream_yields_text_then_reads_final_message(self, build_client):
        final = SimpleNamespace(
            content=[SimpleNamespace(type='tool_use', id='toolu_2', name='cs', input={'query': 'x'})],
            stop_reason='tool_use',
            usage=SimpleNamespace(input_tokens=1, output_tokens=2),
        )
        stream = mock.MagicMock()
        stream.__enter__.return_value = stream
        stream.text_stream = iter(['hel', 'lo'])
        stream.get_final_message.return_value = final
        build_client.return_value.messages.stream.return_value = stream

        gen = AnthropicLLMProvider().complete_stream(NEUTRAL[:2], CONFIG, tools=TOOLS)
        chunks = []
        try:
            while True:
                chunks.append(next(gen))
        except StopIteration as stop:
            result = stop.value

        self.assertEqual(chunks, ['hel', 'lo'])
        self.assertEqual(result.content, 'hello')
        self.assertEqual(result.tool_calls[0].name, 'cs')
        self.assertEqual(result.stop_reason, 'tool_use')


def _chunk(*, content=None, tool_calls=None, finish_reason=None, usage=None):
    delta = SimpleNamespace(content=content, tool_calls=tool_calls)
    choice = SimpleNamespace(delta=delta, finish_reason=finish_reason)
    return SimpleNamespace(choices=[choice] if (content or tool_calls or finish_reason) else [], usage=usage)


def _tc(index, id=None, name=None, arguments=None):
    return SimpleNamespace(index=index, id=id, function=SimpleNamespace(name=name, arguments=arguments))


class OpenAIWireTests(SimpleTestCase):
    def test_to_wire_uses_tool_calls_and_tool_role(self):
        wire = OpenAICompatibleLLMProvider._to_wire(NEUTRAL)
        self.assertEqual([m['role'] for m in wire], ['system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'tool'])
        self.assertIsNone(wire[2]['content'])
        self.assertEqual(wire[2]['tool_calls'][0]['function'], {'name': 'ls', 'arguments': '{"path": "."}'})
        self.assertEqual(wire[3], {'role': 'tool', 'tool_call_id': 'c1', 'content': 'a.py\nb.py'})
        self.assertEqual(wire[4]['content'], 'Two files.')
        self.assertEqual(wire[6]['content'], 'Error: denied')

    def test_tools_to_wire(self):
        self.assertEqual(
            OpenAICompatibleLLMProvider._tools_to_wire(TOOLS)['tools'][0],
            {'type': 'function', 'function': {'name': 'ls', 'description': 'List', 'parameters': {'type': 'object', 'properties': {}}}},
        )

    def test_parse_arguments_keeps_raw_on_bad_json(self):
        parse = OpenAICompatibleLLMProvider._parse_arguments
        self.assertEqual(parse('{"a": 1}'), {'a': 1})
        self.assertEqual(parse(''), {})
        self.assertEqual(parse('{oops')['_raw'], '{oops')
        self.assertIn('_error', parse('[1]'))

    @mock.patch.object(OpenAICompatibleLLMProvider, '_build_client')
    def test_complete_extracts_tool_calls(self, build_client):
        message = SimpleNamespace(content=None, tool_calls=[_tc(0, id='call_1', name='ls', arguments='{"path":"src"}')])
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=message, finish_reason='tool_calls')],
            usage=SimpleNamespace(prompt_tokens=3, completion_tokens=4, total_tokens=7),
        )
        build_client.return_value.chat.completions.create.return_value = response

        result = OpenAICompatibleLLMProvider().complete(NEUTRAL[:2], CONFIG, tools=TOOLS)

        self.assertIsNone(result.content)
        self.assertFalse(result.is_empty)
        self.assertEqual(result.stop_reason, 'tool_use')
        self.assertEqual(result.tool_calls[0].as_dict(), {'id': 'call_1', 'name': 'ls', 'input': {'path': 'src'}})
        kwargs = build_client.return_value.chat.completions.create.call_args.kwargs
        self.assertEqual(kwargs['tools'][0]['type'], 'function')

    @mock.patch.object(OpenAICompatibleLLMProvider, '_build_client')
    def test_stream_accumulates_sliced_arguments_by_index(self, build_client):
        chunks = [
            _chunk(content='Sure'),
            _chunk(tool_calls=[_tc(0, id='call_a', name='ls', arguments='')]),
            _chunk(tool_calls=[_tc(0, arguments='{"pa')]),
            _chunk(tool_calls=[_tc(1, id='call_b', name='cs', arguments='{"query":"x"}')]),
            _chunk(tool_calls=[_tc(0, arguments='th":"."}')]),
            _chunk(finish_reason='tool_calls'),
            _chunk(usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3)),
        ]
        build_client.return_value.chat.completions.create.return_value = iter(chunks)

        gen = OpenAICompatibleLLMProvider().complete_stream(NEUTRAL[:2], CONFIG, tools=TOOLS)
        texts = []
        try:
            while True:
                texts.append(next(gen))
        except StopIteration as stop:
            result = stop.value

        self.assertEqual(texts, ['Sure'])
        self.assertEqual(result.content, 'Sure')
        self.assertEqual(result.usage['total_tokens'], 3)
        self.assertEqual(result.stop_reason, 'tool_use')
        self.assertEqual([c.as_dict() for c in result.tool_calls], [
            {'id': 'call_a', 'name': 'ls', 'input': {'path': '.'}},
            {'id': 'call_b', 'name': 'cs', 'input': {'query': 'x'}},
        ])

    @mock.patch.object(OpenAICompatibleLLMProvider, '_build_client')
    def test_stream_missing_index_defaults_to_zero_and_stop_wins_when_no_calls(self, build_client):
        chunks = [
            _chunk(tool_calls=[_tc(None, id='call_z', name='bash', arguments='{"command":"ls"}')]),
            _chunk(finish_reason='stop'),
        ]
        build_client.return_value.chat.completions.create.return_value = iter(chunks)
        gen = OpenAICompatibleLLMProvider().complete_stream(NEUTRAL[:2], CONFIG, tools=TOOLS)
        try:
            next(gen)
        except StopIteration as stop:
            result = stop.value
        self.assertEqual(result.tool_calls[0].id, 'call_z')
        # Calls present: tool_use even though the vendor said "stop".
        self.assertEqual(result.stop_reason, 'tool_use')
        self.assertEqual(result.raw_stop_reason, 'stop')
