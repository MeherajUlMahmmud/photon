from django.apps import AppConfig


class UserControlConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'user_control'
    verbose_name = 'User Control'

    def ready(self):
        from user_control import signals  # noqa: F401
