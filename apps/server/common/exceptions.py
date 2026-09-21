import logging
import re
from typing import Any, Dict, Union

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import serializers
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.views import exception_handler as drf_exception_handler

from common.api_response import ApiResponse

logger = logging.getLogger(__name__)


def _is_authored_prose(message: str) -> bool:
    """True for a message written as sentences rather than a one-line field check."""
    body = message.strip()
    return '. ' in body or '\n' in body


def extract_first_error_message(error_detail: Any) -> str:
    """
    Extract the first error message from various error detail formats.
    
    Args:
        error_detail: Error detail from ValidationError or serializer.errors
        
    Returns:
        str: The first error message as a string
    """
    if not error_detail:
        return "Validation failed"

    # Handle string errors
    if isinstance(error_detail, str):
        return error_detail

    # Handle list errors
    if isinstance(error_detail, list):
        if error_detail:
            return str(error_detail[0])
        return "Validation failed"

    # Handle dictionary errors (field-based errors)
    if isinstance(error_detail, dict):
        if not error_detail:
            return "Validation failed"

        # Get the first field with errors
        first_field = next(iter(error_detail))
        first_field_errors = error_detail[first_field]

        # Non-field errors name no field, so there is nothing to prefix them with -
        # "Non Field Errors: Provide at least one image" was the key leaking out.
        if first_field in ('__all__', 'non_field_errors'):
            if isinstance(first_field_errors, list) and first_field_errors:
                error_msg = str(first_field_errors[0])
                return error_msg
            elif isinstance(first_field_errors, str):
                error_msg = str(first_field_errors)
                return error_msg

        # Handle nested field errors
        if isinstance(first_field_errors, dict):
            nested_message = extract_first_error_message(first_field_errors)
            # A nested message that is already a sentence names its own field —
            # "Number of Upholstery Pieces is required." Prefixing the container
            # ("Property Details: ...") only buries the part the customer needs.
            if nested_message.endswith('.'):
                return nested_message
            # Include field name if message doesn't already contain it
            if first_field not in nested_message.lower():
                return f"{first_field.replace('_', ' ').title()}: {nested_message}"
            return nested_message

        # Handle list of field errors
        if isinstance(first_field_errors, list):
            if first_field_errors:
                error_msg = str(first_field_errors[0])
                # Only DRF's own generic wording gets rewritten. A validator that
                # wrote its own sentence already knows the human label for the
                # field ("Number of Upholstery Pieces is required."), and
                # deriving one from the column name loses it.
                if "This field is required" in error_msg:
                    # Convert field name to readable format (e.g., "start_time" -> "Start time")
                    field_display = first_field.replace('_', ' ').title()
                    return f"{field_display} is required."
                if "is required" in error_msg:
                    return error_msg
                # If error already mentions the field or is specific, return as is
                if first_field.replace('_', ' ').lower() in error_msg.lower():
                    return error_msg
                # More than one sentence is prose someone wrote for the screen, not
                # DRF's one-line generic. "Geofence Exception Reason: You appear to
                # be..." named a field the cleaner never typed into.
                if _is_authored_prose(error_msg):
                    return error_msg
                # Otherwise, prefix with field name
                return f"{first_field.replace('_', ' ').title()}: {error_msg}"
            return f"Field '{first_field}' has validation errors"

        # Handle single field error
        error_msg = str(first_field_errors)
        # Same rule as above: rewrite the generic wording, keep a specific one.
        if "This field is required" in error_msg:
            field_display = first_field.replace('_', ' ').title()
            return f"{field_display} is required."
        return error_msg

    # Handle other types
    return str(error_detail)


def normalize_error_detail(error_detail: Any) -> Any:
    """Return ``error_detail`` as plain JSON types, nesting intact.

    DRF's ``ErrorDetail`` is a ``str`` subclass and serialises fine on its own,
    but a caller reading the response wants ordinary strings, lists and dicts —
    and the nesting matters: ``{"property_details": {"number_of_pieces": "..."}}``
    is what lets the quote form find the question that failed.
    """
    if isinstance(error_detail, dict):
        return {str(key): normalize_error_detail(value) for key, value in error_detail.items()}
    if isinstance(error_detail, (list, tuple)):
        return [normalize_error_detail(item) for item in error_detail]
    return str(error_detail)


def handle_validation_error(exc: Union[DRFValidationError, DjangoValidationError, serializers.ValidationError],
                            context: Dict[str, Any]) -> ApiResponse:
    """
    Handle all types of validation errors and return a consistent response.
    
    Args:
        exc: The validation error exception
        context: DRF context
        
    Returns:
        ApiResponse: Formatted error response
    """
    logger.warning(f"Validation failed: {type(exc).__name__}", exc_info=True)

    # Extract error message based on exception type
    if isinstance(exc, DRFValidationError):
        # DRF ValidationError from serializers or views
        detail = exc.detail
    elif isinstance(exc, DjangoValidationError):
        # Django ValidationError from validators
        detail = exc.message_dict if hasattr(exc, 'message_dict') else exc.messages
    elif isinstance(exc, serializers.ValidationError):
        # Serializer ValidationError
        detail = exc.detail
    else:
        # Fallback
        detail = str(exc)

    error_message = extract_first_error_message(detail) if not isinstance(detail, str) else detail

    logger.info(f"Returning first validation error: {error_message}")
    # `message` is the one sentence a page can show as-is; `errors` is the whole
    # field map, so a form that knows its fields can mark the offending one
    # instead of showing a banner and leaving the customer to hunt for it.
    return ApiResponse.bad_request(message=error_message, errors=normalize_error_detail(detail))


def custom_exception_handler(exc: Exception, context: Dict[str, Any]) -> ApiResponse:
    """
    Centralized exception handler for all API errors.
    
    Args:
        exc: The exception that occurred
        context: DRF context
        
    Returns:
        ApiResponse: Formatted error response
    """
    # Handle all types of validation errors first - BEFORE calling DRF handler
    if isinstance(exc, (DRFValidationError, DjangoValidationError, serializers.ValidationError)):
        return handle_validation_error(exc, context)

    # Let DRF handle standard exceptions first
    response = drf_exception_handler(exc, context)

    if response is not None:
        # DRF handled the exception, but we want to format it consistently
        if hasattr(exc, 'detail'):
            error_message = extract_first_error_message(exc.detail)
        else:
            error_message = str(exc)

        return ApiResponse.error(
            message=error_message,
            status_code=response.status_code
        )

    # Handle Django database integrity errors
    if isinstance(exc, IntegrityError):
        logger.error("Database integrity error", exc_info=True)
        msg = str(exc)

        # Extract field name from unique constraint errors
        match = re.search(r'Key \((.*?)\)=\((.*?)\)', msg)
        if match:
            field, value = match.groups()
            return ApiResponse.bad_request(
                message=f"A record with this {field} already exists."
            )

        return ApiResponse.bad_request(
            message="A data integrity error occurred."
        )

    # Catch-all for unhandled exceptions
    logger.critical(f"Unhandled server error: {type(exc).__name__}", exc_info=True)
    return ApiResponse.server_error()


def format_serializer_errors(serializer_errors: Dict[str, Any]) -> str:
    """
    Utility function to extract the first error message from serializer.errors.
    This can be used in views when you want to handle serializer validation manually.
    
    Args:
        serializer_errors: The errors from serializer.errors
        
    Returns:
        str: The first error message as a string
    """
    return extract_first_error_message(serializer_errors)
