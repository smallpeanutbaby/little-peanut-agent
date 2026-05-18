# Little Peanut

> 一个本地优先的多模型桌面 AI 客户端 — 所有配置、密钥、对话、附件全部存在本地 SQLite，密钥用 Electron `safeStorage` 加密落盘。

基于 **Electron + React 19 + TypeScript + Tailwind v4**，使用 `electron-vite` 构建，UI 风格走 Cursor / Claude Desktop 的暗色质感路线。

---

## 当前功能

### 模型与服务商

- **内置主流服务商目录**：OpenAI、Anthropic、Google Gemini、DeepSeek、智谱 GLM、月之暗面 Moonshot、阿里 Qwen3、百度文心、MiniMax 等。
- **三大协议适配器**：`openai-chat` / `anthropic` / `gemini`，统一封装在 `src/main/ai/adapter.ts`。
- **自定义服务商**：支持新增任意 OpenAI 兼容（第三方）/ Anthropic / Gemini 协议的端点，新增即写入本地 DB 持久化。
- **思考预算（Reasoning Budget）**：按模型能力给出 `off / minimal / low / medium / high / max` 等档位，UI 上对不支持的模型自动隐藏。
- **连通性检查**：对单个服务商一键发起带 `/models` 或最小 prompt 的连通性探测，返回耗时 + 状态。
- **单服务商显式"保存"按钮**：避免依赖失焦保存。
- **API Key 安全存储**：通过 Electron `safeStorage` 加密后写入 SQLite，渲染进程拿不到明文。

### 对话能力

- **8 种对话模式**（chat / writing / code / learning / research / brainstorm / translate / summarize），每种模式自带 system prompt、默认温度、默认思考预算、上下文窗口与字符预算。
- **级联模型选择器**：在输入框下方先选 *服务商 ▾*，再选 *该服务商下的模型 ▾*。
- **流式输出（SSE）**：边收边渲染，支持中途取消。
- **思考过程展示开关**：可显示 / 隐藏 reasoning 段。
- **上下文压缩**：按消息条数 + 字符预算双重门槛裁剪历史消息，永远保留最后一条用户消息和 system prompt。
- **图片多模态输入**：支持点击 / 拖拽 / 直接粘贴上传图片，缩略图预览，发送时分别按 OpenAI Vision / Anthropic content blocks / Gemini parts 三种格式打包。
- **空 assistant 占位过滤**：避免旧版本残留的空 assistant 消息让 API 报 "must not be empty"。
- **失败重试**：单条消息失败可一键重发。

### 项目与对话组织

- 侧边栏 **项目**与**对话**两个分组都支持点击展开 / 折叠（持久化）。
- 对话可绑定到项目下，标题根据首条消息自动派生（图片消息生成 `[图片]` 标题）。
- 删除 / 重命名对话、项目均直接落 SQLite。

### 编辑器 / 终端

- 内嵌 **Monaco** 编辑器和 **xterm** 终端的演示壳子（`EditorTerminalShell.tsx`），为后续 Codex 风格 Agent IDE 做准备。

### MCP（Model Context Protocol）

- 主进程内置一个轻量 MCP client（`src/main/mcp/client.ts`），为后续接入工具 / 资源做准备。

### 通用 UI

- **主题切换**：浅 / 深双主题，CSS 变量 + 主题 modal。
- **i18n**：内置中英双语切换（i18next）。
- **持久化 UI 状态**：侧边栏宽度、展开状态、模式偏好等都用 `usePersistedState` 落地。
- **无侵入滚动条**：全局细滚动条，hover 才显形。
- **暗色原生控件适配**：全局 `<select>` 强制 `color-scheme: dark`，Windows 上不再出现"白底白字"。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 36 |
| 构建 | electron-vite + Vite 7 |
| 前端 | React 19、TypeScript 5.9、Tailwind v4、Zustand |
| 编辑器 / 终端 | Monaco、xterm |
| 国际化 | i18next + react-i18next |
| 本地存储 | better-sqlite3 |
| 安全存储 | Electron `safeStorage` |
| 测试 | Vitest |

---

## 目录结构

```
src/
├── main/                 主进程
│   ├── ai/adapter.ts     三协议 AI adapter
│   ├── db/database.ts    SQLite schema + 读写
│   ├── ipc/              IPC handler 注册
│   ├── mcp/client.ts     MCP 客户端
│   └── security/         API Key 加密落盘
├── preload/              预加载脚本（暴露 electronAPI）
├── renderer/             React UI
│   └── src/
│       ├── App.tsx       路由 / 全局状态
│       ├── components/   ChatPanel / Settings / Modals…
│       ├── constants/    服务商目录 / 主题 token
│       ├── hooks/        usePersistedState…
│       ├── i18n/         中英文案
│       └── store/        Zustand stores
├── shared/               主/渲染共享类型与常量
└── tests/                Vitest 测试
```

---

## 本地开发

```bash
cd src
npm install
npm run dev
```

> **修改 preload 后必须完全关闭窗口再 `npm run dev`** —— preload 不参与 HMR，否则会出现 `electronAPI.xxx 不可用` 这类灵异错误。

---

## 构建 / 打包

```bash
cd src
npm run build         # 仅产出 dist + dist-electron
npm run pack          # 打包到 release/<version>/ 目录（不签名）
npm run dist:win      # Windows nsis + portable
npm run dist:mac      # macOS dmg + zip（x64 + arm64）
npm run dist:all      # mac + win 全平台
```

---

## 脚本一览

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发模式（Vite + Electron） |
| `npm run build` | 类型检查 + 打 bundle |
| `npm run typecheck` | 仅类型检查 |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run format` / `npm run format:write` | Prettier |
| `npm test` / `npm run test:ci` | Vitest |
| `npm run rebuild:native` | 针对当前 Electron 版本重建 better-sqlite3 |

---

## License

私有项目，暂未授权。
