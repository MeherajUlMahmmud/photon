from rest_framework import serializers

from ai_control.models import LlmApiCallModel


class LlmApiCallModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = LlmApiCallModel
        ref_name = 'LlmApiCallModelMeta'
        fields = [
            'id',
            'provider',
            'model',
            'task_key',
            'trace_id',
            'correlation_id',
            'status',
            'input_tokens',
            'output_tokens',
            'total_tokens',
            'latency_ms',
            'cost_usd',
            'error_type',
            'created_at',
        ]
        read_only_fields = fields


class LlmApiCallModelSerializer:
    class List(LlmApiCallModelSerializerMeta):
        class Meta(LlmApiCallModelSerializerMeta.Meta):
            ref_name = 'LlmApiCallModelList'

    class Details(LlmApiCallModelSerializerMeta):
        class Meta(LlmApiCallModelSerializerMeta.Meta):
            ref_name = 'LlmApiCallModelDetails'
            fields = LlmApiCallModelSerializerMeta.Meta.fields + [
                'prompt_text',
                'prompt_metadata',
                'response_text',
                'response_json',
                'error_message',
            ]
            read_only_fields = fields
