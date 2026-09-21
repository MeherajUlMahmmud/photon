import django_filters

from ai_control.choices import LlmCallStatusChoices
from ai_control.models import LlmApiCallModel


class LlmApiCallModelFilter(django_filters.FilterSet):
    provider = django_filters.CharFilter(lookup_expr='iexact')
    model = django_filters.CharFilter(lookup_expr='icontains')
    task_key = django_filters.CharFilter(lookup_expr='iexact')
    status = django_filters.ChoiceFilter(choices=LlmCallStatusChoices.choices)
    trace_id = django_filters.CharFilter(lookup_expr='exact')
    created_at = django_filters.DateFromToRangeFilter()

    class Meta:
        model = LlmApiCallModel
        fields = ['provider', 'model', 'task_key', 'status', 'trace_id', 'created_at']
