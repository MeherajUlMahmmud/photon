from rest_framework import serializers

from ai_control.models import LlmProviderModel


class LlmProviderModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = LlmProviderModel
        ref_name = 'LlmProviderModelMeta'
        fields = [
            'id',
            'provider',
            'name',
            'api_style',
            'api_url',
            'default_model',
            'model_ids',
            'priority',
            'capabilities',
        ]
        read_only_fields = fields


class LlmProviderModelSerializer:
    class List(LlmProviderModelSerializerMeta):
        # Whether the requesting user has stored a key for this provider;
        # set by the view via ``context['providers_with_key']``.
        has_key = serializers.SerializerMethodField()

        class Meta(LlmProviderModelSerializerMeta.Meta):
            ref_name = 'LlmProviderModelList'
            fields = LlmProviderModelSerializerMeta.Meta.fields + ['has_key']

        def get_has_key(self, obj):
            return obj.provider in self.context.get('providers_with_key', set())

    class Lite(LlmProviderModelSerializerMeta):
        class Meta(LlmProviderModelSerializerMeta.Meta):
            ref_name = 'LlmProviderModelLite'
            fields = ['provider', 'name', 'default_model']


class LlmProviderTestSerializer(serializers.Serializer):
    """Optional key to test instead of the stored one, so a key can be checked before it is saved."""
    api_key = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True, write_only=True)
