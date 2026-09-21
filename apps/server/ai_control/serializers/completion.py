from rest_framework import serializers

from ai_control.choices import LlmProviderChoices

MESSAGE_ROLES = ('system', 'user', 'assistant')


class CompletionMessageSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=MESSAGE_ROLES)
    content = serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=200000)

    class Meta:
        ref_name = 'CompletionMessage'


class CompletionRequestSerializer(serializers.Serializer):
    messages = CompletionMessageSerializer(many=True, min_length=1)
    provider = serializers.ChoiceField(choices=LlmProviderChoices.choices, required=False, allow_blank=True)
    model = serializers.CharField(required=False, allow_blank=True, max_length=120)
    task_key = serializers.RegexField(r'^[a-z0-9_\-]{1,80}$', required=False, default='chat')
    temperature = serializers.FloatField(required=False, min_value=0, max_value=2)
    max_tokens = serializers.IntegerField(required=False, min_value=1, max_value=128000)
    trace_id = serializers.CharField(required=False, allow_blank=True, max_length=120)

    class Meta:
        ref_name = 'CompletionRequest'

    def validate(self, attrs):
        if attrs.get('model') and not attrs.get('provider'):
            raise serializers.ValidationError({'provider': 'provider is required when model is set.'})
        if not any(m['role'] == 'user' for m in attrs['messages']):
            raise serializers.ValidationError({'messages': 'At least one user message is required.'})
        return attrs

    def llm_config(self):
        cfg = {}
        for key in ('temperature', 'max_tokens'):
            if key in self.validated_data:
                cfg[key] = self.validated_data[key]
        return cfg


class CompletionResponseSerializer(serializers.Serializer):
    content = serializers.CharField()
    provider = serializers.CharField()
    model = serializers.CharField()
    call_id = serializers.CharField()
    usage = serializers.DictField(child=serializers.IntegerField())

    class Meta:
        ref_name = 'CompletionResponse'
