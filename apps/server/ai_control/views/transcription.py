import logging

from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from ai_control.llm.exceptions import AiUnavailableError
from ai_control.llm.transcription import Transcriber
from ai_control.serializers.transcription import TranscriptionRequestSerializer, TranscriptionResponseSerializer
from common.api_response import ApiResponse
from common.rate_limiters import api_rate_limit

logger = logging.getLogger(__name__)


class CreateTranscriptionAPIView(APIView):
    """Speech to text for the composer's dictation button, with the caller's own API key."""
    permission_classes = [IsAuthenticated]

    @method_decorator(api_rate_limit(requests=30, window=60, key_prefix='transcribe', use_email=False))
    def post(self, request):
        serializer = TranscriptionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        logger.info(
            '[CreateTranscriptionAPIView] Transcription requested - user_id=%s, bytes=%s',
            request.user.id, len(data['audio']),
        )
        try:
            outcome = Transcriber.run(
                user=request.user,
                audio=data['audio'],
                mime=data['mime'],
                language=data.get('language') or None,
            )
        except AiUnavailableError as e:
            logger.warning('[CreateTranscriptionAPIView] Unavailable - user_id=%s: %s', request.user.id, e)
            return ApiResponse.error(message=str(e), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        return ApiResponse.success(
            message='Transcription generated successfully',
            data=TranscriptionResponseSerializer(outcome).data,
        )
