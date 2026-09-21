import logging
import time
from functools import wraps

from django.core.cache import cache
from rest_framework import status

from common.api_response import ApiResponse
from common.utils import CommonUtils

logger = logging.getLogger(__name__)


def _request_email(request):
    # DRF parses JSON into request.data; plain Django only fills request.POST.
    data = getattr(request, 'data', None) or request.POST
    email = data.get('email', '') if hasattr(data, 'get') else ''
    if not email and request.user.is_authenticated:
        email = getattr(request.user, 'email', '')
    return (email or '').strip().lower()


def _check_window(cache_key, requests, window, now):
    """Sliding window: returns seconds to wait, or None when the request is allowed."""
    timestamps = [ts for ts in cache.get(cache_key, []) if now - ts <= window]
    if len(timestamps) >= requests:
        return window - (now - min(timestamps))
    timestamps.append(now)
    cache.set(cache_key, timestamps, window + 10)
    return None


def api_rate_limit(requests=5, window=60, key_prefix='api', use_email=True):
    """
    Rate limiter for DRF API views, limiting by client IP and (optionally) email.
    Returns a 429 ApiResponse when the limit is exceeded, using a sliding window.

    Uses Django's cache backend, so limits are per-process with LocMemCache —
    configure a shared cache (Redis) before running multiple workers.

    Usage:
        @method_decorator(api_rate_limit(requests=5, window=60, key_prefix='login'))
        def post(self, request, *args, **kwargs): ...
    """

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            request = None
            if len(args) >= 1 and hasattr(args[0], 'META'):
                request = args[0]
            elif len(args) >= 2 and hasattr(args[1], 'META'):
                request = args[1]

            if request is None:
                logger.warning('[APIRateLimit] Could not find request object for %s', func.__name__)
                return func(*args, **kwargs)

            endpoint = f"{request.method}_{request.path_info.replace('/', '_')}"
            now = time.time()
            try:
                keys = [('IP address', f'rate_limit_{key_prefix}_{endpoint}_{CommonUtils.get_client_ip(request)}')]
                if use_email:
                    email = _request_email(request)
                    if email:
                        keys.insert(0, ('email address', f'rate_limit_{key_prefix}_email_{endpoint}_{email}'))

                for label, cache_key in keys:
                    wait_time = _check_window(cache_key, requests, window, now)
                    if wait_time is not None:
                        logger.warning(
                            '[APIRateLimit] Limit exceeded - key=%s, wait=%.2fs', cache_key, wait_time,
                        )
                        return ApiResponse.error(
                            message=f'Too many requests from this {label}. '
                                    f'Please try again in {int(wait_time) + 1} seconds.',
                            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            meta={'retry_after': int(wait_time) + 1},
                        )
            except Exception as e:
                logger.error('[APIRateLimit] Error in rate limiting for %s: %s', endpoint, e)

            return func(*args, **kwargs)

        return wrapper

    return decorator
