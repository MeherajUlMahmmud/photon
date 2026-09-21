from django.urls import path

from ai_control.views.completion import CreateCompletionAPIView
from ai_control.views.llm_api_call import GetLlmApiCallDetailsAPIView, GetLlmApiCallListAPIView
from ai_control.views.llm_provider import GetLlmProviderListAPIView

urlpatterns = [
    path('ai/provider/list/', GetLlmProviderListAPIView.as_view(), name='llm_provider_list'),
    path('ai/completion/create/', CreateCompletionAPIView.as_view(), name='completion_create'),
    path('ai/call/list/', GetLlmApiCallListAPIView.as_view(), name='llm_api_call_list'),
    path('ai/call/<uuid:pk>/details/', GetLlmApiCallDetailsAPIView.as_view(), name='llm_api_call_details'),
]
