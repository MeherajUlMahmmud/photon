from django.urls import path

from ai_control.views.agent import (
    CancelAgentSessionAPIView,
    CreateAgentSessionAPIView,
    CreateAgentStepAPIView,
    CreateAgentStepStreamAPIView,
    GetAgentSessionDetailsAPIView,
    GetAgentSessionListAPIView,
)
from ai_control.views.completion import CreateCompletionAPIView, CreateCompletionStreamAPIView
from ai_control.views.llm_api_call import GetLlmApiCallDetailsAPIView, GetLlmApiCallListAPIView
from ai_control.views.llm_provider import GetLlmProviderListAPIView, TestLlmProviderAPIView
from ai_control.views.llm_tool import GetLlmToolListAPIView
from ai_control.views.transcription import CreateTranscriptionAPIView

urlpatterns = [
    path('ai/provider/list/', GetLlmProviderListAPIView.as_view(), name='llm_provider_list'),
    path('ai/provider/<str:provider>/test/', TestLlmProviderAPIView.as_view(), name='llm_provider_test'),
    path('ai/tool/list/', GetLlmToolListAPIView.as_view(), name='llm_tool_list'),
    path('ai/completion/create/', CreateCompletionAPIView.as_view(), name='completion_create'),
    path('ai/completion/stream/', CreateCompletionStreamAPIView.as_view(), name='completion_stream'),
    path('ai/agent/session/create/', CreateAgentSessionAPIView.as_view(), name='agent_session_create'),
    path('ai/agent/session/list/', GetAgentSessionListAPIView.as_view(), name='agent_session_list'),
    path('ai/agent/session/<uuid:pk>/details/', GetAgentSessionDetailsAPIView.as_view(), name='agent_session_details'),
    path('ai/agent/session/<uuid:pk>/cancel/', CancelAgentSessionAPIView.as_view(), name='agent_session_cancel'),
    path('ai/agent/session/<uuid:pk>/step/create/', CreateAgentStepAPIView.as_view(), name='agent_step_create'),
    path('ai/agent/session/<uuid:pk>/step/stream/', CreateAgentStepStreamAPIView.as_view(), name='agent_step_stream'),
    path('ai/transcription/create/', CreateTranscriptionAPIView.as_view(), name='transcription_create'),
    path('ai/call/list/', GetLlmApiCallListAPIView.as_view(), name='llm_api_call_list'),
    path('ai/call/<uuid:pk>/details/', GetLlmApiCallDetailsAPIView.as_view(), name='llm_api_call_details'),
]
