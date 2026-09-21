import logging
import re

from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from common.api_response import ApiResponse
from user_control.models import UserSettingModel
from user_control.serializers.setting import (
    SETTING_KEY_PATTERN,
    UserSettingModelSerializer,
)

logger = logging.getLogger(__name__)


def _invalid_key(key):
    return not re.match(SETTING_KEY_PATTERN, key)


class GetUserSettingDetailsAPIView(APIView):
    """A missing setting is not an error: it answers ``value: null``."""
    permission_classes = [IsAuthenticated]

    def get(self, request, key):
        if _invalid_key(key):
            return ApiResponse.bad_request(message='Invalid setting key')
        setting = UserSettingModel.objects.filter(user=request.user, key=key).first()
        data = (
            UserSettingModelSerializer.Details(setting).data
            if setting else {'key': key, 'value': None, 'updated_at': None}
        )
        return ApiResponse.success(message='Setting fetched successfully', data=data)


class UpdateUserSettingAPIView(APIView):
    """Upsert: creates the setting on first write."""
    permission_classes = [IsAuthenticated]

    def put(self, request, key):
        if _invalid_key(key):
            return ApiResponse.bad_request(message='Invalid setting key')

        serializer = UserSettingModelSerializer.Update(data=request.data)
        serializer.is_valid(raise_exception=True)

        setting, created = UserSettingModel.objects.update_or_create(
            user=request.user, key=key,
            defaults={'value': serializer.validated_data['value'], 'updated_by': request.user},
        )
        if created:
            setting.created_by = request.user
            setting.save(update_fields=['created_by'])
        logger.info(
            '[UpdateUserSettingAPIView] %s setting - user_id=%s, key=%s',
            'Created' if created else 'Updated', request.user.id, key,
        )
        return ApiResponse.success(
            message='Setting saved successfully',
            data=UserSettingModelSerializer.Details(setting).data,
        )
