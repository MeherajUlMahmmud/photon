class AiControlError(Exception):
    """Base exception for ai_control."""


class AiConfigurationError(AiControlError):
    """Missing/invalid AI configuration (keys, model names, etc.)."""


class AiProviderError(AiControlError):
    """Provider call failed (network, auth, rate limit)."""


class AiUnavailableError(AiControlError):
    """No provider could answer: none configured for the user, or every attempt failed."""
