from rest_framework import serializers

from ai_control.choices import LlmProviderChoices
from ai_control.models import AgentMessageModel, AgentSessionModel, AgentToolCallModel
from ai_control.services import ToolResultInput
from ai_control.services.skill_service import SKILL_NAME_PATTERN
from workspace_control.models import WorkspaceModel

# Tool output is user-machine data; cap it so one result cannot blow up a row.
MAX_TOOL_OUTPUT_CHARS = 200_000


class AgentDeviceSerializer(serializers.Serializer):
    """
    The client machine, as the desktop reports it at session creation. ``os``
    is Node's ``process.platform`` so the desktop can pass it straight through;
    the rest is free text the system prompt quotes to the model.
    """
    os = serializers.ChoiceField(choices=[('darwin', 'macOS'), ('linux', 'Linux'), ('win32', 'Windows')])
    os_version = serializers.CharField(required=False, allow_blank=True, max_length=80)
    arch = serializers.CharField(required=False, allow_blank=True, max_length=30)
    shell = serializers.CharField(required=False, allow_blank=True, max_length=60)
    locale = serializers.CharField(required=False, allow_blank=True, max_length=20)
    app_version = serializers.CharField(required=False, allow_blank=True, max_length=40)

    class Meta:
        ref_name = 'AgentDevice'


class AgentSessionCreateSerializer(serializers.Serializer):
    """Body of ``ai/agent/session/create/``."""
    workspace_id = serializers.UUIDField(required=False, allow_null=True)
    provider = serializers.ChoiceField(choices=LlmProviderChoices.choices, required=False, allow_blank=True)
    model = serializers.CharField(required=False, allow_blank=True, max_length=120)
    task_key = serializers.RegexField(r'^[a-z0-9_\-]{1,80}$', required=False, default='agent')
    device = AgentDeviceSerializer(required=False)
    # The folder the desktop is working in. Normally the workspace root, sent
    # explicitly so the prompt and the client's sandbox agree on the same path.
    workspace_path = serializers.CharField(required=False, allow_blank=True, max_length=1024)

    class Meta:
        ref_name = 'AgentSessionCreate'

    def validate(self, attrs):
        if attrs.get('model') and not attrs.get('provider'):
            raise serializers.ValidationError({'provider': 'provider is required when model is set.'})
        return attrs

    def workspace_for(self, user):
        """The caller's workspace row, or None. Unknown ids are a validation error, not a silent None."""
        workspace_id = self.validated_data.get('workspace_id')
        if not workspace_id:
            return None
        workspace = WorkspaceModel.objects.filter(id=workspace_id, user=user, is_deleted=False).first()
        if workspace is None:
            raise serializers.ValidationError({'workspace_id': 'Unknown workspace.'})
        return workspace


class AgentSessionUpdateSerializer(serializers.Serializer):
    """Body of ``ai/agent/session/<id>/update/``: re-pin provider and model."""
    provider = serializers.ChoiceField(choices=LlmProviderChoices.choices, required=False, allow_blank=True)
    model = serializers.CharField(required=False, allow_blank=True, max_length=120)

    class Meta:
        ref_name = 'AgentSessionUpdate'

    def validate(self, attrs):
        if attrs.get('model') and not attrs.get('provider'):
            raise serializers.ValidationError({'provider': 'provider is required when model is set.'})
        return attrs


class AgentToolResultSerializer(serializers.Serializer):
    call_id = serializers.CharField(max_length=120)
    ok = serializers.BooleanField()
    output = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=MAX_TOOL_OUTPUT_CHARS)
    error = serializers.CharField(required=False, allow_blank=True, max_length=4000)

    class Meta:
        ref_name = 'AgentToolResult'


class AgentStepRequestSerializer(serializers.Serializer):
    """
    Body of a step: exactly one of ``content`` (a new user message) or
    ``tool_results`` (answers to every pending tool call). An empty list is
    valid when the server rejected every call itself and nothing is pending.
    ``skill`` names one of the caller's skills to invoke; ``content`` is then
    the arguments after ``/<skill>`` and may be blank.
    """
    content = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=200_000)
    skill = serializers.RegexField(SKILL_NAME_PATTERN, required=False, allow_blank=True, max_length=64)
    tool_results = AgentToolResultSerializer(many=True, required=False, allow_empty=True)

    class Meta:
        ref_name = 'AgentStepRequest'

    def validate(self, attrs):
        has_content = 'content' in attrs
        has_results = 'tool_results' in attrs
        if has_content == has_results:
            raise serializers.ValidationError({'error': "Send exactly one of 'content' or 'tool_results'."})
        if has_content and not attrs.get('skill') and not attrs['content'].strip():
            raise serializers.ValidationError({'content': 'This field may not be blank.'})
        if attrs.get('skill') and has_results:
            raise serializers.ValidationError({'skill': "'skill' goes with 'content', not 'tool_results'."})
        return attrs

    def step_kwargs(self):
        data = self.validated_data
        if 'content' in data:
            return {'content': data['content'], 'skill': data.get('skill') or ''}
        return {
            'tool_results': [
                ToolResultInput(
                    call_id=r['call_id'], ok=r['ok'], output=r.get('output') or '', error=r.get('error') or '',
                )
                for r in data['tool_results']
            ]
        }


class AgentToolCallModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = AgentToolCallModel
        ref_name = 'AgentToolCallModelMeta'
        fields = ['id', 'call_id', 'name', 'input', 'risk', 'seq_in_message', 'status', 'output', 'error', 'duration_ms', 'created_at']
        read_only_fields = fields


class AgentToolCallModelSerializer:
    class List(AgentToolCallModelSerializerMeta):
        class Meta(AgentToolCallModelSerializerMeta.Meta):
            ref_name = 'AgentToolCallModelList'

    class Pending(AgentToolCallModelSerializerMeta):
        class Meta(AgentToolCallModelSerializerMeta.Meta):
            ref_name = 'AgentToolCallModelPending'
            fields = ['call_id', 'name', 'input', 'risk']


class AgentMessageModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = AgentMessageModel
        ref_name = 'AgentMessageModelMeta'
        fields = ['id', 'seq', 'role', 'content', 'skill', 'stop_reason', 'is_partial', 'llm_call', 'created_at']
        read_only_fields = fields


class AgentMessageModelSerializer:
    class List(AgentMessageModelSerializerMeta):
        tool_calls = AgentToolCallModelSerializer.List(many=True, read_only=True)

        class Meta(AgentMessageModelSerializerMeta.Meta):
            ref_name = 'AgentMessageModelList'
            fields = AgentMessageModelSerializerMeta.Meta.fields + ['tool_calls']


class AgentSessionModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = AgentSessionModel
        ref_name = 'AgentSessionModelMeta'
        fields = [
            'id',
            'title',
            'workspace',
            'provider',
            'model',
            'task_key',
            'workspace_path',
            'device',
            'status',
            'step_count',
            'max_steps',
            'last_error',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class AgentSessionModelSerializer:
    class List(AgentSessionModelSerializerMeta):
        class Meta(AgentSessionModelSerializerMeta.Meta):
            ref_name = 'AgentSessionModelList'

    class Details(AgentSessionModelSerializerMeta):
        messages = AgentMessageModelSerializer.List(many=True, read_only=True)
        pending_tool_calls = serializers.SerializerMethodField()

        class Meta(AgentSessionModelSerializerMeta.Meta):
            ref_name = 'AgentSessionModelDetails'
            fields = AgentSessionModelSerializerMeta.Meta.fields + ['system_prompt', 'messages', 'pending_tool_calls']

        def get_pending_tool_calls(self, obj):
            rows = obj.tool_calls.filter(status='pending').order_by('message__seq', 'seq_in_message')
            return AgentToolCallModelSerializer.Pending(rows, many=True).data
