from django.db import models


class DeviceTypeChoices(models.TextChoices):
    DESKTOP_APP = "DESKTOP_APP", "Desktop App"
    DESKTOP = "DESKTOP", "Desktop"
    MOBILE = "MOBILE", "Mobile"
    TABLET = "TABLET", "Tablet"
