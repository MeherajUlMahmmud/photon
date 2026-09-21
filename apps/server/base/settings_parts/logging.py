def build_logging_config(debug: bool) -> dict:
    level = 'DEBUG' if debug else 'INFO'
    return {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {
            'verbose': {
                'format': '{asctime} {levelname} {name} {message}',
                'style': '{',
            },
        },
        'handlers': {
            'console': {
                'class': 'logging.StreamHandler',
                'formatter': 'verbose',
            },
        },
        'root': {
            'handlers': ['console'],
            'level': 'WARNING',
        },
        'loggers': {
            'django': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
            'common': {'handlers': ['console'], 'level': level, 'propagate': False},
            'user_control': {'handlers': ['console'], 'level': level, 'propagate': False},
            'workspace_control': {'handlers': ['console'], 'level': level, 'propagate': False},
            'ai_control': {'handlers': ['console'], 'level': level, 'propagate': False},
        },
    }
