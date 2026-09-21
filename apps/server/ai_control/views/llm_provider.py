import logging
import time

from django.utils.decorators import method_decorator
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from ai_control.llm.orchestrator import LLMOrchestrator, _short_error
from ai_control.llm.providers import ProviderConfig
from ai_control.models import LlmProviderModel
from ai_control.serializers.llm_provider import LlmProviderModelSerializer, LlmProviderTestSerializer
from common.api_response import ApiResponse
from common.rate_limiters import api_rate_limit
from user_control.models import UserSecretModel
from user_control.services import SecretService

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


class TestLlmProviderAPIView(APIView):
    """
    Checks a key against the provider by listing its models: no tokens spent.
    Uses the key in the body when given (try before saving), else the stored one.
    """
    permission_classes = [IsAuthenticated]

    @method_decorator(api_rate_limit(requests=20, window=60, key_prefix='provider_test', use_email=False))
    def post(self, request, provider):
        serializer = LlmProviderTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        row = LlmProviderModel.objects.filter(provider=provider, is_active=True, is_deleted=False).first()
        if row is None:
            return ApiResponse.not_found(message='Unknown provider')

        api_key = serializer.validated_data.get('api_key') or SecretService.get_api_key(request.user, provider)
        if not api_key:
            return ApiResponse.bad_request(message='No API key to test. Paste one or save one first.')

        client = LLMOrchestrator.client_for(str(row.api_style))
        if client is None:
            return ApiResponse.bad_request(message='This provider has no client configured')

        logger.info('[TestLlmProviderAPIView] Testing key - user_id=%s, provider=%s', request.user.id, provider)
        config = ProviderConfig(provider=provider, api_key=api_key, api_url=row.api_url, model=row.default_model)
        started = time.monotonic()
        try:
            models = client.list_models(config)
        except Exception as e:  # noqa: BLE001 - any SDK failure is the answer here
            logger.warning('[TestLlmProviderAPIView] Key test failed - user_id=%s, provider=%s: %s', request.user.id, provider, e)
            return ApiResponse.success(
                message='Key test failed',
                data={'ok': False, 'error': _short_error(e), 'models': [], 'latency_ms': int((time.monotonic() - started) * 1000)},
            )

        return ApiResponse.success(
            message='Key works',
            data={
                'ok': True,
                'error': None,
                'models': models,
                'latency_ms': int((time.monotonic() - started) * 1000),
                'default_model_available': row.default_model in models,
            },
        )
