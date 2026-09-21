from django.utils import timezone
from rest_framework import serializers
from rest_framework.serializers import CharField, ModelSerializer, Serializer, ValidationError
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from common.constants.error_messages import ErrorMessage
from user_control.models import UserModel
from user_control.validators import UserFieldValidator

INVALID_LOGIN = 'Invalid email or password.'


class RegisterSerializer(ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = UserModel
        ref_name = 'RegisterSerializer'
        fields = [
            'email',
            'password',
            'first_name',
            'last_name',
        ]
        extra_kwargs = {
            'first_name': {'required': False},
            'last_name': {'required': False},
            # Uniqueness is checked in validate_email with our own message.
            'email': {'validators': []},
        }

    def validate_email(self, value):
        value = UserFieldValidator.validate_email(value)
        if UserModel.objects.filter(email=value).exists():
            raise ValidationError(ErrorMessage.USER_ALREADY_EXISTS)
        return value

    def validate_first_name(self, value):
        return UserFieldValidator.validate_name(value)

    def validate_last_name(self, value):
        return UserFieldValidator.validate_name(value)

    def validate_password(self, value):
        return UserFieldValidator.validate_password(value)

    def create(self, validated_data):
        return UserModel.objects.create_user(**validated_data)


class UserLoginSerializer(Serializer):
    email = serializers.EmailField(
        max_length=255,
        error_messages={
            'required': 'Email Address is required for login.',
            'invalid': 'Please enter a valid email address.',
        }
    )
    password = serializers.CharField(
        write_only=True,
        trim_whitespace=False,
        error_messages={
            'required': 'Password is required for login.',
            'blank': 'Password cannot be blank.',
        }
    )

    def validate_email(self, value):
        return UserFieldValidator.validate_email(value)

    def validate(self, attrs):
        email = attrs['email']
        password = attrs['password']

        user = UserModel.objects.filter(email=email).first()
        if user is None:
            # Hash anyway so an unknown email takes as long as a wrong password.
            UserModel().set_password(password)
            raise ValidationError(INVALID_LOGIN)

        if not user.check_password(password):
            raise ValidationError(INVALID_LOGIN)

        # Password is correct, now check account status
        user.check_account_status()

        if not user.is_active or user.is_deleted:
            raise ValidationError({'non_field_errors': [ErrorMessage.ACCOUNT_DISABLED]})

        if user.is_locked:
            minutes = None
            if user.lock_expiry:
                minutes = max(1, int((user.lock_expiry - timezone.now()).total_seconds() // 60) + 1)
            lock_info = f' Please try again in {minutes} minute(s).' if minutes else ''
            raise ValidationError({'non_field_errors': [f'{ErrorMessage.ACCOUNT_LOCKED}{lock_info}']})

        attrs['user'] = user
        return attrs


class SetNewPasswordSerializer(Serializer):
    old_password = CharField(write_only=True, trim_whitespace=False)
    new_password = CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        if attrs['old_password'] == attrs['new_password']:
            raise ValidationError('New and old password cannot be same')
        UserFieldValidator.validate_password(attrs['new_password'])
        return attrs


class LogoutSerializer(Serializer):
    refresh_token = CharField()

    default_error_messages = {
        'bad_token': 'Token is expired or invalid'
    }

    def validate(self, attrs):
        self.token = attrs['refresh_token']
        return attrs

    def save(self, **kwargs):
        try:
            RefreshToken(self.token).blacklist()
        except TokenError:
            self.fail('bad_token')
