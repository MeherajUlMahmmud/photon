from django.urls import path

from workspace_control.views.workspace import (
    ArchiveWorkspaceAPIView,
    GetActiveWorkspaceAPIView,
    GetWorkspaceListAPIView,
    OpenWorkspaceAPIView,
    UnarchiveWorkspaceAPIView,
)

urlpatterns = [
    path('workspace/list/', GetWorkspaceListAPIView.as_view(), name='workspace_list'),
    path('workspace/active/', GetActiveWorkspaceAPIView.as_view(), name='workspace_active'),
    path('workspace/open/', OpenWorkspaceAPIView.as_view(), name='workspace_open'),
    path('workspace/<uuid:workspace_id>/archive/', ArchiveWorkspaceAPIView.as_view(), name='workspace_archive'),
    path('workspace/<uuid:workspace_id>/unarchive/', UnarchiveWorkspaceAPIView.as_view(), name='workspace_unarchive'),
]
