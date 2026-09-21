from django.urls import path

from user_control.views.auth import (
    HasUsersAPIView,
    LoginAPIView,
    LogoutAPIView,
    PasswordChangeAPIView,
    RefreshTokenAPIView,
    RegisterAPIView,
)
from user_control.views.secret import (
    DeleteUserSecretAPIView,
    GetUserSecretDetailsAPIView,
    UpdateUserSecretAPIView,
)
from user_control.views.setting import GetUserSettingDetailsAPIView, UpdateUserSettingAPIView
from user_control.views.user import CurrentUserAPIView, UpdateCurrentUserAPIView

urlpatterns = [
    # Auth
    path('auth/has-users/', HasUsersAPIView.as_view(), name='auth_has_users'),
    path('auth/register/', RegisterAPIView.as_view(), name='auth_register'),
    path('auth/login/', LoginAPIView.as_view(), name='auth_login'),
    path('auth/logout/', LogoutAPIView.as_view(), name='auth_logout'),
    path('auth/token/refresh/', RefreshTokenAPIView.as_view(), name='auth_token_refresh'),
    path('auth/password-change/', PasswordChangeAPIView.as_view(), name='auth_password_change'),

    # Current user
    path('user/me/', CurrentUserAPIView.as_view(), name='current_user'),
    path('user/me/update/', UpdateCurrentUserAPIView.as_view(), name='current_user_update'),

    # Settings
    path('setting/<str:key>/details/', GetUserSettingDetailsAPIView.as_view(), name='user_setting_details'),
    path('setting/<str:key>/update/', UpdateUserSettingAPIView.as_view(), name='user_setting_update'),

    # Secrets (API keys)
    path('secret/<str:provider>/details/', GetUserSecretDetailsAPIView.as_view(), name='user_secret_details'),
    path('secret/<str:provider>/update/', UpdateUserSecretAPIView.as_view(), name='user_secret_update'),
    path('secret/<str:provider>/delete/', DeleteUserSecretAPIView.as_view(), name='user_secret_delete'),
]
