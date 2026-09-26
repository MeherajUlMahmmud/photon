import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from common.api_response import ApiResponse
from common.custom_view import CustomListAPIView, OwnedQuerysetMixin
from workspace_control.models import WorkspaceModel
from workspace_control.serializers.workspace import WorkspaceModelSerializer
from workspace_control.services import WorkspaceService

logger = logging.getLogger(__name__)


class GetWorkspaceListAPIView(OwnedQuerysetMixin, CustomListAPIView):
    queryset = WorkspaceModel.objects.filter(is_deleted=False)
    serializer_class = WorkspaceModelSerializer.List

    def get(self, request, *args, **kwargs):
        logger.info('[GetWorkspaceListAPIView] Workspace list requested - user_id=%s', request.user.id)
        response = super().get(request, *args, **kwargs)
        return ApiResponse.success(message='Workspace list fetched successfully', data=response.data)


class GetActiveWorkspaceAPIView(APIView):
    """Most recently opened workspace, or ``data: null`` when none has been opened."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = WorkspaceService.active_workspace(request.user)
        data = WorkspaceModelSerializer.Details(workspace).data if workspace else None
        return ApiResponse.success(message='Active workspace fetched successfully', data=data)


class ArchiveWorkspaceAPIView(APIView):
    """Hide a space from the sidebar. Its chats and files are untouched; unarchiving brings it back."""
    permission_classes = [IsAuthenticated]
    archived = True

    def post(self, request, workspace_id):
        workspace = WorkspaceService.set_archived(request.user, workspace_id, self.archived)
        if workspace is None:
            return ApiResponse.not_found(message='Workspace not found')
        return ApiResponse.success(
            message='Workspace archived' if self.archived else 'Workspace restored',
            data=WorkspaceModelSerializer.Details(workspace).data,
        )


class UnarchiveWorkspaceAPIView(ArchiveWorkspaceAPIView):
    archived = False


class OpenWorkspaceAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = WorkspaceModelSerializer.Open(data=request.data)
        serializer.is_valid(raise_exception=True)
        workspace = WorkspaceService.open_workspace(request.user, serializer.validated_data['root_path'])
        return ApiResponse.success(
            message='Workspace opened successfully',
            data=WorkspaceModelSerializer.Details(workspace).data,
        )
