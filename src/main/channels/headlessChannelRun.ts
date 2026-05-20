/**
 * Headless agent/chat turn for IM channels (QQ). No Electron WebContents —
 * collects model output and returns text for passive QQ replies.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { compressMessages, getMode } from "@shared/modes.js";
import type {
  ChatRequestOptions,
  Conversation,
  Project,
  ThinkBudget,
  ThinkProtocol
} from "@shared/types.js";
import { formatUserFacingError } from "@shared/displayText.js";
import type { AppDatabase } from "../db/database.js";
import { getAdapter } from "../ai/adapter.js";
import { buildDefaultToolRegistry } from "../agent/tools/registry.js";
import { PermissionGate } from "../agent/permissions/gate.js";
import { queryLoop } from "../agent/runtime/queryLoop.js";
import { TaskManager } from "../agent/runtime/TaskManager.js";
import { bindTaskRuntime } from "../agent/tools/Task/index.js";
import { bindTodoWriteDatabase } from "../agent/tools/TodoWrite/index.js";
import { bindMemoryWriteDatabase } from "../agent/tools/MemoryWrite/index.js";
import type { ProviderRef } from "../agent/llm/types.js";
import type { Tool } from "../agent/tools/Tool.js";
import type { ImSession } from "./session.js";

const MAX_RUN_MS = 4 * 60_000;

/** Fallback model id per built-in provider when model_config is empty or mismatched. */
const CATALOG_DEFAULT_MODEL: Record<string, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-2.5-flash",
  deepseek: "deepseek-v4-flash",
  zhipu: "glm-4.7",
  moonshot: "kimi-k2.5",
  tongyi: "qwen-plus",
  minimax: "MiniMax-M2.5",
  siliconflow: "deepseek-ai/DeepSeek-V3"
};

const CATALOG_DEFAULT_BASE_URL: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  tongyi: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  minimax: "https://api.minimax.chat/v1",
  siliconflow: "https://api.siliconflow.cn/v1"
};

export type ChannelAiResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

/** Same keys as renderer `usePersistedState("chat.provider")` → `ui.chat.provider`. */
function readUiPrefBoolean(db: AppDatabase, key: string): boolean | null {
  const raw = db.getUiPref(key);
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function readUiPrefString(db: AppDatabase, key: string): string | null {
  const raw = db.getUiPref(key);
  if (raw == null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    if (typeof parsed === "number" && Number.isFinite(parsed)) return String(parsed);
  } catch {
    /* legacy plain string */
  }
  const trimmed = raw.trim();
  return trimmed || null;
}

/** Models available for a provider (enabled rows, else catalog default). */
export function listModelsForProvider(db: AppDatabase, providerId: string): string[] {
  const enabled = db.getModelConfigs(providerId).filter((m) => m.enabled);
  if (enabled.length > 0) return enabled.map((m) => m.modelId);
  const all = db.getModelConfigs(providerId);
  if (all.length > 0) return all.map((m) => m.modelId);
  const fallback = CATALOG_DEFAULT_MODEL[providerId];
  return fallback ? [fallback] : [];
}

export function pickDefaultModel(db: AppDatabase, providerId: string, preferred?: string | null): string {
  const configs = db.getModelConfigs(providerId);
  const enabled = configs.filter((m) => m.enabled);
  const pool = enabled.length > 0 ? enabled : configs;
  const uiProvider = readUiPrefString(db, "chat.provider");
  const uiModel = readUiPrefString(db, "chat.model");

  const pickFromPool = (modelId: string | null | undefined): string | null => {
    if (!modelId?.trim()) return null;
    const id = modelId.trim();
    if (pool.length === 0) return null;
    const row = pool.find((m) => m.modelId === id);
    return row ? id : null;
  };

  if (pool.length > 0) {
    return (
      pickFromPool(preferred) ??
      pickFromPool(uiProvider === providerId ? uiModel : null) ??
      pool[0].modelId
    );
  }

  // No model_config rows — only trust ids that belong to this provider context.
  if (preferred?.trim() && (!uiProvider || uiProvider === providerId)) return preferred.trim();
  if (uiModel && uiProvider === providerId) return uiModel;
  return CATALOG_DEFAULT_MODEL[providerId] ?? "gpt-4o-mini";
}

function resolveBaseUrl(providerId: string, protocol: string, stored: string): string {
  const trimmed = stored.trim();
  if (trimmed) return trimmed;
  if (CATALOG_DEFAULT_BASE_URL[providerId]) return CATALOG_DEFAULT_BASE_URL[providerId];
  if (protocol === "anthropic-messages") return "https://api.anthropic.com/v1";
  if (protocol === "google-gemini") return "https://generativelanguage.googleapis.com/v1beta";
  return "https://api.openai.com/v1";
}

function resolveChannelThinkOptions(
  db: AppDatabase,
  providerId: string,
  modelId: string,
  conv?: Pick<Conversation, "thinkEnabled" | "thinkBudget"> | null
): { thinkEnabled: boolean; thinkBudget: ThinkBudget; thinkProtocol: ThinkProtocol | null } {
  const row = db.getModelConfigs(providerId).find((m) => m.modelId === modelId);
  const hasReasoning = row?.capabilities?.includes("reasoning") ?? false;
  const uiEnabled = readUiPrefBoolean(db, "chat.thinkEnabled");
  const uiBudget = readUiPrefString(db, "chat.thinkBudget") as ThinkBudget | null;
  if (!hasReasoning) {
    return { thinkEnabled: false, thinkBudget: "none", thinkProtocol: null };
  }
  return {
    thinkEnabled: conv?.thinkEnabled ?? uiEnabled ?? row?.thinkEnabled ?? false,
    thinkBudget:
      (conv?.thinkBudget as ThinkBudget | null) ?? uiBudget ?? row?.thinkBudget ?? "medium",
    thinkProtocol: row?.thinkProtocol ?? null
  };
}

/** Short QQ messages in agent/plan mode → chat API (no tools), faster and more reliable. */
function shouldUseQuickChatOnQQ(modeId: string, text: string): boolean {
  if (modeId !== "agent" && modeId !== "plan") return false;
  const t = text.trim();
  if (!t || t.length > 120) return false;
  if (
    /(?:写|改|删|创建|实现|修复|refactor|代码|文件|脚本|测试|deploy|build|npm|git\s|审查|diff)/i.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

function channelFailMessage(
  prov: { providerId: string; model: string },
  raw: string | undefined | null,
  reason?: string
): string {
  const generic = formatUserFacingError(null, "stream_error", "zh");
  let detail = formatUserFacingError(raw, reason ?? "stream_error", "zh");
  if (detail === generic && raw?.trim()) {
    const cleaned = raw.trim().slice(0, 500);
    if (cleaned) detail = cleaned;
  }
  return `${detail}\n（${prov.providerId} / ${prov.model}）`;
}

export function ensureChannelConversation(
  db: AppDatabase,
  session: ImSession,
  project: Project | null
): Conversation {
  if (session.activeConversationId) {
    const existing = db.getConversation(session.activeConversationId);
    if (existing) return existing;
  }
  const uiProvider = readUiPrefString(db, "chat.provider");
  const uiModel = readUiPrefString(db, "chat.model");
  const providerId =
    session.activeProviderId ?? project?.defaultProviderId ?? uiProvider ?? null;
  const modelId =
    session.activeModelId ??
    project?.defaultModelId ??
    (providerId ? pickDefaultModel(db, providerId, uiModel) : uiModel);
  const think =
    providerId && modelId
      ? resolveChannelThinkOptions(db, providerId, modelId, null)
      : { thinkEnabled: false, thinkBudget: "none" as ThinkBudget, thinkProtocol: null };

  const conv = db.createConversation({
    projectId: session.activeProjectId,
    name: "QQ 对话",
    providerId,
    modelId: modelId ?? null,
    thinkBudget: think.thinkBudget,
    thinkEnabled: think.thinkEnabled,
    modeId: session.activeModeId ?? "chat"
  });
  session.activeConversationId = conv.id;
  return conv;
}

function resolveProvider(
  db: AppDatabase,
  conv: Conversation,
  project: Project | null,
  session?: Pick<ImSession, "activeProviderId" | "activeModelId">
): { providerId: string; protocol: string; baseUrl: string; apiKey: string; model: string } | null {
  const all = db.getAllProviderConfigs();
  const byId = new Map(all.map((p) => [p.id, p]));

  if (session?.activeProviderId?.trim()) {
    const pc = byId.get(session.activeProviderId.trim());
    if (pc?.apiKey?.trim()) {
      const model = pickDefaultModel(
        db,
        pc.id,
        session.activeModelId ?? conv.modelId ?? project?.defaultModelId
      );
      return {
        providerId: pc.id,
        protocol: pc.protocol,
        baseUrl: resolveBaseUrl(pc.id, pc.protocol, pc.baseUrl),
        apiKey: pc.apiKey,
        model
      };
    }
  }

  const uiProvider = readUiPrefString(db, "chat.provider");
  const configPageProvider = readUiPrefString(db, "modelConfig.selectedProvider");
  const orderedIds: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id && !orderedIds.includes(id)) orderedIds.push(id);
  };
  push(conv.providerId);
  push(project?.defaultProviderId);
  push(uiProvider);
  push(configPageProvider);
  for (const p of all) {
    push(p.id);
  }

  const preferredModel =
    session?.activeModelId ??
    conv.modelId ??
    project?.defaultModelId ??
    readUiPrefString(db, "chat.model");

  for (const id of orderedIds) {
    const pc = byId.get(id);
    if (!pc?.apiKey?.trim()) continue;
    const model = pickDefaultModel(db, pc.id, preferredModel);
    return {
      providerId: pc.id,
      protocol: pc.protocol,
      baseUrl: resolveBaseUrl(pc.id, pc.protocol, pc.baseUrl),
      apiKey: pc.apiKey,
      model
    };
  }
  return null;
}

/** QQ / IM: explain why resolveProvider failed without exposing secrets. */
export function diagnoseChannelModel(
  db: AppDatabase,
  session?: Pick<ImSession, "activeProviderId" | "activeModelId">
): string {
  const all = db.getAllProviderConfigs();
  const chatProv = readUiPrefString(db, "chat.provider");
  const chatModel = readUiPrefString(db, "chat.model");
  const cfgProv = readUiPrefString(db, "modelConfig.selectedProvider");
  const lines = [
    "【模型诊断】",
    session?.activeProviderId && session?.activeModelId
      ? `QQ 指定：${session.activeProviderId} / ${session.activeModelId}`
      : "QQ 指定：（未设置，跟随桌面聊天窗口）",
    `聊天窗口选择：${chatProv ?? "（未记录）"} / ${chatModel ?? "（未记录）"}`,
    `AI配置页选中：${cfgProv ?? "（未记录）"}`
  ];
  if (all.length === 0) {
    lines.push("数据库里没有服务商记录。");
    lines.push("请打开左侧「AI配置」，填写 API Key 后点「保存」。");
    return lines.join("\n");
  }
  for (const p of all) {
    const key = p.apiKey?.trim();
    const keyState = key
      ? `Key 已保存（${key.length} 字符）`
      : "未保存或无法解密（请重新填写并保存）";
    lines.push(`· ${p.name}（${p.id}）${p.enabled ? "已启用" : "已禁用"} — ${keyState}`);
  }
  const probe = resolveProvider(db, { providerId: null, modelId: null } as Conversation, null, session);
  lines.push(
    probe
      ? `QQ 可用：${probe.providerId} / ${probe.model}`
      : "QQ 当前仍无法选用任何带 Key 的服务商。"
  );
  if (!probe) {
    lines.push("若桌面能聊而这里显示 Key 缺失，请在「AI配置」重新输入 Key 并点保存，然后重启应用。");
  }
  return lines.join("\n");
}

function backfillConversationProvider(
  db: AppDatabase,
  conv: Conversation,
  project: Project | null,
  session?: ImSession
): Conversation {
  const resolved = resolveProvider(db, conv, project, session);
  if (!resolved) return conv;
  if (conv.providerId === resolved.providerId && conv.modelId === resolved.model) {
    return conv;
  }
  return db.updateConversation(conv.id, {
    providerId: resolved.providerId,
    modelId: resolved.model
  }) ?? conv;
}

async function runHeadlessChat(
  db: AppDatabase,
  conv: Conversation,
  userMessage: string,
  signal: AbortSignal,
  project: Project | null,
  session?: ImSession
): Promise<ChannelAiResult> {
  const prov = resolveProvider(db, conv, project, session);
  if (!prov) {
    return { ok: false, message: "未配置 API Key。请在 Little Peanut 设置里添加模型服务商。" };
  }

  const mode = getMode(conv.modeId ?? "chat");
  const think = resolveChannelThinkOptions(db, prov.providerId, prov.model, conv);
  const history = db
    .listMessages(conv.id)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => (m.content ?? "").trim().length > 0);
  const messages = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: userMessage }
  ];
  const hasSystem = messages.some((m) => m.role === "system");
  const withSystem = hasSystem
    ? messages
    : [{ role: "system" as const, content: mode.systemPrompt }, ...messages];
  const compressed = compressMessages(withSystem, mode);

  db.appendMessage({ conversationId: conv.id, role: "user", content: userMessage });
  const placeholder = db.appendMessage({ conversationId: conv.id, role: "assistant", content: "" });

  const req: ChatRequestOptions = {
    protocol: prov.protocol,
    baseUrl: prov.baseUrl,
    apiKey: prov.apiKey,
    model: prov.model,
    messages: compressed.messages as ChatRequestOptions["messages"],
    temperature: mode.defaultTemperature,
    thinkEnabled: think.thinkEnabled,
    thinkBudget: think.thinkBudget,
    thinkProtocol: think.thinkProtocol
  };

  let text = "";
  let err: string | null = null;
  try {
    const adapter = getAdapter(req.protocol);
    for await (const ev of adapter.stream(req, signal)) {
      if (ev.type === "text") text += ev.text;
      if (ev.type === "error") err = ev.message;
      if (ev.type === "done" || ev.type === "error") break;
    }
  } catch (e) {
    err = (e as Error).message;
  }

  if (text.trim()) {
    db.finalizeMessage(placeholder.id, text, null);
    return { ok: true, text: text.trim() };
  }
  const safe = channelFailMessage(prov, err ?? "无回复");
  db.finalizeMessage(placeholder.id, `⚠️ ${safe}`, null);
  return { ok: false, message: safe };
}

async function runHeadlessAgent(
  db: AppDatabase,
  input: {
    project: Project;
    conversationId: string;
    userMessage: string;
    modeId: string;
    provider: ReturnType<typeof resolveProvider> & object;
  },
  signal: AbortSignal
): Promise<ChannelAiResult> {
  const projectRoot = (input.project.path ?? "").trim();
  if (!projectRoot) {
    return { ok: false, message: "项目未绑定本地文件夹，请在桌面端为项目选择路径。" };
  }
  try {
    const st = fs.statSync(projectRoot);
    if (!st.isDirectory()) {
      return { ok: false, message: `项目路径不是文件夹: ${projectRoot}` };
    }
  } catch {
    return { ok: false, message: `项目目录不存在: ${projectRoot}` };
  }

  const mode = getMode(input.modeId);
  const convRow = db.getConversation(input.conversationId);
  const think = resolveChannelThinkOptions(
    db,
    input.provider.providerId,
    input.provider.model,
    convRow
  );
  if (mode.id === "review") {
    return {
      ok: false,
      message: "审查模式需要先在桌面端配置审查范围。QQ 可发「模式 agent」切换后再提问。"
    };
  }
  if (mode.id === "pipeline") {
    return {
      ok: false,
      message: "流水线模式请在桌面端使用。QQ 可发「模式 agent」或「模式 chat」后再提问。"
    };
  }

  bindTodoWriteDatabase(db);
  bindMemoryWriteDatabase(db);
  const taskManager = new TaskManager(db);
  bindTaskRuntime({
    db,
    taskManager,
    buildChildRegistry: () => {
      const r = buildDefaultToolRegistry();
      r.unregister?.("Task");
      r.unregister?.("TodoWrite");
      return r;
    },
    resolveDefaultProvider: () => ({
      provider: {
        id: input.provider.providerId,
        protocol: input.provider.protocol,
        baseUrl: input.provider.baseUrl,
        apiKey: input.provider.apiKey
      },
      model: input.provider.model
    }),
    buildGateForSubagent: async () =>
      new PermissionGate(db.agent, { ask: async () => ({ kind: "allow", scope: "once" }) })
  });

  const gate = new PermissionGate(db.agent, { ask: async () => ({ kind: "allow", scope: "once" }) });
  gate.bypassAll = true;

  const registry = buildDefaultToolRegistry();
  try {
    const { getMcpManager } = await import("../agent/mcp/registry.js");
    await getMcpManager().refreshAll(db.listMcpServers());
    for (const t of await getMcpManager().buildTools()) {
      try {
        registry.register(t);
      } catch {
        /* dup */
      }
    }
  } catch {
    /* optional */
  }

  let skillHints: Array<{ name: string; source: "project" | "user"; description: string }> = [];
  try {
    const { loadSkills } = await import("../agent/skills/loader.js");
    const { bindSkillCatalog } = await import("../agent/tools/Skill/index.js");
    const skillRoots: Array<{ dir: string; source: "project" | "user" }> = [];
    skillRoots.push({ dir: path.join(projectRoot, ".agent", "skills"), source: "project" });
    try {
      skillRoots.push({ dir: path.join(app.getPath("userData"), "skills"), source: "user" });
    } catch {
      /* test */
    }
    const skills = await loadSkills(skillRoots);
    bindSkillCatalog(skills);
    skillHints = skills.map((s) => ({ name: s.name, source: s.source, description: s.description }));
  } catch {
    /* optional */
  }

  const allTools: Tool[] = registry.list();
  const tools: Tool[] =
    mode.id === "plan"
      ? allTools.filter((t) => {
          try {
            return t.isReadOnly({} as never) === true;
          } catch {
            return false;
          }
        })
      : allTools;

  const runId = randomUUID();
  const primaryProvider: ProviderRef = {
    id: input.provider.providerId,
    protocol: input.provider.protocol,
    baseUrl: input.provider.baseUrl,
    apiKey: input.provider.apiKey
  };

  let streamed = "";
  let terminalError: string | undefined;

  try {
    db.agent.markConversationRun(input.conversationId, runId, "in_progress");
  } catch {
    /* ignore */
  }

  try {
    for await (const ev of queryLoop({
      runId,
      conversationId: input.conversationId,
      projectId: input.project.id,
      projectRoot,
      projectName: input.project.name,
      userMessage: input.userMessage,
      mode,
      provider: primaryProvider,
      model: input.provider.model,
      temperature: mode.defaultTemperature,
      thinkBudget: think.thinkBudget,
      thinkEnabled: think.thinkEnabled,
      thinkProtocol: think.thinkProtocol,
      language: "zh-CN",
      tools,
      signal,
      db,
      gate,
      skillHints
    })) {
      if (ev.kind === "llm" && ev.event.type === "text_delta") {
        streamed += ev.event.text;
      }
      if (ev.kind === "terminal") {
        if (ev.reason !== "completed") {
          terminalError = ev.message ?? ev.reason;
        }
        break;
      }
    }
  } catch (e) {
    terminalError = (e as Error).message;
  } finally {
    try {
      db.agent.markConversationRun(
        input.conversationId,
        runId,
        terminalError ? "failed" : "completed"
      );
    } catch {
      /* ignore */
    }
  }

  const msgs = db.listMessages(input.conversationId);
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const finalText = (lastAssistant?.content ?? streamed).trim();

  if (finalText && !finalText.startsWith("⚠️")) {
    return { ok: true, text: finalText };
  }
  console.error(
    "[qq-bot] agent run failed:",
    terminalError ?? finalText,
    input.provider.providerId,
    input.provider.model
  );
  return { ok: false, message: channelFailMessage(input.provider, terminalError ?? finalText) };
}

export async function runChannelNaturalLanguage(
  db: AppDatabase,
  opts: {
    session: ImSession;
    project: Project | null;
    userMessage: string;
  }
): Promise<ChannelAiResult> {
  let conv = ensureChannelConversation(db, opts.session, opts.project);
  conv = backfillConversationProvider(db, conv, opts.project, opts.session);
  const sessionMode = opts.session.activeModeId;
  if (sessionMode && conv.modeId !== sessionMode) {
    conv = db.updateConversation(conv.id, { modeId: sessionMode }) ?? conv;
  }
  const prov = resolveProvider(db, conv, opts.project, opts.session);
  if (!prov) {
    const uiName = readUiPrefString(db, "chat.provider");
    const hint = uiName
      ? `当前桌面端选择的服务商是「${uiName}」，但未检测到有效 API Key。`
      : "请先在桌面端聊天窗口选好服务商与模型。";
    return {
      ok: false,
      message:
        `未找到可用的模型配置。${hint}\n请到桌面端左侧「AI配置」保存 API Key；发「检查模型」可查看 QQ 读到的配置。`
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_RUN_MS);

  try {
    const modeId = opts.session.activeModeId ?? conv.modeId ?? "chat";
    const projectPath = (opts.project?.path ?? "").trim();

    if (opts.project && (modeId === "agent" || modeId === "plan") && projectPath) {
      if (shouldUseQuickChatOnQQ(modeId, opts.userMessage)) {
        return await runHeadlessChat(
          db,
          conv,
          opts.userMessage,
          controller.signal,
          opts.project,
          opts.session
        );
      }
      return await runHeadlessAgent(
        db,
        {
          project: opts.project,
          conversationId: conv.id,
          userMessage: opts.userMessage,
          modeId,
          provider: prov
        },
        controller.signal
      );
    }

    if (opts.project && (modeId === "agent" || modeId === "plan") && !projectPath) {
      return {
        ok: false,
        message:
          "当前为 agent/plan 模式，但项目未绑定文件夹。请在桌面端为项目选择路径，或发「模式 chat」后提问。"
      };
    }

    return await runHeadlessChat(db, conv, opts.userMessage, controller.signal, opts.project, opts.session);
  } finally {
    clearTimeout(timer);
  }
}
