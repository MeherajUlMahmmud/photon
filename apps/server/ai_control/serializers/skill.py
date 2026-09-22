from rest_framework import serializers

from ai_control.models import SkillModel
from ai_control.services.skill_service import MAX_CONTENT_CHARS, SKILL_NAME_PATTERN


class SkillModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = SkillModel
        ref_name = 'SkillModelMeta'
        fields = ['id', 'name', 'description', 'content', 'created_at', 'updated_at']
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
    Body of ``ai/skill/install/``: the pasted Markdown file. ``name`` overrides
    the front matter; ``replace`` updates a skill of the same name instead of
    failing.
    """
    # Front matter plus body; the body alone is capped again after parsing.
    markdown = serializers.CharField(trim_whitespace=False, max_length=MAX_CONTENT_CHARS + 2000)
    name = serializers.RegexField(SKILL_NAME_PATTERN, required=False, allow_blank=True, max_length=64)
    replace = serializers.BooleanField(required=False, default=False)

    class Meta:
        ref_name = 'SkillInstall'


class SkillUpdateSerializer(serializers.Serializer):
    """Body of ``ai/skill/<name>/update/``: the whole file again."""
    markdown = serializers.CharField(trim_whitespace=False, max_length=MAX_CONTENT_CHARS + 2000)

    class Meta:
        ref_name = 'SkillUpdate'
