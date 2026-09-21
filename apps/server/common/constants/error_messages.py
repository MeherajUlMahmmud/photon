class ErrorMessage:
    """
    Class containing all error messages used throughout the application.
    Centralizing error messages helps maintain consistency and makes changes easier.
    """
    # Authentication errors
    INVALID_CREDENTIALS = "Invalid credentials provided."
    AUTHENTICATION_FAILED = "Authentication failed."
    TOKEN_EXPIRED = "Authentication token has expired."
    TOKEN_INVALID = "Invalid authentication token."
    PERMISSION_DENIED = "You do not have permission to perform this action."

    # User related errors
    USER_NOT_FOUND = "User not found."
    USER_ALREADY_EXISTS = "User with this email already exists."
    INVALID_EMAIL_FORMAT = "Invalid email format."
    WEAK_PASSWORD = "Password does not meet security requirements."
    ACCOUNT_DISABLED = "This account has been disabled."
    ACCOUNT_LOCKED = "This account is temporarily locked. Please try again later."

    # General API errors
    GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again later."
    RESOURCE_NOT_FOUND = "Resource not found."
    INVALID_REQUEST = "Invalid request."
    MISSING_REQUIRED_FIELD = "Missing required field: {field}."
    INVALID_FIELD_VALUE = "Invalid value for field: {field}."
    RATE_LIMIT_EXCEEDED = "Rate limit exceeded. Please try again later."
    SERVICE_UNAVAILABLE = "Service temporarily unavailable. Please try again later."
    INTERNAL_SERVER_ERROR = "An internal server error occurred."

    # IP validation errors
    IP_NOT_WHITELISTED = "Your IP address is not authorized to access this endpoint."
