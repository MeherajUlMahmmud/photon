from django.urls import path

from common.views.common import ping

urlpatterns = [
    path('ping/', ping, name='ping'),
]
