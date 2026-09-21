from django.urls import path

from workspace_control.views.workspace import (
    GetActiveWorkspaceAPIView,
    GetWorkspaceListAPIView,
    OpenWorkspaceAPIView,
)

urlpatterns = [
    path('workspace/list/', GetWorkspaceListAPIView.as_view(), name='workspace_list'),
    path('workspace/active/', GetActiveWorkspaceAPIView.as_view(), name='workspace_active'),
    path('workspace/open/', OpenWorkspaceAPIView.as_view(), name='workspace_open'),
]
