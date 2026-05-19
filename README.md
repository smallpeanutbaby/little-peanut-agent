# Little Peanut

一个本地优先的桌面 AI 工作台，目标是把多模型聊天、Agent 执行、计划模式、Pipeline 编排、项目工作区和本地数据持久化整合到同一个 Electron 应用里。

当前实现重点已经不只是“聊天客户端”，而是逐步演进成一个类 Codex / Claude Code / Cursor Agent 的本地执行环境：
- 多模型对话与服务商配置
- Agent 模式、Plan 模式、Pipeline 模式
- MCP 接入与工具执行
- 项目级工作区、权限审批、运行中任务、Todo/计划面板
- 全量本地 SQLite 持久化

## 当前能力

### 多模型与服务商

- 内置多家服务商目录，覆盖 OpenAI、Anthropic、Gemini 以及多种 OpenAI 兼容端点。
- 主进程适配层支持 `openai-chat`、`openai-responses`、`openai-compatible`、`anthropic-messages`、`google-gemini` 多种协议。
- 支持自定义服务商、自定义模型、模型能力标记和推理协议配置。
- 支持模型启用/禁用、批量启用/禁用、自定义模型新增/删除。
- 服务商配置、模型配置、自定义模型都会持久化到本地 SQLite。

### 聊天与模式

- 支持普通聊天、Agent、Plan、Pipeline、Writing、Code、Learning、Research、Brainstorm、Translate、Summarize 等模式。
- 每种模式可提供独立的 system prompt、默认温度、默认推理预算、上下文窗口和字符预算。
- 聊天区支持模型选择、推理预算切换、流式输出、消息块渲染和工具调用结果展示。
- 主题颜色、文本颜色、语言切换会持久化到本地数据库。

### Agent / Plan / Pipeline

- Agent 模式支持运行期工具调用、权限审批、上下文压缩、任务恢复、中断任务列表、成本汇总等能力。
- Plan 模式支持“先澄清，再出方案”的只读规划流，并带有结构化计划识别与前端计划面板。
- Pipeline 模式支持“planner / executor / reviewer”三段式执行编排，并提供前端 Pipeline 配置入口。
- 运行中的任务、Todo 列表、工具执行卡片、审批弹窗、恢复提示都已有对应 UI。

### 数据与本地优先

- 核心业务数据使用 `better-sqlite3` 存储。
- schema 已进入版本化 migration 管理，避免后续演进时靠零散 `ALTER TABLE` 修补。
- Agent 相关结构化数据已覆盖：
  - `message_part`
  - `tool_run`
  - `agent_todo`
  - `agent_task`
  - `permission_rule`
  - `memory_index`
  - `agent_cost_log`
- 对话、项目、UI 设置、模型设置、服务商设置、自定义模型都在本地持久化。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 39 |
| 构建 | electron-vite + Vite 7 |
| 前端 | React 19、TypeScript 5.9、Tailwind v4、Zustand |
| 本地存储 | better-sqlite3 |
| 国际化 | i18next + react-i18next |
| 编辑器 / 终端 | Monaco、xterm |
| 测试 | Vitest |

## 目录结构

```text
src/
├── main/
│   ├── agent/           Agent 运行时、工具、权限、MCP、上下文处理
│   ├── ai/              多协议模型适配层
│   ├── db/              SQLite 访问与 migrations
│   └── ipc/             主进程 IPC 注册
├── preload/             electronAPI 桥接层
├── renderer/src/
│   ├── components/      聊天、计划、Pipeline、审批、任务等界面
│   ├── i18n/            中英文案
│   ├── store/           前端状态
│   └── App.tsx          主界面容器
├── shared/              主/渲染共享类型、模式、IPC 常量
└── tests/               Vitest 测试
```

## 文档

- 架构与数据说明：[`docs/architecture.md`](./docs/architecture.md)

## 本地开发

```bash
cd src
npm install
npm run dev
```

说明：
- 修改 `preload` 后建议完全关闭 Electron 窗口再重启开发环境，避免桥接接口热更新不完整。
- 首次安装或 Electron 版本变化后，可能需要执行 `npm run rebuild:native`。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发模式 |
| `npm run build` | 类型检查并构建 |
| `npm run typecheck` | 仅类型检查 |
| `npm run test` | 运行 Vitest |
| `npm run test:ci` | CI 模式测试 |
| `npm run pack` | 本地打包目录产物 |
| `npm run dist` | electron-builder 打包 |

## 打包

```bash
cd src
npm run build
npm run pack
```

支持：
- `npm run dist:mac`
- `npm run dist:win`
- `npm run dist:all`

## License

私有项目，暂未授权。
