import logging
import re

from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from common.api_response import ApiResponse
from user_control.serializers.secret import (
    SECRET_PROVIDER_PATTERN,
    UserSecretModelSerializer,
)
from user_control.services import SecretService

logger = logging.getLogger(__name__)


def _invalid_provider(provider):
    return not re.match(SECRET_PROVIDER_PATTERN, provider)


def _details(provider, secret):
    return UserSecretModelSerializer.Details({
        'provider': provider,
        'has_key': secret is not None,
        'updated_at': secret.updated_at if secret else None,
    }).data


class GetUserSecretDetailsAPIView(APIView):
    """Whether a key is stored. The key itself is never returned."""
    permission_classes = [IsAuthenticated]

    def get(self, request, provider):
        if _invalid_provider(provider):
            return ApiResponse.bad_request(message='Invalid provider')
        secret = SecretService.get_secret(request.user, provider)
        return ApiResponse.success(message='Secret status fetched successfully', data=_details(provider, secret))


class UpdateUserSecretAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, provider):
        if _invalid_provider(provider):
            return ApiResponse.bad_request(message='Invalid provider')

        serializer = UserSecretModelSerializer.Update(data=request.data)
        serializer.is_valid(raise_exception=True)

        secret = SecretService.set_api_key(request.user, provider, serializer.validated_data['api_key'])
        logger.info('[UpdateUserSecretAPIView] API key saved - user_id=%s, provider=%s', request.user.id, provider)
        return ApiResponse.success(message='API key saved successfully', data=_details(provider, secret))


class DeleteUserSecretAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, provider):
        if _invalid_provider(provider):
            return ApiResponse.bad_request(message='Invalid provider')
        SecretService.delete_api_key(request.user, provider)
        return ApiResponse.success(message='API key removed successfully', data=_details(provider, None))
