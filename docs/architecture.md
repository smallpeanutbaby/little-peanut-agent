# Little Peanut 架构与数据说明

本文档用于把当前代码里的关键能力、模块边界和本地数据落库逻辑说明清楚，方便后续继续扩展 Agent、Plan、Pipeline 和模型配置功能。

## 1. 总体架构

应用是标准的 Electron 三层结构：

1. `main`
主进程，负责：
- 模型调用适配
- Agent 运行时
- MCP 连接
- SQLite 持久化
- IPC 注册与权限边界

2. `preload`
桥接层，负责把允许暴露给渲染进程的 API 收敛到 `window.electronAPI`

3. `renderer`
React UI，负责：
- 聊天界面
- 模型与服务商配置
- Plan / Pipeline / Agent 面板
- 审批、任务、恢复提示等交互

## 2. 共享协议层

共享定义主要在：
- `src/shared/types.ts`
- `src/shared/modes.ts`
- `src/shared/ipc-channels.ts`
- `src/shared/plan-ui.ts`

这些文件的职责分别是：

- `types.ts`
定义主/渲染共同使用的数据结构，例如：
  - `AppearanceSettings`
  - `ModelConfig`
  - `ProviderConfig`
  - `ThinkBudget`
  - `ProtocolId`
  - 会话/项目/消息等实体

- `modes.ts`
定义聊天模式与运行模式，包括：
  - `chat`
  - `agent`
  - `plan`
  - `pipeline`
  - `writing`
  - `code`
  - `learning`
  - `research`
  - `brainstorm`
  - `translate`
  - `summarize`

- `ipc-channels.ts`
集中管理 IPC channel，避免主进程和 preload/renderer 各写一套字符串。

- `plan-ui.ts`
定义 Plan 模式前端辅助逻辑，例如：
  - 判断消息是不是最终方案
  - 判断是不是澄清问题
  - 解析 “## 需要先确认” 中的问题块

## 3. 模型与服务商配置

主进程入口：
- `src/main/ai/adapter.ts`
- `src/main/ipc/index.ts`
- `src/main/db/database.ts`

### 3.1 支持的协议

当前协议标识包括：
- `openai-chat`
- `openai-responses`
- `openai-compatible`
- `anthropic-messages`
- `google-gemini`

渲染层通过服务商配置页面录入：
- 服务商名称
- Base URL
- API Key
- 协议
- 是否启用

### 3.2 模型配置

模型配置持久化字段包含：
- `providerId`
- `modelId`
- `enabled`
- `capabilities`
- `thinkProtocol`
- `thinkEnabled`
- `thinkBudget`
- `thinkBodyOn`
- `thinkBodyOff`
- `forceTemperature`

### 3.3 自定义模型

数据库中支持自定义模型标记：
- `is_custom`
- `supports_think`

对应主进程接口支持：
- 新增自定义模型
- 删除自定义模型
- 获取某服务商下的自定义模型
- 获取全部自定义模型

## 4. Agent / Plan / Pipeline

核心目录：
- `src/main/agent/`

### 4.1 Agent 模式

Agent 模式是可执行模式，目标是让模型在工作区内使用工具完成任务。

当前实现已经覆盖：
- 上下文预算控制
- 工具执行与流式回传
- 权限审批
- 运行任务恢复
- Todo 列表
- 成本统计
- MCP 资源/工具接入

关键文件：
- `runtime/queryLoop.ts`
- `runtime/pipelineLoop.ts`
- `runtime/StreamingToolExecutor.ts`
- `runtime/toolExecution.ts`
- `permissions/gate.ts`
- `permissions/pathValidation.ts`
- `mcp/McpConnection.ts`

### 4.2 Plan 模式

Plan 模式是只读规划模式，不直接写文件、不直接执行工具，主要输出结构化实施方案。

约束和行为定义主要在：
- `src/shared/modes.ts`
- `src/shared/plan-ui.ts`

当前前端支持：
- 识别 Plan 澄清消息
- 识别最终实施方案
- 渲染计划面板
- 后续衔接 Agent 执行

### 4.3 Pipeline 模式

Pipeline 模式用于多阶段协同：
- planner
- executor
- reviewer

当前已有：
- Pipeline 配置界面
- 主进程 pipeline loop
- 完成报告结构

关键文件：
- `src/main/agent/runtime/pipelineLoop.ts`
- `src/main/agent/runtime/completionReport.ts`
- `src/renderer/src/components/PipelineConfigurator.tsx`

## 5. IPC 边界

渲染进程不能直接访问数据库或文件系统，统一通过：
- `src/preload/index.ts`
- `src/main/ipc/index.ts`
- `src/main/agent/ipc.ts`

### 5.1 普通设置类 IPC

例如：
- `settings:get-appearance`
- `settings:set-appearance`
- `providers:*`
- `models:*`
- `connectivity:check`

### 5.2 Agent 运行类 IPC

例如：
- `agent:start-run`
- `agent:cancel-run`
- `agent:resume-run`
- `agent:list-parts`
- `agent:list-tool-runs`
- `agent:list-todos`
- `agent:list-tasks`
- `agent:cost-summary`
- `agent:answer-permission`

## 6. 数据库存储

主文件：
- `src/main/db/database.ts`
- `src/main/db/migrations.ts`

数据库位于 Electron `userData` 目录下。

### 6.1 已持久化的核心数据

- 外观设置
- 语言设置
- 服务商配置
- 模型配置
- 自定义模型
- 项目
- 对话
- 消息
- 消息结构化分片
- 工具运行记录
- Agent Todo
- Agent Task
- 权限规则
- 记忆索引
- 成本日志

### 6.2 Migration 约束

当前 migration 体系已经明确要求：
- 已发布 migration 不可修改
- 新 schema 变更只能追加新的 migration
- `ALTER TABLE ADD COLUMN` 要先检查列是否存在
- migration 必须能容忍部分历史数据库状态

这是后续继续扩展 Agent 数据模型时必须遵守的规则。

## 7. 前端界面分工

关键界面文件：
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/ChatPanel.tsx`
- `src/renderer/src/components/AgentMessageList.tsx`
- `src/renderer/src/components/AgentToolCards.tsx`
- `src/renderer/src/components/PlanPanel.tsx`
- `src/renderer/src/components/PipelineConfigurator.tsx`
- `src/renderer/src/components/RunningTasksTray.tsx`
- `src/renderer/src/components/modals/PermissionApprovalModal.tsx`

### 7.1 聊天主界面

负责：
- 模式切换
- 模型选择
- 推理预算选择
- 消息发送
- Plan / Agent / Pipeline 入口切换

### 7.2 Agent 相关 UI

负责：
- 展示结构化消息块
- 展示工具调用卡片
- 展示计划/Todo
- 展示运行中任务
- 展示权限审批弹窗
- 展示恢复提示

## 8. 当前开发约定

1. 新增主进程能力时，优先补：
- `shared/types.ts`
- `shared/ipc-channels.ts`
- `preload/index.ts`
- `main/ipc/*.ts`

2. 新增数据库字段时，优先追加 migration，不再靠零散 try/catch 迁移。

3. 渲染进程不直接拼 IPC 字符串，应复用共享常量。

4. Plan 模式与 Agent 模式的边界要保持清晰：
- Plan 负责方案
- Agent 负责执行

5. 任何“设置会不会持久化”的问题，都要先核对：
- preload 是否暴露
- ipc 是否注册
- database 是否读写
- App.tsx 是否真正调用保存

## 9. 建议后续继续完善的方向

- 为 Plan / Pipeline 增加更细的状态机与测试覆盖
- 把模型目录与能力元数据进一步模块化
- 给 Agent runtime 补更多恢复/回放能力
- 给数据库表结构补 ER 图或字段级文档
- 给 MCP 接入补独立配置文档和调试手册
