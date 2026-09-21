from datetime import timedelta
import logging

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone

from common.models import BaseModel
from user_control.choices import DeviceTypeChoices
from user_control.constants import ACCOUNT_LOCK_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS

logger = logging.getLogger(__name__)


class MyUserManager(BaseUserManager):

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('Users must have an email address')

        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_admin', True)
        extra_fields.setdefault('is_superuser', True)
        return self.create_user(email, password, **extra_fields)


class UserModel(AbstractBaseUser, BaseModel, PermissionsMixin):
    email = models.EmailField(max_length=255, unique=True)
    first_name = models.CharField(max_length=255, blank=True, default='')
    last_name = models.CharField(max_length=255, blank=True, default='')

    # Account status fields
    is_staff = models.BooleanField(default=False)
    is_admin = models.BooleanField(default=False)

    # Lock account fields
    failed_login_attempts = models.IntegerField(default=0)
    is_locked = models.BooleanField(default=False)
    lock_expiry = models.DateTimeField(null=True, blank=True)

    last_password_change_time = models.DateTimeField(
        null=True, blank=True,
        help_text='Timestamp when password was last changed'
    )
    login_count = models.IntegerField(default=0)

    objects = MyUserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    class Meta:
        db_table = 'user_control_users'
        verbose_name = 'User'
        verbose_name_plural = 'Users'
        ordering = ['-created_at']

    def __str__(self):
        return self.email

    def get_full_name(self):
        return f"{self.first_name} {self.last_name}".strip() or self.email

    def get_short_name(self):
        return self.first_name or self.email

    def increment_failed_login(self):
        """
        Increment failed login attempts and lock account if necessary
        """
        self.failed_login_attempts += 1
        if self.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
            self.is_locked = True
            self.lock_expiry = timezone.now() + timedelta(minutes=ACCOUNT_LOCK_MINUTES)
        self.save(update_fields=['failed_login_attempts', 'is_locked', 'lock_expiry'])

    def reset_failed_login(self):
        """
        Reset failed login attempts
        """
        self.failed_login_attempts = 0
        self.is_locked = False
        self.lock_expiry = None
        self.save(update_fields=['failed_login_attempts', 'is_locked', 'lock_expiry'])

    def check_account_status(self):
        """
        Check if account is locked and unlock if lock period has expired
        """
        if self.is_locked and self.lock_expiry and timezone.now() > self.lock_expiry:
            self.reset_failed_login()
        return not self.is_locked

    def unlock_account(self):
        """Unlock account."""
        self.reset_failed_login()


class LoginAttemptModel(BaseModel):
    user = models.ForeignKey(
        UserModel,
        on_delete=models.CASCADE, related_name='login_attempts',
        null=True, blank=True,
    )
    email = models.EmailField()
    ip_address = models.GenericIPAddressField()
    user_agent = models.TextField(null=True, blank=True)
    success = models.BooleanField(default=False)
    device_type = models.CharField(
        max_length=20, choices=DeviceTypeChoices.choices, null=True, blank=True)
    browser = models.CharField(max_length=100, null=True, blank=True)
    os = models.CharField(max_length=100, null=True, blank=True)
    failure_reason = models.CharField(max_length=200, null=True, blank=True)

    class Meta:
        db_table = 'user_control_login_attempts'
        verbose_name = 'Login Attempt'
        verbose_name_plural = 'Login Attempts'
        indexes = [
            models.Index(fields=['ip_address'], name='login_attempt_ip_idx'),
            models.Index(fields=['user'], name='login_attempt_user_idx'),
            models.Index(fields=['created_at'], name='login_attempt_created_at_idx'),
            models.Index(fields=['email'], name='login_attempt_email_idx'),
        ]
        ordering = ['-created_at']

    def __str__(self):
        status = 'Success' if self.success else 'Failed'
        return f"{self.email} - {status} - {self.created_at:%Y-%m-%d %H:%M:%S}"


class UserSettingModel(BaseModel):
    """Per-user key/value settings (model id, theme, ...). Never holds secrets."""
    user = models.ForeignKey(UserModel, on_delete=models.CASCADE, related_name='settings')
    key = models.CharField(max_length=128)
    value = models.TextField()

    class Meta:
        db_table = 'user_control_user_settings'
        verbose_name = 'User Setting'
        verbose_name_plural = 'User Settings'
        ordering = ['key']
        constraints = [
            models.UniqueConstraint(fields=['user', 'key'], name='user_setting_unique_key'),
        ]

    def __str__(self):
        return f"{self.user.email} - {self.key}"


class UserSecretModel(BaseModel):
    """Per-user API key, stored as a Fernet token (see ``SecretService``)."""
    user = models.ForeignKey(UserModel, on_delete=models.CASCADE, related_name='secrets')
    provider = models.CharField(max_length=64)
    label = models.CharField(max_length=64, default='default')
    ciphertext = models.TextField()

    class Meta:
        db_table = 'user_control_user_secrets'
        verbose_name = 'User Secret'
        verbose_name_plural = 'User Secrets'
        ordering = ['provider', 'label']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'provider', 'label'], name='user_secret_unique_provider_label',
            ),
        ]

    def __str__(self):
        return f"{self.user.email} - {self.provider}/{self.label}"
