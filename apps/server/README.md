# Photon server

Django + DRF service that owns Photon's data: accounts, JWT sessions, per-user settings, Fernet-encrypted API keys, and workspaces. It runs as its own process; the Electron app calls it over HTTP from the main process (`PHOTON_API_URL`, default `http://127.0.0.1:8080`).

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
.venv/bin/python manage.py runserver 8080   # http://127.0.0.1:8080
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
| `ai_control` | `LlmProviderModel` registry (endpoints + default models, no keys), `LlmApiCallModel` per-user call log, provider clients (`llm/providers/`), `LLMOrchestrator`, completion endpoint, agent sessions, `SkillModel` (per-user `/slash` prompts) |

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
| POST | `/api/ai/completion/create/` | `{messages:[{role,content,skill?,images?:[{media_type,data}]}], provider?, model?, task_key?, temperature?, max_tokens?, trace_id?}` | `{content, provider, model, call_id, usage}`; `503` when no provider could answer; a user message with `skill` is expanded server-side (`404` for an unknown skill) |
| POST | `/api/ai/completion/stream/` | same body | NDJSON events `start`, `delta`, `done` / `error` |
| GET | `/api/ai/tool/list/` | | active tools the agent may call: `name`, `description`, `input_schema`, `risk` |
| GET | `/api/ai/skill/list/` | | the caller's skills, by name: `id, name, description, content, files:[{path,size}]` |
| POST | `/api/ai/skill/install/` | `{markdown}` or `{archive}` (base64 zip ≤ 5 MB), plus `name?, replace?` | `201`; parses front matter (`name`, `description`) or falls back to the first heading / paragraph; `400` on a duplicate unless `replace`. For a zip, `data.skipped_files` lists entries left out |
| GET | `/api/ai/skill/<name>/details/` | | |
| PUT | `/api/ai/skill/<name>/update/` | `{markdown}` | a different `name` in the file renames it |
| DELETE | `/api/ai/skill/<name>/delete/` | | |
| POST | `/api/ai/agent/session/create/` | `{workspace_id?, workspace_path?, provider?, model?, task_key?, device?}` | `201` with the session; `device` is `{os, os_version?, arch?, shell?, locale?, app_version?}` |
| POST | `/api/ai/agent/session/<uuid>/update/` | `{provider?, model?}` | re-pins the model for the next steps; transcript unchanged |
| POST | `/api/ai/agent/session/<uuid>/step/stream/` | `{content, skill?}` or `{tool_results:[{call_id, ok, output?, error?}]}` | NDJSON events; see *Agent loop*. With `skill`, `content` is the arguments (may be blank) |
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
2. The client runs every pending call locally (asking the user first for `write`/`shell`/`destructive` risk) and posts `POST .../step/stream/ {tool_results: [...]}` — one entry per pending `call_id`, `ok: false` with `error: "denied"` when the user refused. Partial, unknown or duplicate ids are a `400`. Calls naming a tool the server does not know are failed server-side and listed in `done.rejected_tool_calls`; the client still posts a (possibly empty) `tool_results` step so the model sees the rejection. Tool names are cleaned of chat-template noise first (`cs<|channel|>analysis` → `cs`), which some open-weight models leak.
3. Repeat until `end_turn`.

The desktop sends `workspace_path` (the folder it is working in, which becomes the root in the prompt and must match the client's sandbox root) and `device` when it creates the session (`os` is Node's `process.platform`: `darwin`, `linux` or `win32`). It is stored on the session and turned into an *Environment* paragraph of the system prompt — OS, version, arch, shell and locale plus per-OS guidance (BSD vs GNU userland, PowerShell vs POSIX, path separators) — so commands, paths and instructions come back shaped for that machine. Without it the prompt has no environment section and the model falls back to POSIX assumptions.

Status machine: `idle → running → awaiting_tools | idle | error`. A step on a `running` session is `409` unless it has been running for over 10 minutes (abandoned worker), and a new `content` while `awaiting_tools` cancels the pending calls first so the transcript stays valid. Each step is one model call recorded in `LlmApiCallModel` (`trace_id` = session id); assistant turns and tool calls are stored in `AgentMessageModel` / `AgentToolCallModel`, and the transcript is rebuilt from them on every step (tool output clipped to 30k chars for the model). Providers without the `tool_calling` capability are skipped when tools are attached.

## Skills

A skill is a Markdown file the user pastes into Settings > Skills and invokes as `/<name> args` in the composer. `SkillModel` rows are per user (`name` unique per user; no seeding). `SkillService.parse` reads YAML-ish front matter (`name`, `description`; `key: value` lines only, folded/literal blocks supported) and strips it; without front matter the first `# Heading` (slugified) and first paragraph are used.

Invocation is server-side so the client never holds skill text: an agent step with `{content, skill}` stores the user turn as `SkillService.render(skill, content)` — a framing line, the instructions inside `<skill name="…">…</skill>`, and the arguments either replacing `$ARGUMENTS` or appended after — with `AgentMessageModel.skill` recording the name and the session title kept as `/name args`. The completion endpoints do the same for any user message carrying `skill`, which is how plain (tool-less) chats re-send a skill turn on later requests. An unknown skill is `400` on a step (session untouched) and `404` on a completion.

A skill can also be a zip of a folder: the shallowest `SKILL.md` (any case) is the skill, and the other UTF-8 text files under it become `SkillFileModel` rows (≤ 100 files, 256 KB each, 2 MB total; binaries, hidden files and `__MACOSX` are skipped and reported). `render` lists them in a `<skill_files>` block. The model reads one through `read_skill_file`, the first **server-side tool** (`LlmToolModel.executor = server`): `_persist_assistant` answers it on the spot through `ServerToolService`, stores the call completed or failed, and reports it in `done.resolved_tool_calls`; the desktop shows a card and posts an empty `tool_results` step so the model sees the result. The tool is only offered to users who have bundled files. Nothing in a skill is ever executed.

Completion user messages may carry `images` (png/jpeg/webp base64, ≤ 4). They are converted to each provider's image blocks for that call only; `LlmApiCallModel.prompt_text` records `[image <type>]`, never the data. `DATA_UPLOAD_MAX_MEMORY_SIZE` is 12 MB to fit them.

## Test

```bash
.venv/bin/python manage.py test
.venv/bin/python manage.py test user_control.tests.test_auth.LoginTests
```
