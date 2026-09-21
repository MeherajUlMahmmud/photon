import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from ai_control.models import LlmToolModel
from ai_control.serializers.llm_tool import LlmToolModelSerializer
from common.api_response import ApiResponse

logger = logging.getLogger(__name__)


class GetLlmToolListAPIView(APIView):
    """Tools the agent may call. The desktop uses this to know what it must be able to execute."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        logger.info('[GetLlmToolListAPIView] Tool list requested - user_id=%s', request.user.id)
        tools = LlmToolModel.objects.filter(is_active=True, is_deleted=False).order_by('priority', 'name')
        data = LlmToolModelSerializer.List(tools, many=True).data
        return ApiResponse.success(message='Tool list fetched successfully', data=data)
