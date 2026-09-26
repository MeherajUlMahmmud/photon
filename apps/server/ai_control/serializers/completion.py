from rest_framework import serializers

from ai_control.choices import LlmProviderChoices
from ai_control.services.skill_service import SKILL_NAME_PATTERN, SkillService

MESSAGE_ROLES = ('system', 'user', 'assistant')
IMAGE_MEDIA_TYPES = ('image/png', 'image/jpeg', 'image/webp')
MAX_IMAGES_PER_MESSAGE = 4
#: Base64 characters per image, about 7.5 MB decoded. The desktop sends
#: screenshots downscaled to ~1568 px JPEG, well under this.
MAX_IMAGE_BASE64_CHARS = 10 * 1024 * 1024


class CompletionImageSerializer(serializers.Serializer):
    """One inline image (a screenshot) sent with a user message. Never stored."""
    media_type = serializers.ChoiceField(choices=IMAGE_MEDIA_TYPES)
    data = serializers.RegexField(r'^[A-Za-z0-9+/]+={0,2}$', max_length=MAX_IMAGE_BASE64_CHARS)

    class Meta:
        ref_name = 'CompletionImage'


class CompletionMessageSerializer(serializers.Serializer):
    """
    One transcript line. A user message may name a ``skill``: the server then
    sends the skill's instructions with ``content`` as its arguments, so the
    client never has to hold or resend skill text itself. A user message may
    also carry ``images``; they go to the provider for this call only and are
    left out of the logged prompt.
    """
    role = serializers.ChoiceField(choices=MESSAGE_ROLES)
    content = serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=200000)
    skill = serializers.RegexField(SKILL_NAME_PATTERN, required=False, allow_blank=True, max_length=64)
    images = CompletionImageSerializer(many=True, required=False, max_length=MAX_IMAGES_PER_MESSAGE)

    class Meta:
        ref_name = 'CompletionMessage'

    def validate(self, attrs):
        if attrs.get('skill') and attrs['role'] != 'user':
            raise serializers.ValidationError({'skill': 'Only user messages can invoke a skill.'})
        if attrs.get('images') and attrs['role'] != 'user':
            raise serializers.ValidationError({'images': 'Only user messages can carry images.'})
        return attrs


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

    def messages_for(self, user):
        """
        Provider-neutral messages with every ``skill`` reference expanded for
        ``user``. Raises ``SkillNotFound`` when a named skill does not exist.
        """
        out = []
        for m in self.validated_data['messages']:
            skill = m.get('skill') or ''
            content = SkillService.expand(user, skill, m['content']) if skill else m['content']
            message = {'role': m['role'], 'content': content}
            if m.get('images'):
                message['images'] = [dict(image) for image in m['images']]
            out.append(message)
        return out


class CompletionResponseSerializer(serializers.Serializer):
    content = serializers.CharField()
    provider = serializers.CharField()
    model = serializers.CharField()
    call_id = serializers.CharField()
    usage = serializers.DictField(child=serializers.IntegerField())

    class Meta:
        ref_name = 'CompletionResponse'
