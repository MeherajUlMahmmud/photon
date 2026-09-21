from rest_framework import serializers

from user_control.models import UserSettingModel

SETTING_KEY_PATTERN = r'^[A-Za-z0-9_.\-]{1,128}$'


class UserSettingModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = UserSettingModel
        ref_name = 'UserSettingModelMeta'
        fields = ['key', 'value', 'updated_at']
        read_only_fields = ['key', 'updated_at']


class UserSettingModelSerializer:
    class Details(UserSettingModelSerializerMeta):
        class Meta(UserSettingModelSerializerMeta.Meta):
            ref_name = 'UserSettingModelDetails'

    class Update(UserSettingModelSerializerMeta):
        value = serializers.CharField(allow_blank=True, max_length=10000, trim_whitespace=False)

        class Meta(UserSettingModelSerializerMeta.Meta):
            ref_name = 'UserSettingModelUpdate'
            fields = ['value']
