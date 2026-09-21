from django.contrib import admin

from workspace_control.models import WorkspaceModel


@admin.register(WorkspaceModel)
class WorkspaceModelAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'root_path', 'last_opened_at', 'created_at']
    search_fields = ['name', 'root_path', 'user__email']
    readonly_fields = ['created_at', 'updated_at']
