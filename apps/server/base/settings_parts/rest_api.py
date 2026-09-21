import datetime

from decouple import config

REST_FRAMEWORK = {
    'NON_FIELD_ERRORS_KEY': 'error',
    'COERCE_DECIMAL_TO_STRING': False,
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'EXCEPTION_HANDLER': 'common.exceptions.custom_exception_handler',
    'DEFAULT_FILTER_BACKENDS': [
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
        'django_filters.rest_framework.DjangoFilterBackend',
    ],
    'DATETIME_INPUT_FORMATS': ['iso-8601', '%Y-%m-%d %H:%M', '%Y-%m-%d'],
    'DEFAULT_PAGINATION_CLASS': 'common.custom_pagination.CustomPageNumberPagination',
    'PAGE_SIZE': 30,
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.FormParser',
        'rest_framework.parsers.MultiPartParser',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
}


def build_simple_jwt(signing_key: str) -> dict:
    return {
        'ACCESS_TOKEN_LIFETIME': datetime.timedelta(minutes=30),
        'REFRESH_TOKEN_LIFETIME': datetime.timedelta(days=30),
        'ROTATE_REFRESH_TOKENS': True,
        'BLACKLIST_AFTER_ROTATION': True,
        'UPDATE_LAST_LOGIN': False,
        'ALGORITHM': 'HS256',
        'SIGNING_KEY': signing_key,
        'AUTH_HEADER_TYPES': ('Bearer',),
        'USER_ID_FIELD': 'id',
        'USER_ID_CLAIM': 'user_id',
    }


CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in config('CORS_ALLOWED_ORIGINS', default='').split(',') if o.strip()
]
