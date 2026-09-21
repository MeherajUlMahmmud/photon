from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny

from common.api_response import ApiResponse


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def ping(request):
    return ApiResponse.success(message='pong')
