# Little Peanut

**面向本地项目工作的桌面 AI Agent 工作台。**  
**A desktop AI agent workspace built for local project execution.**

一个本地优先的 Electron 应用，把多模型对话、Agent 执行、Plan 规划、Pipeline 编排、权限审批、MCP 扩展和 SQLite 持久化放进同一套桌面工作流里。  
Little Peanut is a local-first Electron app that brings multi-model chat, agent execution, planning, pipeline orchestration, permission approval, MCP extensibility, and SQLite persistence into one desktop workflow.

[架构 / Architecture](./docs/architecture.md) · `Node.js 22+` · `Electron` · `React` · `SQLite`

---

## 为什么是 Little Peanut? / Why Little Peanut?

今天很多 AI 产品都能“聊天”，但离真正可用的本地协作环境还差一截：  
Many AI products can chat, but they are still far from being a practical local collaboration environment:

- 它们知道问题，不知道你正在处理哪个项目  
  They know the prompt, but not the project you are actually working on.
- 它们会回答，但不一定能在工作区里持续执行任务  
  They can answer, but cannot reliably continue work inside a real workspace.
- 它们能调工具，但缺少稳定的权限边界和恢复机制  
  They can call tools, but often lack stable permission boundaries and recovery flows.
- 它们有模型切换，但没有统一的服务商、模型、任务和状态管理  
  They may support model switching, but not unified management of providers, models, tasks, and state.

Little Peanut 想解决的是这层断裂。  
Little Peanut is designed to close that gap.

我们希望它不是一个聊天壳，而是一个真正面向本地工作的 Agent 桌面环境：  
It is not meant to be just a chat shell, but a real desktop agent environment for local work:

- **本地优先 / Local-first**: 对话、项目、模型配置、任务状态统一落本地  
  Conversations, projects, model configs, and task state are stored locally.
- **可控执行 / Controlled execution**: 工具调用经过权限审批和风险门禁  
  Tool calls go through approval and risk checks.
- **先计划再动手 / Plan before execution**: Plan 和 Agent 分层，避免直接乱改  
  Planning and execution are separated to avoid reckless changes.
- **可恢复 / Recoverable**: 运行中断后可以继续、放弃、回看任务轨迹  
  Interrupted runs can be resumed, discarded, or reviewed.
- **可扩展 / Extensible**: 支持多服务商、MCP 服务器、自定义模型和后续技能体系  
  The app is built to support multiple providers, MCP servers, custom models, and future skill systems.

## 架构 / Architecture

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
│ Permissions · MCP · Git · SQLite            │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Local Persistence                            │
│ Conversations · Messages · Tasks · Rules     │
│ Providers · Models · Memory · Cost Logs      │
└──────────────────────────────────────────────┘
```

## 当前已有能力 / What It Already Has

这不是纯概念仓库，当前代码里已经有一套能继续往前长的骨架。  
This is not a concept-only repository. The current codebase already contains a practical foundation that can keep growing.

### 1. 多模型与多服务商配置 / Multi-model and Multi-provider Setup

- 支持 `OpenAI`、`Anthropic`、`Gemini` 以及 OpenAI 兼容端点  
  Supports `OpenAI`, `Anthropic`, `Gemini`, and OpenAI-compatible endpoints.
- 支持自定义服务商，保存 `Base URL`、`API Key`、协议和启用状态  
  Supports custom providers with persisted `Base URL`, `API Key`, protocol, and enabled state.
- 支持自定义模型、能力标签、推理协议、批量启停  
  Supports custom models, capability labels, reasoning protocol settings, and batch enable or disable.
- 前端已提供完整的模型和服务商管理入口  
  The renderer already provides complete provider and model management UI.

### 2. Agent 执行模式 / Agent Execution Mode

- Agent 可以在项目工作区内调用工具执行任务  
  Agents can call tools and execute tasks inside a project workspace.
- 工具调用有生命周期记录、状态跟踪和结构化结果回传  
  Tool calls have lifecycle logs, status tracking, and structured result streaming.
- 支持 `Todo`、运行任务列表、成本统计、上下文压缩  
  Supports todos, running task lists, cost summaries, and context compression.
- 支持中断后的恢复或丢弃，不会因为一次崩溃把上下文全丢掉  
  Interrupted runs can be resumed or discarded instead of losing all progress after a crash.

### 3. Plan 模式 / Plan Mode

- Plan 是只读规划模式，不直接改文件  
  Plan mode is read-only and does not directly modify files.
- 可以识别澄清问题和最终实施方案  
  It can identify clarification questions and final implementation plans.
- 前端有独立计划面板，便于先拆任务、再进入执行  
  The UI includes a dedicated planning panel so work can be scoped before execution starts.

### 4. Pipeline 模式 / Pipeline Mode

- 当前按 `planner -> executor -> reviewer` 三阶段组织  
  The current pipeline is organized as `planner -> executor -> reviewer`.
- 已有前端配置界面  
  A pipeline configuration UI already exists.
- 主进程已有 pipeline loop 和完成报告结构  
  The main process already has a pipeline loop and completion report structure.

### 5. 权限审批与风险门禁 / Permission Approval and Risk Gating

- 工具执行会经过统一权限网关  
  Tool execution goes through a centralized permission gate.
- Bash 命令有风险分类  
  Bash commands are risk-classified.
- 破坏性操作会升级审批  
  Destructive operations are escalated for explicit approval.
- 权限规则支持持久化，后续可以继续做项目级或会话级策略  
  Permission rules are persisted and can evolve into project-level or session-level policies.

### 6. MCP 与扩展能力 / MCP and Extensibility

- 已有 MCP 服务器配置、测试、启停和连接入口  
  MCP server configuration, connectivity testing, enable or disable, and connection flows are already present.
- 支持 `stdio`、`SSE`、`HTTP` 类型连接  
  Supports `stdio`, `SSE`, and `HTTP` transports.
- 为后续技能、工具生态和外部能力接入留了扩展位  
  The architecture already leaves room for future skills, tool ecosystems, and external integrations.

### 7. 本地持久化 / Local Persistence

- SQLite 持久化已经覆盖会话、消息、工具运行、任务、权限、记忆索引、成本日志等核心数据  
  SQLite persistence already covers conversations, messages, tool runs, tasks, permissions, memory indexes, and cost logs.
- Schema 通过 migration 维护，后续演进有明确约束  
  The schema is maintained through migrations with explicit evolution rules.

## 当前状态 / Status

> **Early Development**  
> 现在已经不是空壳，但还处在“架构搭起来、能力持续补完”的阶段。  
> The project is no longer an empty shell, but it is still in the stage of expanding and stabilizing its core capabilities.

- [x] Electron + React + SQLite 基础架构 / Base Electron + React + SQLite architecture
- [x] 多服务商与模型配置 / Multi-provider and model configuration
- [x] Agent / Plan / Pipeline 基本模式 / Core Agent, Plan, and Pipeline modes
- [x] 权限审批、任务恢复、成本记录 / Permission approval, task recovery, and cost tracking
- [x] MCP 配置与连通性测试 / MCP configuration and connectivity testing
- [ ] 更完整的技能系统 / A more complete skill system
- [ ] 更强的工作区与 Git 协同体验 / Better workspace and Git collaboration
- [ ] 更成熟的打包与发布流程 / More mature packaging and release flow
- [ ] 更系统的自动化测试覆盖 / Broader automated test coverage

## 快速开始 / Quick Start

### 环境要求 / Requirements

- `Node.js >= 22`
- `npm >= 10`

### 安装 / Install

仓库根目录是一个 delegator，真正的 Electron 应用在 `./src`。  
The repository root is a delegator. The actual Electron application lives in `./src`.

```bash
npm install
npm run install:app
```

### 启动 / Run

```bash
npm run dev
```

### 构建 / Build

```bash
npm run build
```

首次安装或 Electron 版本变化后，如果 `better-sqlite3` 原生模块不匹配，可以执行下面命令。  
After the first install or when the Electron version changes, run the command below if the `better-sqlite3` native module becomes incompatible.

```bash
npm --prefix src run rebuild:native
```

## 常用命令 / Commands

| Command | 中文说明 | English Description |
| --- | --- | --- |
| `npm run install:app` | 安装 `src` 下应用依赖 | Install app dependencies inside `src` |
| `npm run dev` | 启动 Electron 开发环境 | Start the Electron dev environment |
| `npm run build` | 类型检查并构建 | Type-check and build the app |
| `npm run typecheck` | 仅做 TypeScript 检查 | Run TypeScript checks only |
| `npm run lint` | 运行 ESLint | Run ESLint |
| `npm run test` | 运行 Vitest | Run Vitest |
| `npm run test:ci` | CI 模式测试 | Run tests in CI mode |
| `npm run pack` | 生成本地打包目录 | Generate a local packaged directory |
| `npm run dist` | 打正式安装包 | Build release installers |
| `npm run dist:mac` | 构建 macOS 安装包 | Build macOS installers |
| `npm run dist:win` | 构建 Windows 安装包 | Build Windows installers |

## 项目结构 / Project Layout

```text
.
├── README.md
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

## 路线图 / Roadmap

接下来更值得继续打磨的方向大概有这些：  
The next meaningful areas to improve are likely these:

- 做更完整的工作区上下文和代码执行体验  
  Build a richer workspace context and code execution experience.
- 补强 Agent 技能系统和工具扩展协议  
  Strengthen the agent skill system and tool extension protocol.
- 继续完善权限策略、恢复机制和长期记忆  
  Continue improving permission policies, recovery flows, and long-term memory.
- 把 Pipeline 从基础三阶段推进到更稳定的多角色协作  
  Evolve the pipeline from a basic three-stage flow into more stable multi-role collaboration.
- 提升桌面端发布、升级、诊断和跨平台体验  
  Improve desktop release, update, diagnostics, and cross-platform experience.

## 文档 / Docs

- 架构说明 / Architecture: [docs/architecture.md](./docs/architecture.md)

## License

本项目采用 MIT 协议开源，可用于使用、复制、修改、分发和商用。  
This project is open-sourced under the MIT license and may be used, copied, modified, distributed, and used commercially.
