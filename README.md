# Photon

Local-first desktop AI teammate. See [docs/PLAN.md](docs/PLAN.md).

## Develop

The desktop app needs the Python server running (see [apps/server/README.md](apps/server/README.md)):

```bash
pnpm install
python3 -m venv apps/server/.venv && apps/server/.venv/bin/pip install -r apps/server/requirements.txt
(cd apps/server && .venv/bin/python manage.py migrate && .venv/bin/python manage.py 3_create_default_llm_providers)
pnpm server   # terminal 1: API on http://127.0.0.1:8080
pnpm dev      # terminal 2: Electron app
```

If Electron fails with “Electron uninstall”, the binary extract was incomplete:

```bash
pnpm --filter @photon/desktop run postinstall
pnpm dev
```

`postinstall` writes Electron `path.txt` if needed.

## Packages

| Package | Role |
|---|---|
| `apps/desktop` | Electron host (UI, IPC; calls the server from main) |
| `apps/server` | Django + DRF server: auth (JWT), settings, Fernet secrets, workspaces, LLM provider routing |
| `packages/harness` | Tool contract (`ToolDefinition`, `ToolContext`) and a standalone local loop used in tests |
| `packages/tools` | `ls`, `cs`, `read_file`, `write_file`, `bash`; names match the server's tool registry |
| `packages/shared` | Shared types, schemas and the `PathSandbox` that keeps tools inside the workspace |

## Agent loop (workspace chats)

The server is the brain, the desktop is the hands. A chat started from a Space creates an agent session on the server (`apps/desktop/src/main/ipc.ts` adds the folder path and device info); each message is one `runAgentTurn`:

1. `apps/desktop/src/main/agent.ts` streams a model step from `POST /api/ai/agent/session/<id>/step/stream/`.
2. When the step ends with `tool_use`, main runs each pending call from `packages/tools` inside a `PathSandbox` rooted at the workspace. `write`/`shell`/`destructive` calls pause on an `approval_needed` event until the user clicks Allow, Allow for this chat, or Deny.
3. Results go back as the next step; repeat until `end_turn`, `max_steps`, an error or a cancel.

Every event (`start`, `delta`, `tool_call`, `approval_needed`, `tool_running`, `tool_result`, `step_done`, `done`, `error`) reaches the renderer through `window.photon.onAgentEvent`; `use-chats.tsx` mirrors them into turns and `tool-turn.tsx` renders each call as a card with its input, output, timing and status. Plain chats on the Chat tab still use the tool-less completion endpoint.
