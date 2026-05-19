# Little Peanut

**A desktop AI agent workspace built for local project execution.**

Little Peanut is a local-first Electron app that brings multi-model chat, agent execution, planning, pipeline orchestration, permission approval, MCP extensibility, and SQLite persistence into one desktop workflow.

[中文文档](./README.md) · [Architecture](./docs/architecture.md) · `Node.js 22+` · `Electron` · `React` · `SQLite`

---

## Why Little Peanut?

Many AI products can chat, but they are still far from being a practical local collaboration environment:

- They know the prompt, but not the project you are actually working on
- They can answer, but cannot reliably continue work inside a real workspace
- They can call tools, but often lack stable permission boundaries and recovery flows
- They may support model switching, but not unified management of providers, models, tasks, and state

Little Peanut is designed to close that gap.

It is not meant to be just a chat shell, but a real desktop agent environment for local work:

- **Local-first**: conversations, projects, model configs, and task state are stored locally
- **Controlled execution**: tool calls go through approval and risk checks
- **Plan before execution**: planning and execution are separated to avoid reckless changes
- **Recoverable**: interrupted runs can be resumed, discarded, or reviewed
- **Extensible**: the app is built to support multiple providers, MCP servers, custom models, and future skill systems

## What Is It?

Little Peanut is a desktop AI workspace. It is not trying to replace an IDE, and it is not just another browser-based chat box. Its goal is to reconnect the pieces that often get fragmented in real work: model access, tools, projects, state, memory, approvals, and recovery.

At the code level, it already contains the core structure of a local agent product:

- The Electron main process handles model adapters, agent runtime, permission gating, MCP, SQLite, and IPC
- The React renderer handles chat UI, planning panels, pipeline configuration, approval prompts, tasks, and recovery cues
- The preload layer exposes privileged capabilities through `window.electronAPI`
- Local SQLite stores conversations, model configs, tasks, tool run history, permission rules, memory indexes, and cost logs

## Who Is It For?

This kind of project is best suited for people who:

- Want to use agents inside local projects rather than only chatting in a browser
- Need to manage multiple providers and models in one place
- Prefer planning before execution to reduce accidental changes
- Need approval, audit, recovery, and traceability around tool use
- Want MCP, memory, tasks, and project state to live inside one desktop app

## Typical Workflow

Little Peanut is currently designed around a workflow like this:

1. Select a project workspace and active model
2. Choose whether the current task belongs in `Chat`, `Agent`, `Plan`, or `Pipeline`
3. If the task is complex, start in `Plan` mode for read-only investigation and a structured execution plan
4. Once the plan is accepted, hand it over to `Agent` mode for concrete work inside the workspace
5. Sensitive or destructive actions go through approval
6. If execution is interrupted, resume from the recovery prompt
7. Conversations, tool runs, todos, tasks, cost logs, and permission rules remain stored locally

## Architecture

```text
┌──────────────────────────────────────────────┐
│ Renderer / React UI                          │
│ Chat · Plan Panel · Pipeline · Tasks · MCP  │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Preload Bridge                               │
│ window.electronAPI                           │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Main Process                                 │
│ AI Adapters · Agent Runtime · IPC · Security │
│ Permissions · MCP · Git · SQLite             │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Local Persistence                            │
│ Conversations · Messages · Tasks · Rules     │
│ Providers · Models · Memory · Cost Logs      │
└──────────────────────────────────────────────┘
```

## What It Already Has

This is not a concept-only repository. The current codebase already contains a practical foundation that can keep growing.

### 1. Multi-model and Multi-provider Setup

- Supports `OpenAI`, `Anthropic`, `Gemini`, and OpenAI-compatible endpoints
- The main process supports protocols such as `openai-chat`, `openai-responses`, `openai-compatible`, `anthropic-messages`, and `google-gemini`
- Supports custom providers with persisted `Base URL`, `API Key`, protocol, and enabled state
- Supports custom models, capability labels, reasoning protocol settings, and batch enable or disable
- The renderer already provides complete provider and model management UI

### 2. Agent Execution Mode

- Agents can call tools and execute tasks inside a project workspace
- Tool calls have lifecycle logs, status tracking, and structured result streaming
- Supports todos, running task lists, cost summaries, and context compression
- Interrupted runs can be resumed or discarded instead of losing all progress after a crash

### 3. Plan Mode

- Plan mode is read-only and does not directly modify files
- It investigates first, decides whether clarification is needed, and then produces a structured implementation plan
- It can identify clarification questions and final implementation plans
- The UI includes a dedicated planning panel so work can be scoped before execution starts

### 4. Pipeline Mode

- The current pipeline is organized as `planner -> executor -> reviewer`
- A pipeline configuration UI already exists
- The main process already has a pipeline loop and completion report structure

### 5. Permission Approval and Risk Gating

- Tool execution goes through a centralized permission gate
- Bash commands are risk-classified
- Destructive operations are escalated for explicit approval
- Session-level and project-level permission rules are persisted
- A bypass mode exists, but the default workflow still expects explicit approvals

### 6. MCP and Extensibility

- MCP server configuration, connectivity testing, enable or disable, and connection flows are already present
- Supports `stdio`, `SSE`, and `HTTP` transports
- The architecture already leaves room for future skills, tool ecosystems, and external integrations

### 7. Local Persistence

- SQLite persistence already covers conversations, messages, tool runs, tasks, permissions, memory indexes, and cost logs
- The schema is maintained through migrations with explicit evolution rules
- Legacy messages already have migration support into structured message blocks

## Built-in Modes

The product is not limited to a single “agent” mode. It already includes several intent-oriented modes:

| Mode | Purpose |
| --- | --- |
| `chat` | Lightweight conversation |
| `agent` | Action-oriented project execution |
| `plan` | Read-only investigation and planning |
| `pipeline` | Multi-stage orchestration |
| `writing` | Drafting, polishing, translation, writing support |
| `code` | Programming, debugging, and review |
| `learning` | Concept explanation and tutoring |
| `research` | Information gathering and synthesis |
| `brainstorm` | Idea exploration |
| `translate` | Translation and bilingual cleanup |
| `summarize` | Summarizing long text or conversations |

## Tool System

The current agent runtime already exposes a set of local tools rather than only code editing:

- File reading and search: `Read`, `Glob`, `Grep`, `ListDir`
- File modification: `Write`, `Edit`, `Delete`
- Terminal execution: `Bash`
- Task planning: `TodoWrite`, `Task`
- External information: `WebSearch`, `WebFetch`
- Code quality helper: `ReadLints`
- Memory system: `MemoryRead`, `MemoryWrite`
- Skill entrypoint: `Skill`

That means its goal is not only to answer questions about code, but to complete a real unit of local work inside controlled boundaries.

## Data and Persistence

The current migrations already cover a fairly broad set of entities, including:

- `project`
- `conversation`
- `message`
- `message_part`
- `tool_run`
- `agent_todo`
- `agent_task`
- `permission_rule`
- `memory_index`
- `agent_cost_log`
- `provider_config`
- `model_config`
- `mcp_server`

These power:

- project and conversation context
- structured message rendering and tool replay
- todos and long-running task state
- remembered permission decisions
- local memory indexing
- model cost accounting
- provider, model, and MCP configuration

## Safety Boundaries

The current safety model is less about “perfect sandboxing” and more about controllability within a local desktop execution environment:

- The renderer does not directly access the filesystem or database
- Privileged capabilities are routed through preload
- Tool calls go through a permission gate
- Destructive operations and risky Bash commands require approval
- Permission rules are stored so the user is not repeatedly prompted for the same decisions

It is more accurate to think of the project as “a local agent runtime with an explicit desktop control surface” than as a normal chat app.

## Status

> **Early Development**  
> The project is no longer an empty shell, but it is still in the stage of expanding and stabilizing its core capabilities.

- [x] Base Electron + React + SQLite architecture
- [x] Multi-provider and model configuration
- [x] Core Agent, Plan, and Pipeline modes
- [x] Permission approval, task recovery, and cost tracking
- [x] MCP configuration and connectivity testing
- [x] Local tool registry and structured message storage foundation
- [ ] A more complete skill system
- [ ] Better workspace and Git collaboration
- [ ] More mature packaging and release flow
- [ ] Broader automated test coverage

## Quick Start

### Requirements

- `Node.js >= 22`
- `npm >= 10`

### Install

The repository root is a delegator. The actual Electron application lives in `./src`.

```bash
npm install
npm run install:app
```

### Run

```bash
npm run dev
```

### Build

```bash
npm run build
```

After the first install or when the Electron version changes, run the command below if the `better-sqlite3` native module becomes incompatible.

```bash
npm --prefix src run rebuild:native
```

## Development Notes

If you plan to keep building the project, a few current constraints are important:

- The root scripts are delegators, while the real app lives in `./src`
- Database schema changes should go through migrations; shipped migrations should not be rewritten
- Plan mode is intentionally read-only and should not be treated as a lighter alias of Agent mode
- New tools should plug into the shared registry and permission system rather than bypassing them from the UI
- Structured chat rendering depends on entities such as `message_part` and `tool_run`, so falling back to a plain text-only message model would be a regression

## Commands

| Command | Description |
| --- | --- |
| `npm run install:app` | Install app dependencies inside `src` |
| `npm run dev` | Start the Electron dev environment |
| `npm run build` | Type-check and build the app |
| `npm run typecheck` | Run TypeScript checks only |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest |
| `npm run test:ci` | Run tests in CI mode |
| `npm run pack` | Generate a local packaged directory |
| `npm run dist` | Build release installers |
| `npm run dist:mac` | Build macOS installers |
| `npm run dist:win` | Build Windows installers |

## Project Layout

```text
.
├── README.md
├── README.en.md
├── docs/
│   └── architecture.md
├── src/
│   ├── main/               Electron main process
│   │   ├── agent/          Agent runtime, tools, permissions, memory, MCP
│   │   ├── ai/             Multi-protocol model adapters
│   │   ├── db/             SQLite and migrations
│   │   ├── git/            Git-related capabilities
│   │   ├── ipc/            IPC registration
│   │   └── security/       Security boundary logic
│   ├── preload/            window.electronAPI bridge
│   ├── renderer/src/       React UI
│   └── shared/             Shared contracts between main and renderer
└── package.json            Root-level script delegator
```

## What Could Still Be Added?

If the repository is going to mature into a more complete open-source project, these are still worth adding:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- issue and PR templates
- release notes and changelog
- screenshots, gifs, and demo flows
- deeper English docs, architecture docs, and API docs

## Roadmap

The next meaningful areas to improve are likely these:

- Build a richer workspace context and code execution experience
- Strengthen the agent skill system and tool extension protocol
- Continue improving permission policies, recovery flows, and long-term memory
- Evolve the pipeline from a basic three-stage flow into more stable multi-role collaboration
- Improve desktop release, update, diagnostics, and cross-platform experience
- Add finer-grained cost and runtime observability

## FAQ

### Is it a web app or a desktop app?

It is currently an Electron desktop application.

### Can it freely edit files without control?

Not by design. Write-capable actions are expected to go through the agent runtime and approval flow rather than being exposed directly as unrestricted UI actions.

### What is the difference between Plan and Agent?

`Plan` is responsible for investigation, clarification, and strategy. `Agent` is responsible for execution. They are separate responsibilities, not just one mode with a different label.

### Does it only support one model provider?

No. The current codebase already includes a multi-protocol adapter layer and supports custom providers and models.

## Docs

- Architecture: [docs/architecture.md](./docs/architecture.md)

## License

This project is open-sourced under the MIT license and may be used, copied, modified, distributed, and used commercially.
