from django.contrib import admin

from ai_control.models import LlmApiCallModel, LlmProviderModel


@admin.register(LlmProviderModel)
class LlmProviderModelAdmin(admin.ModelAdmin):
    list_display = ['name', 'provider', 'api_style', 'default_model', 'priority', 'is_active', 'updated_at']
    list_filter = ['api_style', 'is_active']
    search_fields = ['name', 'provider', 'default_model']
    ordering = ['priority', 'created_at']
    readonly_fields = ['id', 'created_at', 'updated_at']
    fieldsets = (
        ('Provider', {'fields': ('provider', 'name', 'api_style', 'api_url')}),
        ('Models', {'fields': ('default_model', 'model_ids', 'capabilities')}),
        ('Routing', {'fields': ('priority', 'is_active')}),
        ('Pricing (per 1,000,000 tokens, USD)', {
            'fields': ('input_cost_per_million_usd', 'output_cost_per_million_usd'),
            'description': 'Used to cost every recorded call. Leave at 0 to skip costing.',
        }),
        ('Audit', {'fields': ('id', 'created_at', 'updated_at')}),
    )


@admin.register(LlmApiCallModel)
class LlmApiCallModelAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'user', 'provider', 'model', 'task_key', 'status', 'total_tokens', 'latency_ms', 'cost_usd']
    list_filter = ['provider', 'status', 'task_key']
    search_fields = ['user__email', 'model', 'trace_id', 'correlation_id']
    readonly_fields = [f.name for f in LlmApiCallModel._meta.fields]
    date_hierarchy = 'created_at'

    def has_add_permission(self, request):
        return False
