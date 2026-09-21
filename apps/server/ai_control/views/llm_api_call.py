import logging

from ai_control.filters import LlmApiCallModelFilter
from ai_control.models import LlmApiCallModel
from ai_control.serializers.llm_api_call import LlmApiCallModelSerializer
from common.api_response import ApiResponse
from common.custom_view import CustomListAPIView, CustomRetrieveAPIView, OwnedQuerysetMixin

logger = logging.getLogger(__name__)


class GetLlmApiCallListAPIView(OwnedQuerysetMixin, CustomListAPIView):
    queryset = LlmApiCallModel.objects.filter(is_deleted=False)
    serializer_class = LlmApiCallModelSerializer.List
    filterset_class = LlmApiCallModelFilter
    ordering_fields = ['created_at', 'latency_ms', 'total_tokens', 'cost_usd']
    ordering = ['-created_at']

    def get(self, request, *args, **kwargs):
        logger.info('[GetLlmApiCallListAPIView] Call list requested - user_id=%s', request.user.id)
        response = super().get(request, *args, **kwargs)
        return ApiResponse.success(message='LLM call list fetched successfully', data=response.data)


class GetLlmApiCallDetailsAPIView(OwnedQuerysetMixin, CustomRetrieveAPIView):
    queryset = LlmApiCallModel.objects.filter(is_deleted=False)
    serializer_class = LlmApiCallModelSerializer.Details

    def get(self, request, *args, **kwargs):
        response = super().get(request, *args, **kwargs)
        return ApiResponse.success(message='LLM call fetched successfully', data=response.data)
