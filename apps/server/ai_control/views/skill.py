import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from ai_control.models import SkillModel
from ai_control.serializers.skill import SkillInstallSerializer, SkillModelSerializer, SkillUpdateSerializer
from ai_control.services import SkillError, SkillService
from common.api_response import ApiResponse

logger = logging.getLogger(__name__)


def _skill_error(e: SkillError):
    return ApiResponse.error(message=str(e), status_code=e.status_code)


class GetSkillListAPIView(APIView):
    """Every skill the caller has installed, by name. Small lists: not paginated."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = SkillModel.objects.filter(user=request.user).order_by('name')
        return ApiResponse.success(
            message='Skill list fetched successfully', data=SkillModelSerializer.List(rows, many=True).data,
        )


class InstallSkillAPIView(APIView):
    """Create a skill from a pasted Markdown file."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = SkillInstallSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            skill = SkillService.install(
                request.user, data['markdown'], name=data.get('name') or None, replace=data['replace'],
            )
        except SkillError as e:
            return _skill_error(e)
        logger.info('[InstallSkillAPIView] Skill installed - user_id=%s, name=%s', request.user.id, skill.name)
        return ApiResponse.created(message='Skill installed', data=SkillModelSerializer.Details(skill).data)


class GetSkillDetailsAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, name):
        try:
            skill = SkillService.get(request.user, name)
        except SkillError as e:
            return _skill_error(e)
        return ApiResponse.success(message='Skill fetched successfully', data=SkillModelSerializer.Details(skill).data)


class UpdateSkillAPIView(APIView):
    """Replace the file behind a skill; a different ``name`` in the file renames it."""
    permission_classes = [IsAuthenticated]

    def put(self, request, name):
        serializer = SkillUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            skill = SkillService.update(request.user, name, serializer.validated_data['markdown'])
        except SkillError as e:
            return _skill_error(e)
        logger.info('[UpdateSkillAPIView] Skill updated - user_id=%s, name=%s', request.user.id, skill.name)
        return ApiResponse.success(message='Skill updated', data=SkillModelSerializer.Details(skill).data)


class DeleteSkillAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, name):
        try:
            SkillService.delete(request.user, name)
        except SkillError as e:
            return _skill_error(e)
        logger.info('[DeleteSkillAPIView] Skill removed - user_id=%s, name=%s', request.user.id, name)
        return ApiResponse.success(message='Skill removed')
