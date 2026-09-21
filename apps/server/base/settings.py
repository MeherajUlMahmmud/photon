import base64
import hashlib
from pathlib import Path

from decouple import config
import dj_database_url
from django.core.exceptions import ImproperlyConfigured

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = config('SECRET_KEY', default='django-insecure-key-for-dev')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = config('DEBUG', default='True').lower() in ('true', '1', 't')

ALLOWED_HOSTS = [
    h.strip()
    for h in config('ALLOWED_HOSTS', default='localhost,127.0.0.1').split(',')
    if h.strip()
]

if not DEBUG and SECRET_KEY.startswith('django-insecure'):
    raise ImproperlyConfigured('SECRET_KEY must be set when DEBUG is off')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third party
    'corsheaders',
    'django_filters',
    'rest_framework',
    'rest_framework_simplejwt.token_blacklist',
    # Local
    'common',
    'user_control',
    'workspace_control',
    'ai_control',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'base.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'base.wsgi.application'

DATABASES = {
    'default': dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}
if DATABASES['default'].get('ENGINE', '').endswith('sqlite3'):
    DATABASES['default'].setdefault('OPTIONS', {})['timeout'] = 20

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'photon-default',
    }
}

AUTH_USER_MODEL = 'user_control.UserModel'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

from base.settings_parts.rest_api import (  # noqa: E402
    CORS_ALLOW_ALL_ORIGINS,
    CORS_ALLOWED_ORIGINS,
    REST_FRAMEWORK,
    build_simple_jwt,
)

SIMPLE_JWT = build_simple_jwt(SECRET_KEY)

# Fernet key for API keys stored in user_control.UserSecretModel. Kept apart from
# the database so a leaked DB alone doesn't expose keys. In DEBUG a key is derived
# from SECRET_KEY so local setup needs no extra step.
FERNET_KEY = config('FERNET_KEY', default='')
if not FERNET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured('FERNET_KEY must be set when DEBUG is off')
    FERNET_KEY = base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest()).decode()

from base.settings_parts.logging import build_logging_config  # noqa: E402

LOGGING = build_logging_config(DEBUG)
