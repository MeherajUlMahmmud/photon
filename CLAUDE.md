# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Photon is

Local-first desktop AI teammate: an Electron app opens a workspace folder and an agent does multi-step work there (search, read, write, run shell) with per-call approvals. pnpm monorepo (TypeScript, Node >= 20) plus a separate Django + DRF server in Python. Product plan and rationale: `docs/PLAN.md`. Server API reference and conventions: `apps/server/README.md`.

## Commands

Two processes are needed to run the app: the Python server and the Electron app.

```bash
# one-time
pnpm install
python3 -m venv apps/server/.venv && apps/server/.venv/bin/pip install -r apps/server/requirements.txt
(cd apps/server && .venv/bin/python manage.py migrate \
  && .venv/bin/python manage.py 3_create_default_llm_providers \
  && .venv/bin/python manage.py 4_create_default_llm_tools)

pnpm server          # Django API on http://127.0.0.1:8080 (terminal 1)
pnpm dev             # builds packages, then electron-vite dev (terminal 2)

pnpm build           # packages + desktop production build
pnpm build:packages  # shared, harness, tools (tsc) — desktop imports their dist/
pnpm typecheck       # every workspace package
pnpm test            # builds packages, then node --test in every package
pnpm test:server     # Django test suite
```

Single tests:

```bash
# TS packages use node's built-in runner via tsx; run one file directly
cd packages/tools && node --import tsx --test src/tools.test.ts
cd apps/desktop && node --import tsx --test src/main/agent.test.ts
# Django: dotted path
cd apps/server && .venv/bin/python manage.py test user_control.tests.test_auth.LoginTests
cd apps/server && .venv/bin/python manage.py test ai_control.tests.test_agent
```

`packages/*` must be rebuilt (`pnpm build:packages`) before desktop typecheck/tests see changes to them — the desktop resolves `@photon/*` through `dist/`.

If Electron fails with "Electron uninstall": `pnpm --filter @photon/desktop run postinstall` (writes `path.txt`), then `pnpm dev`.

Server needs the seeded `LlmProviderModel` / `LlmToolModel` rows; `--update` on either management command refreshes defaults. API keys are entered per user in the app's Settings > Providers page and stored Fernet-encrypted server-side.

## Architecture

### Brain / hands split

The server is the agent's brain, the desktop is its hands. The server owns the transcript and calls the LLM; the desktop executes tools on the local filesystem.

- `apps/server/ai_control` — `AgentSessionModel` + `AgentMessageModel` / `AgentToolCallModel` (transcript), `LlmToolModel` (tool schemas + `risk`), `LlmProviderModel` (provider registry, no keys), `LLMOrchestrator` (priority-ordered provider fallback), provider clients in `llm/providers/` keyed by `api_style` (`anthropic` | `openai_compatible`). Every model call is logged in `LlmApiCallModel` with `trace_id` = session id.
- `apps/desktop/src/main/agent.ts` — `AgentTurn`: one user message = a loop of HTTP *steps* against `POST /api/ai/agent/session/<id>/step/stream/` (NDJSON). When `done.stop_reason == "tool_use"`, it runs each `pending_tool_calls` entry from `packages/tools` inside a `PathSandbox`, pausing on `approval_needed` for `write`/`shell`/`destructive` risk, then posts `{tool_results}` as the next step. Repeats until `end_turn` / `max_steps` / error / cancel. "Allow for this chat" answers live in main (`sessionAllowances`) so renderer reloads don't forget them.
- Tool **names must match** on both sides: `packages/tools/src/index.ts` (`createDefaultToolset`) and the server seed `4_create_default_llm_tools`. Adding a tool means both a `ToolDefinition` and a server row. Exception: server-side tools (`executor: server`, e.g. `read_skill_file`) live only in `services/server_tool_service.py`; the step answers them itself and reports them in `done.resolved_tool_calls`.
- **Skills** (`SkillModel`, per user) are Markdown prompts installed by pasting a file (or uploading a zip whose `SKILL.md` is the prompt and whose other text files become `SkillFileModel` rows, read via `read_skill_file`) in Settings > Skills and invoked as `/name args` from the composer. The renderer only parses the `/name` token (`lib/skills.ts`, `components/chat/skill-menu.tsx`) and sends `{content: args, skill: name}`; the server (`services/skill_service.py`) expands the instructions into the user turn for both agent steps and plain completions, so skill text never lives in the client.
- **Companion** (`apps/desktop/src/main/companion.ts`, `pages/companion-page.tsx`): a frameless always-on-top overlay at `#/companion`, summoned by a global shortcut (`Alt+Space`, falling back to `CommandOrControl+Shift+Space`) or the menu-bar tray. Each summon captures the display under the pointer *before* showing (`desktopCapturer`, JPEG, long edge ≤ 1568 px; macOS Screen Recording permission). The screenshot rides only on the next user message as `images: [{media_type, data}]` on `/api/ai/completion/stream/`; providers turn it into image blocks, `LlmApiCallModel.prompt_text` records `[image …]` only, and nothing is persisted. The overlay signs in through the main window: both share the token pair in `localStorage` (synced by `storage` events), and `ApiClient.refresh` is single-flight per refresh token so rotation can't sign one window out. Settings live per machine in `userData/companion.json` (`companion-settings.ts`), edited in Settings > Companion. Main never pushes data at a window that may still be loading: it stores it and pings, and the renderer calls a `take*` IPC (`companion:takePending`, `annotate:takeShot`, `app:takeAnnotation`) on mount and on each ping.
- **Annotate** (`main/annotate.ts`, `pages/annotate-page.tsx` at `#/annotate`): Ctrl + long press (global mouse hook via `uiohook-napi`, mouse events only, needs macOS Accessibility; `long-press.ts` is the pure detector) or `Alt+Shift+Space` freezes the display into a full-screen overlay; the user draws box/arrow/pen/text, and the flattened JPEG goes to the companion (`attachToCompanion`) or a new plain chat in the main window. Plain chats and the companion accept attachments (`lib/attachments.ts`: images as image blocks, text files inlined as `<file>` blocks); images live in memory only and `use-chats` persists just `imageCount`.
- `packages/harness/src/run.ts` is a standalone local loop (model → tools → approvals → repeat) used by tests and as the reference contract; production runs the server-driven loop above.

### Desktop process boundaries

- **main** (`src/main/`): only place that talks HTTP (`ApiClient`, base URL from `PHOTON_API_URL`, handles 401 refresh), runs tools, reads workspace files (`ipc.ts`, size-capped, path-contained), local Whisper dictation (`dictation.ts`). Registers every `ipcMain.handle` in `ipc.ts`.
- **preload** (`src/preload/api.ts`): the `window.photon` surface and its TS types. Renderer types for server entities live here, not in the renderer.
- **renderer** (`src/renderer/src/`): React 19 + react-router + Tailwind v4 + shadcn (new-york, Phosphor icons; alias `@` → `src/renderer/src`). Never touches HTTP or the filesystem. `hooks/use-chats.tsx` mirrors `AgentEvent`s into turns; `components/chat/tool-turn.tsx` renders a tool call card. Plain (non-workspace) chats use the tool-less `/api/ai/completion/stream/` endpoint.

### Packages

- `packages/shared` — `PathSandbox` (canonicalizes with realpath, refuses paths outside allowlisted roots; every tool resolves paths through it), zod schemas for `ToolRisk`, `HarnessEvent`, `ApprovalDecision`.
- `packages/harness` — `ToolDefinition` / `ToolContext` / `ToolRegistry` / `ModelProvider` contracts, `run()` loop, `fake-provider.ts` for tests.
- `packages/tools` — `ls`, `cs` (content search; skips binaries, >512 KiB files, `node_modules`/`.git`/etc.), `read_file`, `write_file`, `bash`. Each exports a `ToolDefinition` with zod `inputSchema` and `risk`.

Boundary rule from `docs/PLAN.md`: `apps/desktop` must not implement tool logic; tools live in `packages/tools`, the loop contract in `packages/harness`. No agent framework (LangChain, AI SDK, Claude Agent SDK) — thin provider adapters only.

### Server conventions

Follows the `shining-services-server` layout: `base/` project package, `*_control` apps, one file per entity under `views/`, `serializers/`, `services/`. Naming: `{Entity}Model`, `{Verb}{Entity}APIView`, `{Entity}ModelSerializer.{List,Details,...}`. Every response is the `ApiResponse` envelope `{status, status_code, message, data?, errors?, meta?}`; `data` is omitted when empty, and the desktop `ApiClient` returns just `data`. `common/models.py` `BaseModel` gives UUID pk, soft-delete flags and audit columns. Auth is JWT (simplejwt, rotating refresh with blacklist); login lockout and rate limits are in `user_control/constants.py`.

Agent session status machine: `idle → running → awaiting_tools | idle | error`. A step on a `running` session returns `409` unless it has been running > 10 minutes; new `content` while `awaiting_tools` cancels pending calls first. Tool results must cover exactly the pending `call_id`s (partial/unknown/duplicate → `400`); unknown tool names are rejected server-side and reported in `done.rejected_tool_calls`.
