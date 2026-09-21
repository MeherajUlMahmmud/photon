"""
Seed the tool registry (``LlmToolModel``).

Names and input schemas mirror the desktop's tool implementations in
``packages/tools/src``; the client dispatches on ``name``, so keep them in
sync. Existing rows are never overwritten, so re-running is safe; pass
``--update`` to refresh description, schema, risk and task keys.
"""
from django.core.management.base import BaseCommand

from ai_control.choices import LlmToolExecutorChoices, LlmToolRiskChoices
from ai_control.models import LlmToolModel

AGENT_TASKS = ["agent"]

DEFAULT_TOOLS = [
    {
        "name": "ls",
        "label": "List directory",
        "description": (
            "List files and directories at a path inside the workspace. "
            "Paths are relative to the workspace root. Use it to discover project layout before reading files."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory to list, relative to the workspace root.", "default": "."},
            },
            "additionalProperties": False,
        },
        "risk": LlmToolRiskChoices.READ.value,
        "priority": 10,
    },
    {
        "name": "cs",
        "label": "Code search",
        "description": (
            "Substring search across files inside the workspace (not a regex). "
            "Returns up to 100 matches as path, line number and the matching line. "
            "Skips node_modules, .git, dist, out and .photon."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1, "description": "Text to search for."},
                "path": {"type": "string", "description": "Directory to search in, relative to the workspace root."},
                "glob": {"type": "string", "description": "Filename pattern such as *.py; matches the basename only."},
                "caseSensitive": {"type": "boolean", "default": False},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        "risk": LlmToolRiskChoices.READ.value,
        "priority": 20,
    },
    {
        "name": "read_file",
        "label": "Read file",
        "description": (
            "Read a text file inside the workspace. Returns the content with line numbers. "
            "Use offset and limit to read a slice of a large file."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to the workspace root."},
                "offset": {"type": "integer", "minimum": 1, "description": "First line to return (1-based)."},
                "limit": {"type": "integer", "minimum": 1, "description": "Maximum number of lines to return."},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        "risk": LlmToolRiskChoices.READ.value,
        "priority": 30,
    },
    {
        "name": "write_file",
        "label": "Write file",
        "description": (
            "Create or overwrite a text file inside the workspace with the given content. "
            "Read the file first when editing so nothing is lost."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to the workspace root."},
                "content": {"type": "string", "description": "Full new content of the file."},
            },
            "required": ["path", "content"],
            "additionalProperties": False,
        },
        "risk": LlmToolRiskChoices.WRITE.value,
        "priority": 40,
    },
    {
        "name": "bash",
        "label": "Run shell command",
        "description": (
            "Run a shell command inside the workspace and return stdout, stderr and the exit code. "
            "Commands time out after 30 seconds and output is capped at 256 KiB. "
            "Keep commands small and reversible; prefer ls, cs and read_file for discovery."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "minLength": 1, "description": "Command line to run with bash."},
                "cwd": {"type": "string", "description": "Working directory relative to the workspace root."},
            },
            "required": ["command"],
            "additionalProperties": False,
        },
        "risk": LlmToolRiskChoices.SHELL.value,
        "priority": 50,
    },
]

UPDATABLE_FIELDS = ("label", "description", "input_schema", "risk", "executor", "task_keys")


class Command(BaseCommand):
    help = 'Create the default agent tool rows (ls, cs, read_file, write_file, bash)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--update', action='store_true',
            help='Also refresh description, schema, risk and task keys on existing rows',
        )

    def handle(self, *args, **options):
        created_count = updated_count = skipped_count = 0
        for spec in DEFAULT_TOOLS:
            spec = {**spec, "executor": LlmToolExecutorChoices.CLIENT.value, "task_keys": list(AGENT_TASKS)}
            existing = LlmToolModel.objects.filter(name=spec["name"]).first()
            if existing is None:
                LlmToolModel.objects.create(**spec)
                created_count += 1
                self.stdout.write(self.style.SUCCESS(
                    f"Created: {spec['name']} (risk={spec['risk']}, priority={spec['priority']})"
                ))
                continue
            if options['update']:
                for field in UPDATABLE_FIELDS:
                    setattr(existing, field, spec[field])
                existing.save()
                updated_count += 1
                self.stdout.write(f"Updated: {spec['name']}")
            else:
                skipped_count += 1
                self.stdout.write(f"Already exists: {spec['name']}")
        self.stdout.write(self.style.SUCCESS(
            f"Done. {created_count} created, {updated_count} updated, {skipped_count} skipped."
        ))
