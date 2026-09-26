from rest_framework import serializers

from ai_control.models import SkillFileModel, SkillModel
from ai_control.services.skill_service import MAX_ARCHIVE_BYTES, MAX_CONTENT_CHARS, SKILL_NAME_PATTERN


class SkillFileListSerializer(serializers.ModelSerializer):
    """A bundled file's path and size; the content is only ever read by the model."""
    class Meta:
        model = SkillFileModel
        ref_name = 'SkillFileList'
        fields = ['path', 'size']
        read_only_fields = fields


class SkillModelSerializerMeta(serializers.ModelSerializer):
    files = SkillFileListSerializer(many=True, read_only=True)

    class Meta:
        model = SkillModel
        ref_name = 'SkillModelMeta'
        fields = ['id', 'name', 'description', 'content', 'files', 'created_at', 'updated_at']
        read_only_fields = fields


class SkillModelSerializer:
    class List(SkillModelSerializerMeta):
        class Meta(SkillModelSerializerMeta.Meta):
            ref_name = 'SkillModelList'

    class Details(SkillModelSerializerMeta):
        class Meta(SkillModelSerializerMeta.Meta):
            ref_name = 'SkillModelDetails'


class SkillInstallSerializer(serializers.Serializer):
    """
    Body of ``ai/skill/install/``: either the pasted Markdown file or
    ``archive``, a base64 zip of a skill folder (``SKILL.md`` plus bundled
    files). ``name`` overrides the front matter; ``replace`` updates a skill of
    the same name instead of failing.
    """
    # Front matter plus body; the body alone is capped again after parsing.
    markdown = serializers.CharField(
        required=False, allow_blank=True, trim_whitespace=False, max_length=MAX_CONTENT_CHARS + 2000,
    )
    # Base64 grows the zip by 4/3; the decoded size is checked again when unpacking.
    archive = serializers.CharField(required=False, allow_blank=True, max_length=(MAX_ARCHIVE_BYTES * 4) // 3 + 8)
    name = serializers.RegexField(SKILL_NAME_PATTERN, required=False, allow_blank=True, max_length=64)
    replace = serializers.BooleanField(required=False, default=False)

    class Meta:
        ref_name = 'SkillInstall'

    def validate(self, attrs):
        if bool(attrs.get('markdown')) == bool(attrs.get('archive')):
            raise serializers.ValidationError({'markdown': 'Send either markdown or archive.'})
        return attrs


class SkillUpdateSerializer(serializers.Serializer):
    """Body of ``ai/skill/<name>/update/``: the whole file again."""
    markdown = serializers.CharField(trim_whitespace=False, max_length=MAX_CONTENT_CHARS + 2000)

    class Meta:
        ref_name = 'SkillUpdate'
