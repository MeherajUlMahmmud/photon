import logging
import os
import sys

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, PermissionDenied, ValidationError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from common.constants.error_messages import ErrorMessage

logger = logging.getLogger(__name__)

# Exceptions whose text was written for a person: a service's ``ValueError``
# ("Client must have invoice_start_date …"), a validation error, a DRF
# ``APIException``. Their message may reach the client as-is. Anything else in
# flight — a ``ProgrammingError`` naming a missing column, a ``KeyError``, an
# ``AttributeError`` — is an internal fault, and its text is stripped from the
# response and written to the log with the traceback instead.
_AUTHORED_EXCEPTIONS = (
    ValueError, PermissionError, PermissionDenied, ValidationError, APIException, ObjectDoesNotExist, Http404,
)
_local_packages = None


def _is_local_package(name):
    """True when ``name`` is one of this project's own top-level packages.

    An exception class defined in the project (``GoogleAuthError``,
    ``ContractorPerformanceReportError``) carries a message someone wrote for
    the screen, like ``ValueError`` does; one from Django, psycopg2 or the
    standard library does not.
    """
    global _local_packages
    if _local_packages is None:
        base = str(getattr(settings, 'BASE_DIR', ''))
        found = set()
        if base and os.path.isdir(base):
            for entry in os.listdir(base):
                if os.path.isfile(os.path.join(base, entry, '__init__.py')):
                    found.add(entry)
        _local_packages = found
    return name in _local_packages


def _exception_is_authored(exc):
    if isinstance(exc, _AUTHORED_EXCEPTIONS):
        return True
    return _is_local_package((type(exc).__module__ or '').split('.')[0])


def _cut(value, needles):
    """``value`` with every needle removed, recursing through lists and dicts.

    A string left empty (or only punctuation) by the cut becomes None, so the
    caller can fall back to a generic message rather than send ": ".
    """
    if isinstance(value, str):
        out = value
        for needle in needles:
            out = out.replace(needle, '')
        out = out.strip().rstrip(' :-–—(.').strip()
        return out or None
    if isinstance(value, dict):
        return {key: _cut(item, needles) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_cut(item, needles) for item in value]
    return value


def _scrub_in_flight_exception(message, errors, status_code):
    """Keep an internal exception's text out of an error response, and log the trace.

    Called from every error response. If the response is being built inside an
    ``except`` block (``sys.exc_info()`` is set) and the exception is not one
    whose message was authored for people, then: the exception's text is cut
    out of ``message`` (and ``errors`` when it is that same text), a generic
    message stands in when nothing is left, and the traceback is logged at
    ERROR — whether or not the view logged anything itself. With ``DEBUG`` on
    the exception is also returned under ``debug`` so a developer still sees
    it. Returns ``(message, errors, debug)``.
    """
    exc = sys.exc_info()[1]
    if exc is None or status.is_success(status_code) or _exception_is_authored(exc):
        return message, errors, None

    detail = str(exc).strip()
    exc_name = type(exc).__name__
    needles = [needle for needle in (detail, exc_name) if needle]
    message = _cut(message, needles) if message else message
    errors = _cut(errors, needles)
    if not message:
        message = ErrorMessage.GENERIC_ERROR_MESSAGE
    logger.error(
        '[ApiResponse] %s while answering HTTP %s (%s)', exc_name, status_code, message, exc_info=True,
    )
    debug = {'exception': exc_name, 'detail': detail} if settings.DEBUG else None
    return message, errors, debug


class ApiResponse:
    """
    Standardizes API responses across the application.
    Provides methods for success and error responses with consistent structure.
    """

    @staticmethod
    def format_response(data=None, message=None, status_code=status.HTTP_200_OK, errors=None, meta=None):
        """
        Creates a standardized response object

        Args:
            data: The response data (can be any serializable object)
            message: A message describing the response
            status_code: HTTP status code
            errors: List of error details or error object
            meta: Additional metadata (pagination info, etc.)

        Returns:
            Response: DRF Response object with standardized format
        """
        return Response(
            ApiResponse.to_dict(data=data, message=message, status_code=status_code, errors=errors, meta=meta),
            status=status_code,
        )

    @staticmethod
    def success(data=None, message="Operation successful", status_code=status.HTTP_200_OK, meta=None):
        """
        Creates a success response
        """
        return ApiResponse.format_response(
            data=data,
            message=message,
            status_code=status_code,
            meta=meta
        )

    @staticmethod
    def created(data=None, message="Resource created successfully", meta=None):
        """
        Creates a resource creation success response (HTTP 201)
        """
        return ApiResponse.format_response(
            data=data,
            message=message,
            status_code=status.HTTP_201_CREATED,
            meta=meta
        )

    @staticmethod
    def error(message="An error occurred", status_code=status.HTTP_400_BAD_REQUEST, errors=None, meta=None):
        """
        Creates an error response
        """
        # An internal exception in flight is scrubbed and logged with its
        # traceback in ``to_dict``. A server error with none in flight, or with
        # an authored one (a service's ValueError answered as a 500), is logged
        # here so no 5xx ever goes unrecorded.
        exc = sys.exc_info()[1]
        if status_code >= 500 and (exc is None or _exception_is_authored(exc)):
            logger.error("Server error: %s", message, exc_info=exc is not None)

        return ApiResponse.format_response(
            message=message,
            status_code=status_code,
            errors=errors,
            meta=meta
        )

    @staticmethod
    def bad_request(message=ErrorMessage.INVALID_REQUEST, errors=None):
        """
        Creates a bad request error response (HTTP 400)
        """
        return ApiResponse.error(
            message=message,
            status_code=status.HTTP_400_BAD_REQUEST,
            errors=errors
        )

    @staticmethod
    def unauthorized(message=ErrorMessage.AUTHENTICATION_FAILED, errors=None):
        """
        Creates an unauthorized error response (HTTP 401)
        """
        return ApiResponse.error(
            message=message,
            status_code=status.HTTP_401_UNAUTHORIZED,
            errors=errors
        )

    @staticmethod
    def forbidden(message=ErrorMessage.PERMISSION_DENIED, errors=None):
        """
        Creates a forbidden error response (HTTP 403)
        """
        return ApiResponse.error(
            message=message,
            status_code=status.HTTP_403_FORBIDDEN,
            errors=errors
        )

    @staticmethod
    def not_found(message=ErrorMessage.RESOURCE_NOT_FOUND, errors=None):
        """
        Creates a not found error response (HTTP 404)
        """
        return ApiResponse.error(
            message=message,
            status_code=status.HTTP_404_NOT_FOUND,
            errors=errors
        )

    @staticmethod
    def validation_error(errors, message="Validation failed"):
        """
        Creates a validation error response (HTTP 422)
        """
        return ApiResponse.error(
            message=message,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            errors=errors
        )

    @staticmethod
    def server_error(message=ErrorMessage.GENERIC_ERROR_MESSAGE, errors=None):
        """
        Creates a server error response (HTTP 500)
        """
        return ApiResponse.error(
            message=message,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            # errors=errors
        )

    @staticmethod
    def to_dict(data=None, message=None, status_code=status.HTTP_200_OK, errors=None, meta=None):
        """
        Returns the response body as a dictionary for use with JsonResponse in Django views.
        
        Args:
            data: The response data (can be any serializable object)
            message: A message describing the response
            status_code: HTTP status code
            errors: List of error details or error object
            meta: Additional metadata (pagination info, etc.)
            
        Returns:
            dict: Response body dictionary that can be used with JsonResponse
        """
        debug = None
        if not status.is_success(status_code):
            message, errors, debug = _scrub_in_flight_exception(message, errors, status_code)

        response_body = {
            "status": "success" if status.is_success(status_code) else "error",
            "status_code": status_code,
        }

        if message:
            response_body["message"] = message

        if debug is not None:
            response_body["debug"] = debug

        if data is not None:
            response_body["data"] = data

        if errors is not None:
            response_body["errors"] = errors

        if meta is not None:
            response_body["meta"] = meta

        # Add request ID if available in debug mode
        if settings.DEBUG and hasattr(settings, 'REQUEST_ID_HEADER'):
            response_body["request_id"] = settings.REQUEST_ID_HEADER

        return response_body
