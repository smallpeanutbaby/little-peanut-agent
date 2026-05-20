# Little Peanut

**面向本地项目工作的桌面 AI Agent 工作台。**

一个本地优先的 Electron 应用，把多模型对话、Agent 执行、Plan 规划、Review 审查、Pipeline 编排、权限审批、MCP 扩展和 SQLite 持久化放进同一套桌面工作流里。

[English](./README.en.md) · [架构文档](./docs/architecture.md) · `Node.js 22+` · `Electron` · `React` · `SQLite`

---

## 为什么是 Little Peanut？

Little Peanut 不是为了再做一个“能聊天的 AI 客户端”。

它更关心的是另一件事: 让模型真正进入本地工作现场，而不是停留在回答框里。

在真实的软件协作里，问题从来不只是“模型答得对不对”，而是：

- 它能不能理解自己正在处理哪个项目、哪套代码、哪条任务链路
- 它能不能把调研、规划、执行、审查放进同一条连续工作流
- 它能不能在调用文件、命令、网络能力时保持边界清晰、过程可控
- 它能不能把对话、任务、权限、记忆和运行状态真正沉淀下来，而不是每次重开就重新开始

Little Peanut 要做的是一个本地工作的 Agent 桌面环境，而不是一个包装得更复杂的聊天框：

- **面向工作区**: 默认站在真实项目目录里工作，而不是脱离上下文地回答
- **执行可控**: 工具调用、命令执行、破坏性操作都有明确门禁和审批链路
- **规划先行**: `Plan` 负责调研和方案，`Agent` 负责落地和执行
- **状态可恢复**: 中断的运行、未完成的任务、历史决策和成本记录都能回看和继续
- **本地沉淀**: 会话、模型配置、权限规则、记忆索引和任务状态统一保留在本地

## 这是什么？

Little Peanut 是一个桌面端 AI 工作台，目标不是替代 IDE，也不是再做一个网页聊天框，而是把“模型、工具、项目、状态、记忆、审批、恢复”这些真实工作里会断开的部分重新拼在一起。

从代码结构上看，它已经具备一个本地 Agent 产品的核心骨架：

- Electron 主进程负责模型适配、Agent runtime、权限门禁、MCP、SQLite 和 IPC
- React 渲染层负责聊天 UI、计划面板、Pipeline 配置、审批弹窗、任务与恢复提示
- Preload 层收口所有高权限能力，通过 `window.electronAPI` 暴露给前端
- 本地 SQLite 负责保存对话、模型配置、任务、工具运行记录、权限规则、记忆索引和成本日志

## 适合谁用？

这类项目更适合下面几种使用场景：

- 想在本地项目里使用 Agent，而不是只在浏览器里聊天的人
- 需要同时管理多个模型与服务商的人
- 希望先规划、再执行，减少误改风险的人
- 需要对工具调用做审批、审计、恢复和追踪的人
- 想把 MCP、记忆、任务和项目状态统一进一个桌面应用的人

## 典型工作流

Little Peanut 目前更接近下面这种使用方式：

1. 选择项目工作区与当前模型
2. 在聊天区决定当前是 `Chat`、`Agent`、`Plan` 还是 `Pipeline`
3. 如果任务复杂，先进入 `Plan` 模式做只读调研和实施方案拆解
4. 方案确认后交给 `Agent` 执行，在工作区内调用工具完成具体改动
5. 敏感或破坏性操作经过审批
6. 运行中断后通过恢复提示继续任务
7. 对话、工具执行、Todo、任务、成本和权限规则都保留在本地

## 架构

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

## 当前已有能力

这不是纯概念仓库，当前代码里已经有一套能继续往前长的骨架。

### 1. 多模型与多服务商配置

- 支持 `OpenAI`、`Anthropic`、`Gemini` 以及 OpenAI 兼容端点
- 主进程支持 `openai-chat`、`openai-responses`、`openai-compatible`、`anthropic-messages`、`google-gemini` 等协议
- 支持自定义服务商，保存 `Base URL`、`API Key`、协议和启用状态
- 支持自定义模型、能力标签、推理协议、批量启停
- 前端已提供完整的模型和服务商管理入口

### 2. Agent 执行模式

- Agent 可以在项目工作区内调用工具执行任务
- 工具调用有生命周期记录、状态跟踪和结构化结果回传
- 支持 `Todo`、运行任务列表、成本统计、上下文压缩
- 支持中断后的恢复或丢弃，不会因为一次崩溃把上下文全丢掉

### 3. Plan 模式

- Plan 是只读规划模式，不直接改文件
- 会先做调研，再判断是否需要澄清问题，最后输出结构化实施方案
- 可以识别澄清问题和最终实施方案
- 前端有独立计划面板，便于先拆任务、再进入执行

### 4. Pipeline 模式

- 当前按 `planner -> executor -> reviewer` 三阶段组织
- 已有前端配置界面
- 主进程已有 pipeline loop 和完成报告结构

### 5. Review 审查模式

- 支持面向项目的 `review` 模式，用于只读代码审查而不是直接改文件
- 可以围绕提交、分支差异或指定范围生成审查上下文
- 审查结果按摘要、阻断问题、主要建议和次要建议分层输出
- 前端已提供 review scope 选择与启动入口

### 6. 权限审批与风险门禁

- 工具执行会经过统一权限网关
- Bash 命令有风险分类
- 破坏性操作会升级审批
- 支持会话级、项目级权限规则持久化
- 支持免审开关，但默认仍是显式审批路径
- 文件读写、删除、MemoryRead 等工具会结合项目路径校验与建议提示，减少越界和误路径操作

### 7. 上下文预算与历史压缩

- Agent 运行时会根据模型上下文窗口自动做 budget 约束
- 会在发送前压缩历史、裁剪超大工具结果，并向前端回传上下文预算快照
- 前端已支持展示预算占用、压缩状态和运行中的上下文变化

### 8. MCP 与扩展能力

- 已有 MCP 服务器配置、测试、启停和连接入口
- 支持 `stdio`、`SSE`、`HTTP` 类型连接
- 为后续技能、工具生态和外部能力接入留了扩展位

### 9. 本地持久化

- SQLite 持久化已经覆盖会话、消息、工具运行、任务、权限、记忆索引、成本日志等核心数据
- Schema 通过 migration 维护，后续演进有明确约束
- 对旧消息已有结构化消息块迁移逻辑，便于统一渲染层展示

## 模式一览

当前内置模式不只有 Agent，还包括一组不同工作意图的模式：

| 模式 | 作用 |
| --- | --- |
| `chat` | 普通对话，偏轻量交流 |
| `agent` | 面向项目执行任务，偏行动型 |
| `plan` | 只读调研和方案输出，不直接改文件 |
| `pipeline` | 多阶段多角色编排 |
| `review` | 只读代码审查，围绕 diff / commits / branches 输出审查结论 |
| `writing` | 文案、润色、翻译、写作辅助 |
| `code` | 编程、排障、代码审阅 |
| `learning` | 解释概念、教学式回答 |
| `research` | 做信息收集、归纳、对比 |
| `brainstorm` | 发散式想法探索 |
| `translate` | 翻译与双语整理 |
| `summarize` | 总结长文本或长对话 |

## 工具系统

当前 Agent 已经挂接一组本地工具，不只是单一的代码编辑：

- 文件读取与检索: `Read`、`Glob`、`Grep`、`ListDir`
- 文件改动: `Write`、`Edit`、`Delete`
- 终端执行: `Bash`
- 任务规划: `TodoWrite`、`Task`
- 外部信息: `WebSearch`、`WebFetch`
- 代码质量辅助: `ReadLints`
- 记忆系统: `MemoryRead`、`MemoryWrite`
- 技能入口: `Skill`

这意味着它的目标不是“回答代码问题”，而是“在可控边界内完成一轮本地工作”。

## 数据与持久化

当前数据库 migration 已经覆盖多个阶段，核心数据大致包括：

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

这些数据分别支撑：

- 项目和会话上下文
- 结构化消息与工具调用回放
- Todo 和长任务状态
- 权限规则记忆
- 本地记忆索引
- 模型成本统计
- 服务商 / 模型 / MCP 配置

## 安全边界

项目当前的安全设计重点不是“绝对沙箱”，而是“桌面本地执行前提下的可控性”：

- 渲染进程不直接访问文件系统或数据库
- 高权限能力统一通过 `preload` 桥接
- 工具调用经过 permission gate
- 破坏性操作与高风险 Bash 会触发审批
- 权限规则以持久化形式记录，减少重复弹窗

如果你把它理解成“一个有明确边界的本地 Agent runtime + 桌面 UI”，会比把它理解成普通聊天应用更准确。

## 当前状态

> **Early Development**  
> 现在已经不是空壳，但还处在“架构搭起来、能力持续补完”的阶段。

- [x] Electron + React + SQLite 基础架构
- [x] 多服务商与模型配置
- [x] Agent / Plan / Pipeline 基本模式
- [x] 权限审批、任务恢复、成本记录
- [x] MCP 配置与连通性测试
- [x] 本地工具注册与结构化消息存储骨架
- [ ] 更完整的技能系统
- [ ] 更强的工作区与 Git 协同体验
- [ ] 更成熟的打包与发布流程
- [ ] 更系统的自动化测试覆盖

## 快速开始

### 环境要求

- `Node.js >= 22`
- `npm >= 10`

### 安装

仓库根目录是一个 delegator，真正的 Electron 应用在 `./src`。

```bash
npm install
npm run install:app
```

### 启动

```bash
npm run dev
```

### 构建

```bash
npm run build
```

首次安装或 Electron 版本变化后，如果 `better-sqlite3` 原生模块不匹配，可以执行下面命令。

```bash
npm --prefix src run rebuild:native
```

## 开发说明

如果你准备继续开发这个项目，当前有几条重要约束值得先知道：

- 根目录脚本是代理，真正应用在 `./src`
- 数据库 schema 通过 migration 演进，已发布 migration 不应回写修改
- Plan 模式是只读模式，不能直接视作 Agent 模式的轻量别名
- 新工具要接入统一注册表和权限体系，而不是直接在 UI 层调用
- 结构化消息渲染依赖 `message_part` / `tool_run` 等表，不建议再退回纯文本消息模型

## 常用命令

| Command | 说明 |
| --- | --- |
| `npm run install:app` | 安装 `src` 下应用依赖 |
| `npm run dev` | 启动 Electron 开发环境 |
| `npm run build` | 类型检查并构建 |
| `npm run typecheck` | 仅做 TypeScript 检查 |
| `npm run lint` | 运行 ESLint |
| `npm run test` | 运行 Vitest |
| `npm run test:ci` | CI 模式测试 |
| `npm run pack` | 生成本地打包目录 |
| `npm run dist` | 打正式安装包 |
| `npm run dist:mac` | 构建 macOS 安装包 |
| `npm run dist:win` | 构建 Windows NSIS 安装包 |

## 打包说明

- Windows 当前默认只产出 **NSIS 安装版**，不再同时生成 portable 免安装版，避免同名覆盖
- Windows 图标资源位于 `src/resources/icon.ico` 与 `src/resources/icon.png`
- 小花生图标可通过 `src/__scripts__/generate-peanut-icon.ps1` 重新生成
- 当前 Windows 打包配置里 `signAndEditExecutable` 为关闭状态，用于规避部分机器上 `winCodeSign` 解压符号链接权限问题；这不影响生成安装程序

## 项目结构

```text
.
├── README.md
├── README.en.md
├── docs/
│   └── architecture.md
├── src/
│   ├── main/               Electron 主进程
│   │   ├── agent/          Agent runtime、tools、permissions、memory、MCP
│   │   ├── ai/             多协议模型适配层
│   │   ├── db/             SQLite 与 migrations
│   │   ├── git/            Git 相关能力
│   │   ├── ipc/            IPC 注册
│   │   └── security/       安全边界相关逻辑
│   ├── preload/            window.electronAPI 桥接
│   ├── renderer/src/       React 界面
│   └── shared/             主进程和前端共享协议
└── package.json            根目录脚本代理
```

## 还可以继续补什么？

如果后续要把它整理成更成熟的开源仓库，通常还会继续补这些内容：

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- issue / PR 模板
- 发布说明与版本变更记录
- 更具体的截图、动图和演示流程
- 更完整的 English docs / architecture docs / API docs

## 路线图

接下来更值得继续打磨的方向大概有这些：

- 做更完整的工作区上下文和代码执行体验
- 补强 Agent 技能系统和工具扩展协议
- 继续完善权限策略、恢复机制和长期记忆
- 把 Pipeline 从基础三阶段推进到更稳定的多角色协作
- 提升桌面端发布、升级、诊断和跨平台体验
- 增加更细粒度的成本与运行可观测性

## FAQ

### 它是网页产品还是桌面应用？

当前是 Electron 桌面应用。

### 它会不会直接乱改文件？

设计上不会把所有写能力直接暴露给前端 UI，真正执行通过 Agent runtime 和权限审批链路进入。

### Plan 和 Agent 的差别是什么？

`Plan` 负责调研、澄清和输出方案，`Agent` 负责执行。两者不是同一个模式换皮，而是职责分层。

### 它是不是只支持一个模型厂商？

不是。当前代码里已经有多协议适配层，也支持自定义服务商和模型。

## 文档

- 架构说明: [docs/architecture.md](./docs/architecture.md)

## License

本项目采用 MIT 协议开源，可用于使用、复制、修改、分发和商用。
