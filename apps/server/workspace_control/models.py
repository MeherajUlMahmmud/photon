from django.db import models

from common.models import BaseModel


class WorkspaceModel(BaseModel):
    """A folder on the user's machine that Photon may read and write.

    ``root_path`` is a path on the client; the server stores it as metadata only
    and never touches the filesystem it names.
    """
    user = models.ForeignKey(
        'user_control.UserModel', on_delete=models.CASCADE, related_name='workspaces',
    )
    name = models.CharField(max_length=255)
    root_path = models.CharField(max_length=4096)
    last_opened_at = models.DateTimeField()
    archived_at = models.DateTimeField(
        null=True, blank=True, db_index=True,
        help_text="Set when the user archives the space: hidden from the sidebar, nothing deleted. Opening the folder again clears it.",
    )

    class Meta:
        db_table = 'workspace_control_workspaces'
        verbose_name = 'Workspace'
        verbose_name_plural = 'Workspaces'
        ordering = ['-last_opened_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'root_path'], name='workspace_unique_user_root_path'),
        ]

    def __str__(self):
        return f"{self.user.email} - {self.name}"
