from django.contrib import admin

from ai_control.models import (
    AgentMessageModel,
    AgentSessionModel,
    AgentToolCallModel,
    LlmApiCallModel,
    LlmProviderModel,
    LlmToolModel,
    SkillModel,
)


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


@admin.register(LlmToolModel)
class LlmToolModelAdmin(admin.ModelAdmin):
    list_display = ['name', 'label', 'risk', 'executor', 'priority', 'is_active', 'updated_at']
    list_filter = ['risk', 'executor', 'is_active']
    search_fields = ['name', 'label', 'description']
    ordering = ['priority', 'name']
    readonly_fields = ['id', 'created_at', 'updated_at']
    fieldsets = (
        ('Tool', {'fields': ('name', 'label', 'description', 'input_schema')}),
        ('Execution', {'fields': ('risk', 'executor', 'task_keys')}),
        ('Routing', {'fields': ('priority', 'is_active')}),
        ('Audit', {'fields': ('id', 'created_at', 'updated_at')}),
    )


@admin.register(SkillModel)
class SkillModelAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'description', 'updated_at']
    search_fields = ['name', 'description', 'user__email']
    readonly_fields = ['id', 'created_at', 'updated_at']
    fieldsets = (
        ('Skill', {'fields': ('user', 'name', 'description', 'content')}),
        ('Audit', {'fields': ('id', 'created_at', 'updated_at')}),
    )


class AgentToolCallInline(admin.TabularInline):
    model = AgentToolCallModel
    fk_name = 'message'
    extra = 0
    can_delete = False
    fields = ['seq_in_message', 'name', 'status', 'call_id', 'duration_ms']
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(AgentSessionModel)
class AgentSessionModelAdmin(admin.ModelAdmin):
    list_display = ['updated_at', 'user', 'title', 'status', 'provider', 'model', 'step_count', 'workspace']
    list_filter = ['status', 'provider', 'task_key']
    search_fields = ['user__email', 'title', 'id']
    readonly_fields = [f.name for f in AgentSessionModel._meta.fields]
    date_hierarchy = 'created_at'

    def has_add_permission(self, request):
        return False


@admin.register(AgentMessageModel)
class AgentMessageModelAdmin(admin.ModelAdmin):
    list_display = ['session', 'seq', 'role', 'stop_reason', 'is_partial', 'created_at']
    list_filter = ['role', 'is_partial']
    search_fields = ['session__id', 'content']
    readonly_fields = [f.name for f in AgentMessageModel._meta.fields]
    inlines = [AgentToolCallInline]

    def has_add_permission(self, request):
        return False


@admin.register(AgentToolCallModel)
class AgentToolCallModelAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'session', 'name', 'status', 'risk', 'duration_ms']
    list_filter = ['status', 'risk', 'name']
    search_fields = ['session__id', 'call_id', 'name']
    readonly_fields = [f.name for f in AgentToolCallModel._meta.fields]

    def has_add_permission(self, request):
        return False
