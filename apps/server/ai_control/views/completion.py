import json
import logging

from django.http import StreamingHttpResponse
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from ai_control.llm.exceptions import AiUnavailableError
from ai_control.llm.orchestrator import LLMOrchestrator
from ai_control.serializers.completion import CompletionRequestSerializer, CompletionResponseSerializer
from common.api_response import ApiResponse
from common.rate_limiters import api_rate_limit

logger = logging.getLogger(__name__)


class CreateCompletionAPIView(APIView):
    """
    One non-streaming chat completion with the caller's own API key. The
    desktop agent loop calls this so provider keys never leave the server.
    """
    permission_classes = [IsAuthenticated]

    @method_decorator(api_rate_limit(requests=60, window=60, key_prefix='completion', use_email=False))
    def post(self, request):
        serializer = CompletionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        logger.info(
            '[CreateCompletionAPIView] Completion requested - user_id=%s, provider=%s, task_key=%s',
            request.user.id, data.get('provider') or '-', data['task_key'],
        )
        try:
            outcome = LLMOrchestrator.run_completion(
                user=request.user,
                messages=[dict(m) for m in data['messages']],
                task_key=data['task_key'],
                provider=data.get('provider') or None,
                model=data.get('model') or None,
                llm_config=serializer.llm_config(),
                trace_id=data.get('trace_id') or None,
            )
        except AiUnavailableError as e:
            logger.warning('[CreateCompletionAPIView] Unavailable - user_id=%s: %s', request.user.id, e)
            return ApiResponse.error(message=str(e), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        return ApiResponse.success(
            message='Completion generated successfully',
            data=CompletionResponseSerializer(outcome).data,
        )


class CreateCompletionStreamAPIView(APIView):
    """
    Same request as ``CreateCompletionAPIView``, answered as newline-delimited
    JSON events (``start``, ``delta``, ``done`` / ``error``) so the desktop
    can show the reply as it is written.
    """
    permission_classes = [IsAuthenticated]

    @method_decorator(api_rate_limit(requests=60, window=60, key_prefix='completion', use_email=False))
    def post(self, request):
        serializer = CompletionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        logger.info(
            '[CreateCompletionStreamAPIView] Stream requested - user_id=%s, provider=%s, task_key=%s',
            request.user.id, data.get('provider') or '-', data['task_key'],
        )
        events = LLMOrchestrator.stream_completion(
            user=request.user,
            messages=[dict(m) for m in data['messages']],
            task_key=data['task_key'],
            provider=data.get('provider') or None,
            model=data.get('model') or None,
            llm_config=serializer.llm_config(),
            trace_id=data.get('trace_id') or None,
        )

        def lines():
            for event in events:
                yield json.dumps(event, ensure_ascii=False) + '\n'

        response = StreamingHttpResponse(lines(), content_type='application/x-ndjson')
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'
        return response
