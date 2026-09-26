from rest_framework import serializers

from workspace_control.models import WorkspaceModel


class WorkspaceModelSerializerMeta(serializers.ModelSerializer):
    class Meta:
        model = WorkspaceModel
        ref_name = 'WorkspaceModelMeta'
        fields = ['id', 'name', 'root_path', 'created_at', 'last_opened_at', 'archived_at']
        read_only_fields = ['id', 'name', 'created_at', 'last_opened_at', 'archived_at']


class WorkspaceModelSerializer:
    class List(WorkspaceModelSerializerMeta):
        class Meta(WorkspaceModelSerializerMeta.Meta):
            ref_name = 'WorkspaceModelList'

    class Details(WorkspaceModelSerializerMeta):
        class Meta(WorkspaceModelSerializerMeta.Meta):
            ref_name = 'WorkspaceModelDetails'

    class Open(serializers.Serializer):
        """Body of ``workspace/open/``: the folder the client picked."""
        root_path = serializers.CharField(max_length=4096, trim_whitespace=True)

        class Meta:
            ref_name = 'WorkspaceModelOpen'

        def validate_root_path(self, value):
            if '\x00' in value:
                raise serializers.ValidationError('Invalid path.')
            return value
