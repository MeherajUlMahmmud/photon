from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from user_control.models import LoginAttemptModel, UserModel, UserSecretModel, UserSettingModel


@admin.register(UserModel)
class UserModelAdmin(UserAdmin):
    ordering = ['-created_at']
    list_display = ['email', 'first_name', 'last_name', 'is_active', 'is_locked', 'last_login', 'created_at']
    list_filter = ['is_active', 'is_locked', 'is_staff']
    search_fields = ['email', 'first_name', 'last_name']
    readonly_fields = ['last_login', 'created_at', 'updated_at', 'login_count', 'last_password_change_time']
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Profile', {'fields': ('first_name', 'last_name')}),
        ('Status', {'fields': ('is_active', 'is_deleted', 'is_locked', 'lock_expiry', 'failed_login_attempts')}),
        ('Permissions', {'fields': ('is_staff', 'is_admin', 'is_superuser')}),
        ('Activity', {'fields': ('last_login', 'login_count', 'last_password_change_time', 'created_at', 'updated_at')}),
    )
    add_fieldsets = (
        (None, {'classes': ('wide',), 'fields': ('email', 'password1', 'password2')}),
    )
    filter_horizontal = ()


@admin.register(LoginAttemptModel)
class LoginAttemptModelAdmin(admin.ModelAdmin):
    list_display = ['email', 'success', 'ip_address', 'device_type', 'failure_reason', 'created_at']
    list_filter = ['success', 'device_type']
    search_fields = ['email', 'ip_address']
    readonly_fields = [f.name for f in LoginAttemptModel._meta.fields]


@admin.register(UserSettingModel)
class UserSettingModelAdmin(admin.ModelAdmin):
    list_display = ['user', 'key', 'value', 'updated_at']
    search_fields = ['user__email', 'key']


@admin.register(UserSecretModel)
class UserSecretModelAdmin(admin.ModelAdmin):
    list_display = ['user', 'provider', 'label', 'updated_at']
    search_fields = ['user__email', 'provider']
    exclude = ['ciphertext']
