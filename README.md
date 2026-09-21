# Photon

Local-first desktop AI teammate. See [docs/PLAN.md](docs/PLAN.md).

## Develop

The desktop app needs the Python server running (see [apps/server/README.md](apps/server/README.md)):

```bash
pnpm install
python3 -m venv apps/server/.venv && apps/server/.venv/bin/pip install -r apps/server/requirements.txt
(cd apps/server && .venv/bin/python manage.py migrate && .venv/bin/python manage.py 3_create_default_llm_providers)
pnpm server   # terminal 1: API on http://127.0.0.1:8000
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
| `packages/harness` | Custom agent loop |
| `packages/tools` | `bash`, `ls`, `cs` |
| `packages/shared` | Shared types and schemas |
