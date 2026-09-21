# Photon server

Django + DRF service that owns Photon's data: accounts, JWT sessions, per-user settings, Fernet-encrypted API keys, and workspaces. It runs as its own process; the Electron app calls it over HTTP from the main process (`PHOTON_API_URL`, default `http://127.0.0.1:8000`).

Layout and conventions follow the `shining-services-server` project (`base/` project package, `*_control` apps, `ApiResponse` envelope, `{Entity}Model` / `{Verb}{Entity}APIView` / `{Entity}ModelSerializer.{List,Details,...}` naming, one file per entity under `views/`, `serializers/`, `services/`).

## Setup

```bash
cd apps/server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # optional; defaults work for local dev
.venv/bin/python manage.py migrate
.venv/bin/python manage.py 3_create_default_llm_providers   # seeds anthropic, openai, nvidia, kimi
.venv/bin/python manage.py 4_create_default_llm_tools       # seeds ls, cs, read_file, write_file, bash
.venv/bin/python manage.py createsuperuser   # optional, for /admin/
```

## Run

```bash
.venv/bin/python manage.py runserver        # http://127.0.0.1:8000
```

Then `pnpm dev` from the repo root for the desktop app.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | dev key | Django secret; also signs JWTs. Required when `DEBUG=False` |
| `DEBUG` | `True` | |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated |
| `DATABASE_URL` | `sqlite:///db.sqlite3` | Any `dj-database-url` URL (Postgres in prod) |
| `FERNET_KEY` | derived from `SECRET_KEY` in DEBUG | Encrypts stored API keys. Required when `DEBUG=False`; generate with `Fernet.generate_key()` |
| `CORS_ALLOWED_ORIGINS` | empty | Only needed for browser clients |

## Apps

| App | Purpose |
|---|---|
| `base` | Settings (`settings_parts/` for REST/JWT/logging), root URLs mounting every app under `/api/` |
| `common` | `ApiResponse` envelope, `custom_exception_handler`, `BaseModel` (UUID pk, soft-delete flags, audit columns), `Custom*APIView`, pagination, `api_rate_limit`, `ping` |
| `user_control` | `UserModel` (email login, lockout), `LoginAttemptModel`, `UserSettingModel`, `UserSecretModel`; auth, profile, settings and secrets endpoints |
| `workspace_control` | `WorkspaceModel` — folders the desktop app has opened, per user |
| `ai_control` | `LlmProviderModel` registry (endpoints + default models, no keys), `LlmApiCallModel` per-user call log, provider clients (`llm/providers/`), `LLMOrchestrator`, completion endpoint |

## API

Every response is the envelope `{status, status_code, message, data?, errors?, meta?}`. `data` is omitted when there is nothing to return (a missing active workspace answers `{"status": "success", ...}` with no `data` key). Authenticated routes need `Authorization: Bearer <access>`.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/ping/` | | public |
| GET | `/api/auth/has-users/` | | public; `{has_users}` |
| POST | `/api/auth/register/` | `{email, password, first_name?, last_name?}` | public; 201 `{user, tokens}` |
| POST | `/api/auth/login/` | `{email, password}` | public; `{user, tokens}`; 401 on failure, 429 when rate-limited |
| POST | `/api/auth/token/refresh/` | `{refresh}` | public; `{access, refresh}` — refresh tokens rotate, old one is blacklisted |
| POST | `/api/auth/logout/` | `{refresh_token}` | blacklists that refresh token |
| POST | `/api/auth/password-change/` | `{old_password, new_password}` | blacklists every refresh token; returns fresh `{tokens}` |
| GET | `/api/user/me/` | | |
| PATCH | `/api/user/me/update/` | `{first_name?, last_name?}` | |
| GET | `/api/setting/<key>/details/` | | `{key, value, updated_at}`; `value: null` when unset |
| PUT | `/api/setting/<key>/update/` | `{value}` | upsert |
| GET | `/api/secret/<provider>/details/` | | `{provider, has_key, updated_at}` — the key itself is never returned |
| PUT | `/api/secret/<provider>/update/` | `{api_key}` | upsert |
| DELETE | `/api/secret/<provider>/delete/` | | |
| GET | `/api/workspace/list/` | | paginated: `data: {data: [...], total_records, ...}` |
| GET | `/api/workspace/active/` | | most recently opened |
| POST | `/api/workspace/open/` | `{root_path}` | upsert by path, marks it active |
| GET | `/api/ai/provider/list/` | | active providers in priority order, each with `has_key` for this user and `model_ids` |
| POST | `/api/ai/completion/create/` | `{messages:[{role,content}], provider?, model?, task_key?, temperature?, max_tokens?, trace_id?}` | `{content, provider, model, call_id, usage}`; `503` when no provider could answer |
| POST | `/api/ai/completion/stream/` | same body | NDJSON events `start`, `delta`, `done` / `error` |
| GET | `/api/ai/tool/list/` | | active tools the agent may call: `name`, `description`, `input_schema`, `risk` |
| POST | `/api/ai/agent/session/create/` | `{workspace_id?, provider?, model?, task_key?, device?}` | `201` with the session; `device` is `{os, os_version?, arch?, shell?, locale?, app_version?}` |
| POST | `/api/ai/agent/session/<uuid>/step/stream/` | `{content}` or `{tool_results:[{call_id, ok, output?, error?}]}` | NDJSON events; see *Agent loop* |
| POST | `/api/ai/agent/session/<uuid>/step/create/` | same body | final `done` event as JSON plus `content` |
| POST | `/api/ai/agent/session/<uuid>/cancel/` | | drops pending tool calls, session back to `idle` |
| GET | `/api/ai/agent/session/list/` | | paginated; filters `status`, `task_key`, `workspace` |
| GET | `/api/ai/agent/session/<uuid>/details/` | | messages in order, each with its `tool_calls`, plus `pending_tool_calls` |
| GET | `/api/ai/call/list/` | | paginated; filters `provider`, `model`, `task_key`, `status`, `trace_id`, `created_at_after/_before` |
| GET | `/api/ai/call/<uuid>/details/` | | includes stored prompt/response text |

## Auth details

- Passwords: Django's default hasher (PBKDF2-SHA256). Rules: 8–128 chars with an uppercase letter, a lowercase letter and a digit.
- Tokens: simplejwt. Access tokens last 30 minutes, refresh tokens 30 days and rotate on every refresh (`rest_framework_simplejwt.token_blacklist` is installed).
- Lockout: 5 failed logins lock the account for 30 minutes (`user_control/constants.py`). Every attempt is recorded in `LoginAttemptModel`.
- Login is rate-limited to 10 requests per minute per IP and per email; register to 10 per hour per IP. The limiter uses Django's cache, which is `LocMemCache` here — switch to Redis before running more than one worker.
- Unknown emails still run a password hash so response time doesn't reveal which accounts exist.

## LLM routing

Providers are rows in `LlmProviderModel` (admin-editable; `3_create_default_llm_providers --update` refreshes seeded defaults). Each has an `api_style` — `anthropic` or `openai_compatible` — which selects the client in `ai_control/llm/providers/`; NVIDIA NIM and Kimi (Moonshot) both speak the OpenAI shape, so adding a similar vendor is a new row plus a `LlmProviderChoices` entry.

`LLMOrchestrator.run_completion(user, messages, provider=None, model=None)` walks active providers by `priority`, skips ones the user has no `UserSecretModel` key for, and falls through to the next on failure. A pinned `provider` is tried first; pinning `model` too makes it strict (no fallback, since model ids are vendor-specific). Every attempt is recorded in `LlmApiCallModel` with tokens, latency and cost (when the provider row has prices); prompt/response text is stored truncated to 20k chars. Decrypted keys are used in memory for the call and never written anywhere.

## Agent loop

The server is the agent's brain; the desktop is its hands. Tools are rows in `LlmToolModel` (`4_create_default_llm_tools --update` refreshes them) and their names match the desktop's implementations in `packages/tools`. A session (`AgentSessionModel`) owns the transcript; one user turn is several HTTP *steps*:

1. `POST .../step/stream/ {content}` — the server sends the transcript plus tool schemas to the model and streams `start`, `delta`, `tool_call` and finally `done`. `done.stop_reason` is `end_turn`, `tool_use` (with `pending_tool_calls: [{call_id, name, input, risk}]`) or `max_steps`.
2. The client runs every pending call locally (asking the user first for `write`/`shell`/`destructive` risk) and posts `POST .../step/stream/ {tool_results: [...]}` — one entry per pending `call_id`, `ok: false` with `error: "denied"` when the user refused. Partial, unknown or duplicate ids are a `400`.
3. Repeat until `end_turn`.

The desktop sends `device` when it creates the session (`os` is Node's `process.platform`: `darwin`, `linux` or `win32`). It is stored on the session and turned into an *Environment* paragraph of the system prompt — OS, version, arch, shell and locale plus per-OS guidance (BSD vs GNU userland, PowerShell vs POSIX, path separators) — so commands, paths and instructions come back shaped for that machine. Without it the prompt has no environment section and the model falls back to POSIX assumptions.

Status machine: `idle → running → awaiting_tools | idle | error`. A step on a `running` session is `409` unless it has been running for over 10 minutes (abandoned worker), and a new `content` while `awaiting_tools` cancels the pending calls first so the transcript stays valid. Each step is one model call recorded in `LlmApiCallModel` (`trace_id` = session id); assistant turns and tool calls are stored in `AgentMessageModel` / `AgentToolCallModel`, and the transcript is rebuilt from them on every step (tool output clipped to 30k chars for the model). Providers without the `tool_calling` capability are skipped when tools are attached.

## Test

```bash
.venv/bin/python manage.py test
.venv/bin/python manage.py test user_control.tests.test_auth.LoginTests
```
