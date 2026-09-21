import logging

from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView

from common.api_response import ApiResponse
from common.constants.error_messages import ErrorMessage
from common.exceptions import format_serializer_errors
from common.rate_limiters import api_rate_limit
from common.utils import CommonUtils
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from user_control.models import UserModel
from user_control.serializers.auth import (
    LogoutSerializer,
    RegisterSerializer,
    SetNewPasswordSerializer,
    UserLoginSerializer,
)
from user_control.services import AuthService
from user_control.signals import user_login_failed

logger = logging.getLogger(__name__)

# Logging convention: [ViewName] action - use %s/%d for args (no f-strings) so formatting is lazy.
# Levels: DEBUG=flow detail, INFO=request/success, WARNING=validation/business failure, ERROR=exception.


class HasUsersAPIView(APIView):
    """Lets the sign-in screen choose between "Sign in" and "Create account"."""
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request):
        return ApiResponse.success(
            message='User existence checked',
            data={'has_users': UserModel.objects.exists()},
        )


class RegisterAPIView(GenericAPIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()
    serializer_class = RegisterSerializer

    @method_decorator(api_rate_limit(requests=10, window=3600, key_prefix='register', use_email=False))
    def post(self, request):
        logger.info('[RegisterAPIView] User registration request received')

        serializer = self.serializer_class(data=request.data)
        if not serializer.is_valid():
            logger.warning('[RegisterAPIView] Validation error during registration: %s', list(serializer.errors))
            return ApiResponse.bad_request(
                message=format_serializer_errors(serializer.errors),
                errors=serializer.errors,
            )

        with transaction.atomic():
            user = serializer.save()
        logger.info('[RegisterAPIView] User registration successful - user_id=%s', user.id)

        return ApiResponse.created(
            message='User registration successful',
            data=AuthService.complete_login(self.__class__, request, user),
        )


class LoginAPIView(GenericAPIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()
    serializer_class = UserLoginSerializer

    @method_decorator(api_rate_limit(requests=10, window=60, key_prefix='login'))
    def post(self, request):
        client_ip = CommonUtils.get_client_ip(request)
        email = str(request.data.get('email', '')).strip().lower()
        logger.info('[LoginAPIView] Login attempt - email=%s, ip=%s', email, client_ip)

        serializer = self.serializer_class(data=request.data)
        if serializer.is_valid():
            user = serializer.validated_data['user']
            logger.info('[LoginAPIView] Login successful - user_id=%s, ip=%s', user.id, client_ip)
            return ApiResponse.success(
                message='Login successful.',
                data=AuthService.complete_login(self.__class__, request, user),
            )

        message = format_serializer_errors(serializer.errors)
        if ErrorMessage.ACCOUNT_LOCKED in message:
            reason = ErrorMessage.ACCOUNT_LOCKED
        elif ErrorMessage.ACCOUNT_DISABLED in message:
            reason = ErrorMessage.ACCOUNT_DISABLED
        else:
            reason = ErrorMessage.AUTHENTICATION_FAILED
            message = 'Invalid email or password.'

        logger.warning('[LoginAPIView] Login failed - email=%s, ip=%s, reason=%s', email, client_ip, reason)
        if email:
            user_login_failed.send(sender=self.__class__, email=email, request=request, reason=reason)
        return ApiResponse.unauthorized(message=message)


class RefreshTokenAPIView(GenericAPIView):
    """simplejwt's refresh, answered in the ApiResponse envelope. Rotates the refresh token."""
    permission_classes = (AllowAny,)
    authentication_classes = ()
    serializer_class = TokenRefreshSerializer

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, InvalidToken):
            logger.warning('[RefreshTokenAPIView] Invalid or expired refresh token')
            return ApiResponse.unauthorized(message=ErrorMessage.TOKEN_INVALID)
        return ApiResponse.success(message='Token refreshed', data=serializer.validated_data)


class LogoutAPIView(GenericAPIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = LogoutSerializer

    def post(self, request):
        logger.info('[LogoutAPIView] Logout request received - user_id=%s', request.user.id)

        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        logger.info('[LogoutAPIView] Logged out - user_id=%s', request.user.id)
        return ApiResponse.success(message='Logout successful')


class PasswordChangeAPIView(GenericAPIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = SetNewPasswordSerializer

    def post(self, request):
        """
        Change the password of the signed-in user after checking the current one.
        Every refresh token is blacklisted, so other devices must sign in again.
        """
        logger.info('[PasswordChangeAPIView] Password change request - user_id=%s', request.user.id)

        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data['old_password']):
            logger.warning('[PasswordChangeAPIView] Invalid current password - user_id=%s', user.id)
            return ApiResponse.bad_request(
                message='Current password is incorrect',
                errors={'old_password': ['Current password is incorrect']},
            )

        user.set_password(serializer.validated_data['new_password'])
        user.last_password_change_time = timezone.now()
        user.save(update_fields=['password', 'last_password_change_time'])
        AuthService.blacklist_all_refresh_tokens(user)

        logger.info('[PasswordChangeAPIView] Password changed - user_id=%s', user.id)
        return ApiResponse.success(
            message='Password changed successfully',
            data={'tokens': AuthService.issue_tokens(user)},
        )
