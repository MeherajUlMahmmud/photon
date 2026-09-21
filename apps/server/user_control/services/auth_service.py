import logging

from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)
from rest_framework_simplejwt.tokens import RefreshToken
from user_control.serializers.user import UserModelSerializer
from user_control.signals import user_logged_in

logger = logging.getLogger(__name__)


class AuthService:
    @staticmethod
    def issue_tokens(user):
        refresh = RefreshToken.for_user(user)
        return {
            'refresh': str(refresh),
            'access': str(refresh.access_token),
        }

    @staticmethod
    def complete_login(sender, request, user):
        """Fire the login signal and build the ``{user, tokens}`` payload.

        Shared by register and login so a new account is signed in the same way
        as a returning one.
        """
        user_logged_in.send(sender=sender, user=user, request=request)
        return {
            'user': UserModelSerializer.Details(user).data,
            'tokens': AuthService.issue_tokens(user),
        }

    @staticmethod
    def blacklist_all_refresh_tokens(user):
        """Sign the user out everywhere: blacklist every outstanding refresh token."""
        tokens = OutstandingToken.objects.filter(user=user)
        for token in tokens:
            BlacklistedToken.objects.get_or_create(token=token)
        logger.info('[AuthService] Blacklisted %s refresh token(s) for user_id=%s', tokens.count(), user.id)
