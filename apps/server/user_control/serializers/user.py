from rest_framework import serializers

from user_control.models import UserModel
from user_control.validators import UserFieldValidator


class UserModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = UserModel
        ref_name = 'UserModelMeta'
        fields = [
            'id',
            'email',
            'first_name',
            'last_name',
            'created_at',
        ]
        read_only_fields = ['id', 'email', 'created_at']


class UserModelSerializer:
    class Lite(UserModelSerializerMeta):
        class Meta(UserModelSerializerMeta.Meta):
            ref_name = 'UserModelLite'
            fields = ['id', 'email']

    class Details(UserModelSerializerMeta):
        class Meta(UserModelSerializerMeta.Meta):
            ref_name = 'UserModelDetails'
            fields = UserModelSerializerMeta.Meta.fields + ['last_login']

    class Update(UserModelSerializerMeta):
        class Meta(UserModelSerializerMeta.Meta):
            ref_name = 'UserModelUpdate'
            fields = ['first_name', 'last_name']

        def validate_first_name(self, value):
            return UserFieldValidator.validate_name(value)

        def validate_last_name(self, value):
            return UserFieldValidator.validate_name(value)
