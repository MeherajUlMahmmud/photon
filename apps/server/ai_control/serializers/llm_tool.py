from rest_framework import serializers

from ai_control.models import LlmToolModel


class LlmToolModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = LlmToolModel
        ref_name = 'LlmToolModelMeta'
        fields = [
            'id',
            'name',
            'label',
            'description',
            'input_schema',
            'risk',
            'executor',
            'priority',
            'task_keys',
        ]
        read_only_fields = fields


class LlmToolModelSerializer:
    class List(LlmToolModelSerializerMeta):
        class Meta(LlmToolModelSerializerMeta.Meta):
            ref_name = 'LlmToolModelList'

    class Lite(LlmToolModelSerializerMeta):
        class Meta(LlmToolModelSerializerMeta.Meta):
            ref_name = 'LlmToolModelLite'
            fields = ['name', 'label', 'risk']
