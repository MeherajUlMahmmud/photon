"""
Support for endpoints that answer as a stream rather than one JSON document.
"""
from django.http import StreamingHttpResponse
from rest_framework.renderers import JSONRenderer


class NdjsonRenderer(JSONRenderer):
    """
    Lets a view accept ``Accept: application/x-ndjson``. The streamed body is
    written by the view itself (``StreamingHttpResponse``); this renderer only
    ever formats the non-stream replies such a view returns (validation and
    session errors), which stay ordinary JSON.
    """
    media_type = 'application/x-ndjson'
    format = 'ndjson'


class NdjsonStreamViewMixin:
    """
    For views whose success is a ``StreamingHttpResponse`` of ndjson lines.
    Accepts the ndjson media type so DRF's negotiation does not answer 406,
    and labels every other (error) reply ``application/json`` since that is
    what it is.
    """
    renderer_classes = [NdjsonRenderer, JSONRenderer]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if not isinstance(response, StreamingHttpResponse):
            # DRF sets the header from ``content_type`` when it renders, so the attribute is what to override.
            response.content_type = 'application/json'
        return response
