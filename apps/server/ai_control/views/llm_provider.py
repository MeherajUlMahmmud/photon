import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from ai_control.models import LlmProviderModel
from ai_control.serializers.llm_provider import LlmProviderModelSerializer
from common.api_response import ApiResponse
from user_control.models import UserSecretModel

logger = logging.getLogger(__name__)


class GetLlmProviderListAPIView(APIView):
    """Active providers in priority order, flagged with whether this user has a key for each."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        logger.info('[GetLlmProviderListAPIView] Provider list requested - user_id=%s', request.user.id)
        providers = LlmProviderModel.objects.filter(is_active=True, is_deleted=False).order_by('priority', 'created_at')
        with_key = set(
            UserSecretModel.objects.filter(user=request.user).values_list('provider', flat=True)
        )
        data = LlmProviderModelSerializer.List(
            providers, many=True, context={'providers_with_key': with_key},
        ).data
        return ApiResponse.success(message='LLM provider list fetched successfully', data=data)
