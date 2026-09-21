import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from common.api_response import ApiResponse
from user_control.serializers.user import UserModelSerializer

logger = logging.getLogger(__name__)


class CurrentUserAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        logger.info('[CurrentUserAPIView] Profile requested - user_id=%s', request.user.id)
        return ApiResponse.success(
            message='User profile fetched successfully',
            data=UserModelSerializer.Details(request.user).data,
        )


class UpdateCurrentUserAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request):
        logger.info('[UpdateCurrentUserAPIView] Profile update - user_id=%s', request.user.id)
        serializer = UserModelSerializer.Update(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return ApiResponse.success(
            message='User profile updated successfully',
            data=UserModelSerializer.Details(request.user).data,
        )
