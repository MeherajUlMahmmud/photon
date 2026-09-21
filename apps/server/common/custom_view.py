import logging

from rest_framework.generics import (
    CreateAPIView,
    DestroyAPIView,
    ListAPIView,
    RetrieveAPIView,
    UpdateAPIView,
)
from rest_framework.permissions import IsAuthenticated

from common.custom_pagination import CustomPageNumberPagination

logger = logging.getLogger(__name__)

# Photon has no RBAC: every resource belongs to one user. Views scope their
# queryset to ``request.user`` (see ``OwnedQuerysetMixin``) instead of checking
# resource/action grants.


class OwnedQuerysetMixin:
    """Limit ``get_queryset()`` to rows whose ``owner_field`` is the requesting user."""

    owner_field = 'user'

    def get_queryset(self):
        return super().get_queryset().filter(**{self.owner_field: self.request.user})


class CustomListAPIView(ListAPIView):
    http_method_names = ['get', 'head', 'options']
    permission_classes = [IsAuthenticated]
    pagination_class = CustomPageNumberPagination


class CustomRetrieveAPIView(RetrieveAPIView):
    http_method_names = ['get', 'head', 'options']
    permission_classes = [IsAuthenticated]


class CustomCreateAPIView(CreateAPIView):
    http_method_names = ['post']
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        # Call any custom pre-processing in subclasses
        self.pre_create(request, *args, **kwargs)
        return super().post(request, *args, **kwargs)

    def pre_create(self, request, *args, **kwargs):
        """
        Hook method that subclasses can override for custom pre-processing
        before the actual create operation.
        """
        pass


class CustomUpdateAPIView(UpdateAPIView):
    http_method_names = ['put', 'patch']
    permission_classes = [IsAuthenticated]


class CustomDestroyAPIView(DestroyAPIView):
    http_method_names = ['delete']
    permission_classes = [IsAuthenticated]
