from rest_framework import serializers

SECRET_PROVIDER_PATTERN = r'^[a-z0-9_\-]{1,64}$'


class UserSecretModelSerializer:
    """No variant exposes ``ciphertext`` or the plaintext key."""

    class Details(serializers.Serializer):
        provider = serializers.CharField()
        has_key = serializers.BooleanField()
        updated_at = serializers.DateTimeField(allow_null=True)

        class Meta:
            ref_name = 'UserSecretModelDetails'

    class Update(serializers.Serializer):
        api_key = serializers.CharField(max_length=4096, trim_whitespace=True)

        class Meta:
            ref_name = 'UserSecretModelUpdate'
