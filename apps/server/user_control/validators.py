import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from rest_framework import serializers


class UserFieldValidator:
    @staticmethod
    def validate_name(value):
        value = (value or '').strip()
        if value and not re.match(r"^[^\W\d_]+(?:[\s'\-][^\W\d_]+)*$", value):
            raise serializers.ValidationError(
                "Name can only contain letters, spaces, hyphens and apostrophes."
            )
        return value

    @staticmethod
    def validate_email(value):
        try:
            validate_email(value)
        except DjangoValidationError:
            raise serializers.ValidationError(
                "Please enter a valid email address."
            )
        return value.lower().strip()

    @staticmethod
    def validate_password(value):
        if len(value) < 8:
            raise serializers.ValidationError(
                "Password must be at least 8 characters long."
            )
        if len(value) > 128:
            raise serializers.ValidationError(
                "Password cannot be longer than 128 characters."
            )
        if not re.search(r'[A-Z]', value):
            raise serializers.ValidationError(
                "Password must contain at least one uppercase letter."
            )
        if not re.search(r'[a-z]', value):
            raise serializers.ValidationError(
                "Password must contain at least one lowercase letter."
            )
        if not re.search(r'\d', value):
            raise serializers.ValidationError(
                "Password must contain at least one digit."
            )
        return value
