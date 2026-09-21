import json
import logging

from django.http import StreamingHttpResponse
from django.utils.decorators import method_decorator
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from ai_control.models import AgentSessionModel
from ai_control.serializers.agent import (
    AgentSessionCreateSerializer,
    AgentSessionModelSerializer,
    AgentSessionUpdateSerializer,
    AgentStepRequestSerializer,
)
from ai_control.services import AgentSessionError, AgentSessionService
from common.api_response import ApiResponse
from common.custom_view import CustomListAPIView, CustomRetrieveAPIView, OwnedQuerysetMixin
from common.rate_limiters import api_rate_limit
from common.renderers import NdjsonStreamViewMixin

logger = logging.getLogger(__name__)

# A tool loop legitimately makes many small requests in a row.
STEP_RATE_LIMIT = dict(requests=120, window=60, key_prefix='agent_step', use_email=False)


def _session_error(e: AgentSessionError):
    return ApiResponse.error(message=str(e), status_code=e.status_code)


class CreateAgentSessionAPIView(APIView):
    """Start an agent session, optionally bound to a workspace and pinned to a provider/model."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = AgentSessionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        workspace = serializer.workspace_for(request.user)

        session = AgentSessionService.create_session(
            request.user,
            workspace=workspace,
            provider=data.get('provider') or '',
            model=data.get('model') or '',
            task_key=data['task_key'],
            device=data.get('device'),
            workspace_path=data.get('workspace_path') or '',
        )
        return ApiResponse.created(
            message='Agent session created',
            data=AgentSessionModelSerializer.Details(session).data,
        )


class _AgentStepMixin:
    """Shared body handling for the streaming and non-streaming step views."""

    def _begin(self, request, session_id):
        serializer = AgentStepRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        kwargs = serializer.step_kwargs()
        logger.info(
            '[%s] Step requested - user_id=%s, session_id=%s, kind=%s',
            self.__class__.__name__, request.user.id, session_id, 'content' if 'content' in kwargs else 'tool_results',
        )
        return AgentSessionService.begin_step(session_id, request.user, **kwargs)


class CreateAgentStepStreamAPIView(NdjsonStreamViewMixin, _AgentStepMixin, APIView):
    """
    Run one step and answer as newline-delimited JSON events (``start``,
    ``delta``, ``tool_call``, ``done`` / ``error``). A ``done`` with
    ``stop_reason: "tool_use"`` lists ``pending_tool_calls`` the client must
    run and post back as the next step.
    """
    permission_classes = [IsAuthenticated]

    @method_decorator(api_rate_limit(**STEP_RATE_LIMIT))
    def post(self, request, pk):
        try:
            session = self._begin(request, pk)
        except AgentSessionError as e:
            return _session_error(e)

        events = AgentSessionService.stream_step(session)

        def lines():
            for event in events:
                yield json.dumps(event, ensure_ascii=False) + '\n'

        response = StreamingHttpResponse(lines(), content_type='application/x-ndjson')
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'
        return response


class CreateAgentStepAPIView(_AgentStepMixin, APIView):
    """Non-streaming twin of the stream view: the final ``done`` (or ``error``) event as JSON."""
    permission_classes = [IsAuthenticated]

    @method_decorator(api_rate_limit(**STEP_RATE_LIMIT))
    def post(self, request, pk):
        try:
            session = self._begin(request, pk)
        except AgentSessionError as e:
            return _session_error(e)

        final = AgentSessionService.run_step(session)
        if final.get('type') == 'error':
            return ApiResponse.error(message=final.get('message') or 'Agent step failed', status_code=503)
        session.refresh_from_db()
        content = session.messages.filter(role='assistant').order_by('-seq').values_list('content', flat=True).first()
        return ApiResponse.success(message='Agent step completed', data={**final, 'content': content or ''})


class UpdateAgentSessionAPIView(APIView):
    """Change the provider/model an existing session uses from the next step on."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        serializer = AgentSessionUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            session = AgentSessionService.get_for_user(pk, request.user)
        except AgentSessionError as e:
            return _session_error(e)
        data = serializer.validated_data
        session = AgentSessionService.update_model(session, provider=data.get('provider') or '', model=data.get('model') or '')
        return ApiResponse.success(message='Agent session updated', data=AgentSessionModelSerializer.List(session).data)


class CancelAgentSessionAPIView(APIView):
    """Drop pending tool calls and return the session to ``idle``."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            session = AgentSessionService.get_for_user(pk, request.user)
        except AgentSessionError as e:
            return _session_error(e)
        session = AgentSessionService.cancel(session)
        return ApiResponse.success(message='Agent session cancelled', data=AgentSessionModelSerializer.List(session).data)


class GetAgentSessionListAPIView(OwnedQuerysetMixin, CustomListAPIView):
    queryset = AgentSessionModel.objects.filter(is_deleted=False)
    serializer_class = AgentSessionModelSerializer.List
    filterset_fields = ['status', 'task_key', 'workspace']
    ordering_fields = ['created_at', 'updated_at']
    ordering = ['-updated_at']

    def get(self, request, *args, **kwargs):
        logger.info('[GetAgentSessionListAPIView] Session list requested - user_id=%s', request.user.id)
        response = super().get(request, *args, **kwargs)
        return ApiResponse.success(message='Agent session list fetched successfully', data=response.data)


class GetAgentSessionDetailsAPIView(OwnedQuerysetMixin, CustomRetrieveAPIView):
    queryset = AgentSessionModel.objects.filter(is_deleted=False).prefetch_related('messages__tool_calls')
    serializer_class = AgentSessionModelSerializer.Details

    def get(self, request, *args, **kwargs):
        response = super().get(request, *args, **kwargs)
        return ApiResponse.success(message='Agent session fetched successfully', data=response.data)
