import logging
import re

from django.utils import timezone

from workspace_control.models import WorkspaceModel

logger = logging.getLogger(__name__)


class WorkspaceService:
    @staticmethod
    def name_for_path(root_path):
        parts = [p for p in re.split(r'[/\\]', root_path) if p]
        return parts[-1] if parts else root_path

    @staticmethod
    def open_workspace(user, root_path):
        """Upsert by (user, root_path) and mark it the most recently opened."""
        now = timezone.now()
        workspace, created = WorkspaceModel.objects.update_or_create(
            user=user, root_path=root_path,
            defaults={
                'name': WorkspaceService.name_for_path(root_path),
                'last_opened_at': now,
                'is_deleted': False,
                'updated_by': user,
            },
        )
        if created:
            workspace.created_by = user
            workspace.save(update_fields=['created_by'])
        logger.info(
            '[WorkspaceService] %s workspace - user_id=%s, workspace_id=%s',
            'Created' if created else 'Reopened', user.id, workspace.id,
        )
        return workspace

    @staticmethod
    def active_workspace(user):
        return WorkspaceModel.objects.filter(user=user, is_deleted=False).order_by('-last_opened_at').first()
