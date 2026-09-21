import logging

from django.dispatch import Signal, receiver
from django.utils import timezone

from common.utils import CommonUtils
from user_control.models import LoginAttemptModel, UserModel

logger = logging.getLogger(__name__)

# Custom signals for login tracking
user_logged_in = Signal()
user_login_failed = Signal()


def _request_client_info(request):
    user_agent = request.META.get('HTTP_USER_AGENT', '')
    device_info = CommonUtils.parse_user_agent(user_agent)
    return {
        'ip_address': CommonUtils.get_client_ip(request),
        'user_agent': user_agent,
        'device_type': device_info.get('device_type'),
        'browser': device_info.get('browser'),
        'os': device_info.get('os'),
    }


@receiver(user_logged_in, dispatch_uid='user_logged_in_track_login')
def handle_user_logged_in(sender, user, request, **kwargs):
    """
    Handle user login success.
    - Update last_login and login_count
    - Reset failed_login_attempts
    - Create LoginAttempt entry
    """
    try:
        user.last_login = timezone.now()
        user.login_count += 1
        user.save(update_fields=['last_login', 'login_count'])
        user.reset_failed_login()

        LoginAttemptModel.objects.create(
            user=user,
            email=user.email,
            success=True,
            **_request_client_info(request),
        )
    except Exception as e:
        logger.error('[handle_user_logged_in] Failed to record login for %s: %s', user.email, e, exc_info=True)


@receiver(user_login_failed, dispatch_uid='user_login_failed_track_attempt')
def handle_user_login_failed(sender, email, request, reason=None, **kwargs):
    """
    Handle user login failure.
    - Create LoginAttempt entry
    - Increment failed_login_attempts, locking the account at the limit
    """
    try:
        user = UserModel.objects.filter(email=email).first()

        LoginAttemptModel.objects.create(
            user=user,
            email=email,
            success=False,
            failure_reason=reason or 'Invalid credentials',
            **_request_client_info(request),
        )

        if user and not user.is_locked:
            user.increment_failed_login()
            if user.is_locked:
                logger.warning(
                    '[handle_user_login_failed] Account locked after %s failed attempts - user_id=%s',
                    user.failed_login_attempts, user.id,
                )
    except Exception as e:
        logger.error('[handle_user_login_failed] Failed to record login failure for %s: %s', email, e, exc_info=True)
