import logging

from cryptography.fernet import Fernet
from django.conf import settings

from user_control.models import UserSecretModel

logger = logging.getLogger(__name__)


class SecretService:
    """API keys stored per user as Fernet tokens, keyed by ``settings.FERNET_KEY``.

    Plaintext is only produced by ``get_api_key`` for server-side use; no API
    endpoint returns it.
    """

    @staticmethod
    def _fernet():
        return Fernet(settings.FERNET_KEY.encode())

    @staticmethod
    def set_api_key(user, provider, api_key, label='default'):
        ciphertext = SecretService._fernet().encrypt(api_key.encode('utf-8')).decode('ascii')
        secret, created = UserSecretModel.objects.update_or_create(
            user=user, provider=provider, label=label,
            defaults={'ciphertext': ciphertext, 'updated_by': user},
        )
        if created:
            secret.created_by = user
            secret.save(update_fields=['created_by'])
        logger.info(
            '[SecretService] %s API key - user_id=%s, provider=%s',
            'Created' if created else 'Updated', user.id, provider,
        )
        return secret

    @staticmethod
    def get_api_key(user, provider, label='default'):
        secret = UserSecretModel.objects.filter(user=user, provider=provider, label=label).first()
        if secret is None:
            return None
        return SecretService._fernet().decrypt(secret.ciphertext.encode('ascii')).decode('utf-8')

    @staticmethod
    def get_secret(user, provider, label='default'):
        return UserSecretModel.objects.filter(user=user, provider=provider, label=label).first()

    @staticmethod
    def delete_api_key(user, provider, label='default'):
        deleted, _ = UserSecretModel.objects.filter(user=user, provider=provider, label=label).delete()
        logger.info(
            '[SecretService] Deleted API key - user_id=%s, provider=%s, deleted=%s', user.id, provider, deleted,
        )
        return deleted > 0
