from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('common.urls')),
    path('api/', include('user_control.urls')),
    path('api/', include('workspace_control.urls')),
    path('api/', include('ai_control.urls')),
]
