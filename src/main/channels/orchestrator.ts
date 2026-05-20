import type { ChannelBotConfig } from "@shared/channelBots.js";
import { CHANNEL_DEFAULT_MODE_IDS } from "@shared/channelBots.js";
import { CHAT_MODE_MAP } from "@shared/modes.js";
import type { AppDatabase } from "../db/database.js";
import type { Project } from "@shared/types.js";
import {
  clearActiveMenu,
  isMenuActive,
  loadImSession,
  saveImSession,
  nextReplySeq,
  setActiveMenu,
  type ImSession
} from "./session.js";
import { sendC2CMessage } from "./qq/api.js";
import {
  diagnoseChannelModel,
  listModelsForProvider,
  pickDefaultModel,
  runChannelNaturalLanguage
} from "./headlessChannelRun.js";

export interface QqInboundMessage {
  openid: string;
  content: string;
  msgId: string;
}

type ReplyFn = (text: string) => Promise<void>;

export class ChannelOrchestrator {
  constructor(private readonly db: AppDatabase) {}

  async handleQqMessage(
    cfg: ChannelBotConfig,
    creds: { appId: string; appSecret: string },
    msg: QqInboundMessage
  ): Promise<void> {
    if (!this.isAllowed(cfg, msg.openid)) {
      console.warn("[qq-bot] 未在白名单，已忽略。openid =", msg.openid);
      return;
    }
    let session = loadImSession(this.db, "qq", msg.openid);
    if (!session.activeProjectId && cfg.defaultProjectId) {
      session.activeProjectId = cfg.defaultProjectId;
      session.activeModeId = cfg.defaultModeId;
    }
    const reply: ReplyFn = async (text) => {
      const chunks = splitMessage(text, 1800);
      for (let i = 0; i < chunks.length; i++) {
        await sendC2CMessage({
          appId: creds.appId,
          clientSecret: creds.appSecret,
          openid: msg.openid,
          content: chunks[i],
          msgId: msg.msgId,
          msgSeq: nextReplySeq(session, msg.msgId),
          sandbox: cfg.sandboxMode
        });
      }
      saveImSession(this.db, session);
    };

    const text = (msg.content ?? "").trim().replace(/@\S+/g, "").trim();
    console.info("[qq-bot] 私聊", msg.openid, text.slice(0, 80));
    if (!text) {
      await reply(this.formatReadyCard(session) + "\n\n发送「帮助」查看指令。");
      return;
    }

    try {
      const cmd = await this.dispatch(cfg, session, text);
      if (cmd !== null) {
        saveImSession(this.db, session);
        await reply(cmd);
        return;
      }

      if (!session.activeModeId) {
        session.activeModeId = (cfg.defaultModeId ?? "chat") as ImSession["activeModeId"];
      }

      const project = session.activeProjectId
        ? this.db.listProjects().find((p) => p.id === session.activeProjectId) ?? null
        : null;

      if (!session.activeProjectId) {
        const projects = this.db.listProjects();
        if (projects.length === 1) {
          session.activeProjectId = projects[0].id;
          session.activeModeId =
            session.activeModeId ?? (cfg.defaultModeId ?? "chat");
        }
      }

      if (!session.activeProjectId) {
        saveImSession(this.db, session);
        await reply(
          "请先选择项目（发「我的项目」），或在机器人设置里指定默认项目。\n\n" +
            this.formatReadyCard(session)
        );
        return;
      }

      if (isMeaninglessInput(text)) {
        saveImSession(this.db, session);
        await reply(this.formatReadyCard(session));
        return;
      }

      saveImSession(this.db, session);
      await reply("收到，正在思考…");

      const result = await runChannelNaturalLanguage(this.db, {
        session,
        project,
        userMessage: text
      });
      saveImSession(this.db, session);
      await reply(result.ok ? result.text : `⚠️ ${result.message}`);
    } catch (e) {
      const err = (e as Error).message || String(e);
      console.error("[qq-bot] dispatch error:", err);
      await reply(`⚠️ ${err}`);
    }
  }

  private isAllowed(cfg: ChannelBotConfig, openid: string): boolean {
    // 白名单为空 = 不限制（个人自用）；填写后仅允许列表中的 openid。
    if (cfg.allowFrom.length === 0) return true;
    const norm = openid.toUpperCase();
    return cfg.allowFrom.some((a) => {
      const entry = a.trim();
      if (!entry) return false;
      return entry.toUpperCase() === norm || entry === openid;
    });
  }

  private async dispatch(cfg: ChannelBotConfig, session: ImSession, text: string): Promise<string | null> {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    if (/^(帮助|\?|help)$/.test(lower)) {
      return helpText() + "\n\n" + this.formatReadyCard(session);
    }
    if (/^(开始|菜单|menu)$/.test(lower)) {
      return this.formatReadyCard(session);
    }
    if (/^(状态|status)$/.test(lower)) {
      return this.formatStatus(session) + "\n\n" + this.formatReadyCard(session);
    }
    if (/^(检查模型|模型检查|model\s*check)$/i.test(lower)) {
      return diagnoseChannelModel(this.db, session);
    }
    if (/^(我的)?模型$|^models?$/i.test(lower)) {
      return this.listModelProviders(session);
    }
    const modelPickNum = trimmed.match(/^模型\s+(\d+)$/i);
    if (modelPickNum) {
      return this.pickModelProvider(session, Number(modelPickNum[1]));
    }
    const modelCmd = trimmed.match(/^模型\s+(.+)$/i);
    if (modelCmd) {
      const rest = modelCmd[1].trim();
      if (/^(默认|跟随桌面|desktop)$/i.test(rest)) {
        return this.clearSessionModel(session);
      }
      const parts = rest.split(/\s+/);
      return this.setSessionModel(session, parts[0], parts[1]);
    }
    if (/^(我的)?项目$|^projects?$/i.test(lower)) {
      return this.listProjects(session, cfg);
    }
    if (/^(我的)?对话$|^chats?$/i.test(lower)) {
      return this.listConversations(session);
    }

    const pickProjectExplicit = trimmed.match(/^(?:选\s*|项目\s*|#|project\s*)(\d+)$/i);
    if (pickProjectExplicit) {
      return this.pickProject(session, cfg, Number(pickProjectExplicit[1]));
    }
    const pickChatExplicit = trimmed.match(/^(?:进\s*|chat\s*)(\d+)$/i);
    if (pickChatExplicit) {
      return this.pickConversation(session, Number(pickChatExplicit[1]));
    }

    const modeNumExplicit = trimmed.match(/^模式\s+(\d+)$/i);
    if (modeNumExplicit) {
      const id = CHANNEL_DEFAULT_MODE_IDS[Number(modeNumExplicit[1]) - 1];
      if (id) return this.setMode(session, id);
      return `无效模式序号。发「模式」查看列表，或发「模式 agent」。`;
    }
    const mShortcut = trimmed.match(/^m(\d+)$/i);
    if (mShortcut) {
      const id = CHANNEL_DEFAULT_MODE_IDS[Number(mShortcut[1]) - 1];
      if (id) return this.setMode(session, id);
      return `无效模式序号。发「模式 agent」等。`;
    }

    if (/^\d+$/.test(trimmed)) {
      return this.handleNumericInput(session, cfg, Number(trimmed));
    }

    if (/^(agent|chat|plan|review|pipeline)$/i.test(lower)) {
      return this.setMode(session, lower);
    }
    if (/用\s*agent|切换.*agent|改成\s*agent|改为\s*agent/i.test(trimmed)) {
      return this.setMode(session, "agent");
    }
    if (/用\s*chat|切换.*chat|改成\s*chat|改为\s*chat|对话模式/i.test(trimmed)) {
      return this.setMode(session, "chat");
    }
    if (/用\s*plan|切换.*plan|改成\s*plan|改为\s*plan|规划模式/i.test(trimmed)) {
      return this.setMode(session, "plan");
    }

    const projectHit = this.matchProjectByName(session, trimmed);
    if (projectHit) {
      return this.pickProject(session, cfg, projectHit.index);
    }

    if (/有什么模式|有哪些模式|模式有哪些|模式列表|都有什么模式/.test(trimmed)) {
      return this.setMode(session);
    }
    if (/开启.*审查|打开.*审查|切换.*审查|审查模式/.test(trimmed)) {
      return this.setMode(session, "review");
    }

    const modeMatch = trimmed.match(/^(?:模式|mode)\s*(\S+)?$/i);
    if (modeMatch) {
      return this.setMode(session, this.normalizeModeArg(modeMatch[1]));
    }
    const newChat = trimmed.match(/^新建对话\s*(.*)$/i);
    if (newChat) {
      return this.createConversation(session, newChat[1]?.trim() || "QQ 对话");
    }

    return null;
  }

  private matchProjectByName(
    session: ImSession,
    raw: string
  ): { index: number; project: Project } | null {
    const q = raw.trim().toLowerCase().replace(/\s+/g, "");
    if (!q || q.length < 2) return null;
    const projects = session._projectList ?? this.db.listProjects();
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      const name = p.name.toLowerCase().replace(/\s+/g, "");
      const base = name.split(/[\\/]/).pop() ?? name;
      if (name === q || base === q || name.includes(q) || q.includes(name)) {
        return { index: i + 1, project: p };
      }
    }
    return null;
  }

  private listProjects(session: ImSession, cfg: ChannelBotConfig): string {
    const projects = this.db.listProjects();
    if (projects.length === 0) {
      return "暂无项目。请在 Little Peanut 桌面端创建项目并绑定文件夹。";
    }
    session._projectList = projects;
    setActiveMenu(session, "projects");
    session._conversationList = undefined;
    const lines = projects.map((p, i) => formatProjectLine(i + 1, p));
    if (!session.activeProjectId && cfg.defaultProjectId) {
      const idx = projects.findIndex((p) => p.id === cfg.defaultProjectId);
      if (idx >= 0) {
        session.activeProjectId = projects[idx].id;
        session.activeModeId = cfg.defaultModeId;
      }
    }
    if (projects.length === 1) {
      session.activeProjectId = projects[0].id;
      session.activeConversationId = null;
      session.activeModeId = cfg.defaultModeId;
      return [
        `【项目】仅 1 个，已自动选中：`,
        formatProjectLine(1, projects[0]),
        "",
        this.formatReadyCard(session)
      ].join("\n");
    }

    const hint =
      projects.length <= 3
        ? projects.map((_, i) => String(i + 1)).join(" / ")
        : `1～${projects.length}`;
    return `【项目】共 ${projects.length} 个\n${lines.join("\n")}\n\n回复：选 1 或 项目 1（也支持纯数字，10 分钟内有效）`;
  }

  private pickProject(session: ImSession, cfg: ChannelBotConfig, n: number): string {
    const projects = session._projectList ?? this.db.listProjects();
    session._projectList = projects;
    const p = projects[n - 1];
    if (!p) {
      return `序号 ${n} 无效。当前共 ${projects.length} 个项目，请发 1～${projects.length}，或重新发「我的项目」。`;
    }
    session.activeProjectId = p.id;
    session.activeConversationId = null;
    session.activeModeId = cfg.defaultModeId;
    clearActiveMenu(session);
    return `已选项目【${p.name}】\n路径：${p.path || "（未绑定）"}\n\n${this.formatReadyCard(session)}`;
  }

  private handleNumericInput(session: ImSession, cfg: ChannelBotConfig, n: number): string {
    if (session._lastMenu && !isMenuActive(session)) {
      return [
        "菜单已过期（超过 10 分钟）。",
        "请用明确指令，例如：",
        "· 模式 agent / 模式 3",
        "· 选 1 / 项目 1",
        "· 我的模型"
      ].join("\n");
    }

    if (isMenuActive(session) && session._lastMenu === "modes") {
      const id = CHANNEL_DEFAULT_MODE_IDS[n - 1];
      if (id) return this.setMode(session, id);
      return `无效序号。发「模式」查看列表，或「模式 agent」。`;
    }
    if (isMenuActive(session) && session._lastMenu === "conversations" && session.activeProjectId) {
      return this.pickConversation(session, n);
    }
    if (isMenuActive(session) && session._lastMenu === "model-providers") {
      return this.pickModelProvider(session, n);
    }
    if (isMenuActive(session) && session._lastMenu === "model-ids") {
      return this.pickModelId(session, n);
    }
    if (isMenuActive(session) && session._lastMenu === "projects") {
      return this.pickProject(session, cfg, n);
    }

    if (session.activeProjectId && n >= 1 && n <= CHANNEL_DEFAULT_MODE_IDS.length) {
      const id = CHANNEL_DEFAULT_MODE_IDS[n - 1];
      if (id) return this.setMode(session, id);
    }

    return this.pickProject(session, cfg, n);
  }

  private formatReadyCard(session: ImSession): string {
    const project = session.activeProjectId
      ? this.db.listProjects().find((p) => p.id === session.activeProjectId)
      : null;
    return [
      "【就绪】",
      `项目：${project?.name ?? "未选择"}${project?.path ? ` · ${project.path}` : ""}`,
      `模式：${modeLabel(session.activeModeId)} · 模型：${this.sessionModelSummary(session)}`,
      "下一步：",
      "· 直接发文字提问",
      "· 模式 agent — 改代码",
      "· 模式 3 / 模式 plan — 切换模式（推荐带「模式」前缀）",
      "· 我的模型 — 换模型",
      "· 状态 — 查看详情"
    ].join("\n");
  }

  private listConversations(session: ImSession): string {
    if (!session.activeProjectId) {
      return "请先「选」一个项目（发送「我的项目」）。";
    }
    const convs = this.db.listConversations(session.activeProjectId);
    if (convs.length === 0) {
      return "该项目下暂无对话。发送：新建对话 名称";
    }
    session._conversationList = convs;
    setActiveMenu(session, "conversations");
    const lines = convs.map((c, i) => `${i + 1}. ${c.name}（${modeLabel(c.modeId)}）`);

    if (convs.length === 1) {
      session.activeConversationId = convs[0].id;
      session.activeModeId = convs[0].modeId as ImSession["activeModeId"];
      return `【对话】仅 1 个，已自动进入：\n1. ${convs[0].name}（${modeLabel(convs[0].modeId)}）`;
    }

    const hint =
      convs.length <= 3
        ? convs.map((_, i) => String(i + 1)).join(" / ")
        : `1～${convs.length}`;
    return `【对话】\n${lines.join("\n")}\n\n回复序号即可：${hint}（也支持 进 1）`;
  }

  private pickConversation(session: ImSession, n: number): string {
    const convs = session._conversationList ?? [];
    if (!session.activeProjectId) return "请先选择项目。";
    const list = convs.length ? convs : this.db.listConversations(session.activeProjectId);
    session._conversationList = list;
    const c = list[n - 1];
    if (!c) {
      return `序号 ${n} 无效。当前共 ${list.length} 个对话，请发 1～${list.length}，或重新发「我的对话」。`;
    }
    session.activeConversationId = c.id;
    session.activeModeId = c.modeId as ImSession["activeModeId"];
    return `已进入对话【${c.name}】模式：${modeLabel(c.modeId)}`;
  }

  private normalizeModeArg(raw?: string): string | undefined {
    if (!raw) return undefined;
    const id = raw.trim().toLowerCase();
    const aliases: Record<string, string> = {
      对话: "chat",
      聊天: "chat",
      智能体: "agent",
      代理: "agent",
      规划: "plan",
      计划: "plan",
      审查: "review",
      审阅: "review",
      流水线: "pipeline"
    };
    return aliases[id] ?? id;
  }

  private sessionModelSummary(session: ImSession): string {
    if (session.activeProviderId && session.activeModelId) {
      return `${session.activeProviderId} / ${session.activeModelId}`;
    }
    return "跟随桌面聊天窗口";
  }

  private listModelProviders(session: ImSession): string {
    const providers = this.db.getAllProviderConfigs().filter((p) => p.apiKey?.trim());
    if (providers.length === 0) {
      return "没有已保存 API Key 的服务商。请到桌面端「AI配置」填写并保存。";
    }
    session._modelProviderList = providers;
    session._modelIdList = undefined;
    setActiveMenu(session, "model-providers");
    const lines = providers.map((p, i) => `${i + 1}. ${p.name}（${p.id}）`);
    const hint =
      providers.length <= 5
        ? providers.map((_, i) => String(i + 1)).join(" / ")
        : `1～${providers.length}`;
    return [
      "【模型】",
      `当前：${this.sessionModelSummary(session)}`,
      "",
      ...lines,
      "",
      `回复序号选服务商：${hint}`,
      "或：模型 deepseek deepseek-v4-flash",
      "发「模型 默认」恢复跟随桌面"
    ].join("\n");
  }

  private pickModelProvider(session: ImSession, n: number): string {
    const providers = session._modelProviderList ?? [];
    const p = providers[n - 1];
    if (!p) {
      return `序号 ${n} 无效。请重新发「我的模型」。`;
    }
    const models = listModelsForProvider(this.db, p.id);
    if (models.length === 0) {
      return `服务商【${p.name}】下没有可用模型，请在桌面端「AI配置」添加。`;
    }
    if (models.length === 1) {
      return this.setSessionModel(session, p.id, models[0]);
    }
    session._modelProviderList = providers;
    session._modelIdList = models;
    session._modelPickerProviderId = p.id;
    setActiveMenu(session, "model-ids");
    const lines = models.slice(0, 15).map((id, i) => `${i + 1}. ${id}`);
    const hint = models
      .slice(0, 15)
      .map((_, i) => String(i + 1))
      .join(" / ");
    return [
      `【${p.name} 模型】`,
      ...lines,
      models.length > 15 ? `… 共 ${models.length} 个，仅显示前 15 个` : "",
      "",
      `回复序号：${hint}`,
      `或：模型 ${p.id} <模型名>`
    ]
      .filter(Boolean)
      .join("\n");
  }

  private pickModelId(session: ImSession, n: number): string {
    const models = session._modelIdList ?? [];
    const modelId = models[n - 1];
    if (!modelId) {
      return `序号 ${n} 无效。请重新发「我的模型」。`;
    }
    const providerId = session._modelPickerProviderId;
    if (!providerId) {
      return "请先选服务商（发「我的模型」）。 ";
    }
    return this.setSessionModel(session, providerId, modelId);
  }

  private setSessionModel(session: ImSession, providerArg: string, modelArg?: string): string {
    const providers = this.db.getAllProviderConfigs().filter((p) => p.apiKey?.trim());
    const q = providerArg.trim().toLowerCase();
    const provider =
      providers.find((p) => p.id.toLowerCase() === q) ??
      providers.find((p) => p.name.toLowerCase().includes(q));
    if (!provider) {
      return `未找到服务商「${providerArg}」。发「我的模型」查看列表。`;
    }
    const models = listModelsForProvider(this.db, provider.id);
    let modelId = modelArg?.trim();
    if (modelId) {
      const hit = models.find((m) => m.toLowerCase() === modelId!.toLowerCase());
      if (!hit) {
        return `模型「${modelId}」不在【${provider.name}】下。\n可选：${models.slice(0, 8).join("、")}${models.length > 8 ? "…" : ""}`;
      }
      modelId = hit;
    } else {
      modelId = pickDefaultModel(this.db, provider.id, session.activeModelId);
    }
    session.activeProviderId = provider.id;
    session.activeModelId = modelId;
    session.activeConversationId = null;
    clearActiveMenu(session);
    session._modelPickerProviderId = undefined;
    return [
      `已设置 QQ 模型：【${provider.name}】${modelId}`,
      "对 chat / agent / plan 等所有模式生效。",
      "发「状态」可确认；发「模型 默认」恢复跟随桌面。"
    ].join("\n");
  }

  private clearSessionModel(session: ImSession): string {
    session.activeProviderId = null;
    session.activeModelId = null;
    session.activeConversationId = null;
    clearActiveMenu(session);
    return "已恢复：QQ 模型跟随桌面聊天窗口的选择。";
  }

  private setMode(session: ImSession, modeArg?: string): string {
    if (!modeArg) {
      setActiveMenu(session, "modes");
      const modes = CHANNEL_DEFAULT_MODE_IDS.map(
        (id, i) => `${i + 1}. ${CHAT_MODE_MAP[id]?.icon ?? ""} ${modeLabel(id)} (${id})`
      );
      const hint = CHANNEL_DEFAULT_MODE_IDS.map((_, i) => String(i + 1)).join(" / ");
      return [
        `【模式】`,
        modes.join("\n"),
        "",
        `推荐：模式 agent / 模式 3（不要只发数字，易与项目混淆）`,
        `也可在 10 分钟内回复序号：${hint}`,
        "不切换也可直接提问（默认 chat）"
      ].join("\n");
    }
    const id = modeArg.toLowerCase();
    if (!CHANNEL_DEFAULT_MODE_IDS.includes(id as (typeof CHANNEL_DEFAULT_MODE_IDS)[number])) {
      return `未知模式「${modeArg}」。可选：${CHANNEL_DEFAULT_MODE_IDS.join("、")}`;
    }
    session.activeModeId = id as ImSession["activeModeId"];
    session.activeConversationId = null;
    clearActiveMenu(session);
    const needsProject = id === "agent" || id === "plan" || id === "pipeline" || id === "review";
    if (needsProject && !session.activeProjectId) {
      return `已切换模式为【${modeLabel(id)}】，请先「选」一个项目。`;
    }
    if (id === "review") {
      return [
        `已切换模式为【${modeLabel(id)}】。`,
        "审查模式需在桌面端配置 diff 范围；QQ 上更适合发「模式 chat」提问，或「模式 agent」改代码。"
      ].join("\n");
    }
    if (id === "agent") {
      return [
        `已切换模式为【${modeLabel(id)}】。`,
        "可读写项目代码，耗时较长。",
        "普通问答请发「模式 chat」更快。",
        `当前模型：${this.sessionModelSummary(session)}（发「我的模型」可切换）`,
        "",
        this.formatReadyCard(session)
      ].join("\n");
    }
    return `已切换模式为【${modeLabel(id)}】。\n\n${this.formatReadyCard(session)}`;
  }

  private createConversation(session: ImSession, name: string): string {
    if (!session.activeProjectId) {
      return "请先选择项目（我的项目 → 选 N）。";
    }
    const conv = this.db.createConversation({
      projectId: session.activeProjectId,
      name,
      modeId: session.activeModeId
    });
    session.activeConversationId = conv.id;
    return `已创建并进入对话【${conv.name}】`;
  }

  private formatStatus(session: ImSession): string {
    const project = session.activeProjectId
      ? this.db.listProjects().find((p) => p.id === session.activeProjectId)
      : null;
    const conv =
      session.activeConversationId && session.activeProjectId
        ? this.db
            .listConversations(session.activeProjectId)
            .find((c) => c.id === session.activeConversationId)
        : null;
    const modelLine = diagnoseChannelModel(this.db, session)
      .split("\n")
      .find((l) => l.startsWith("QQ 可用："));
    return [
      "【当前状态】",
      `项目：${project?.name ?? "未选择"}`,
      `对话：${conv?.name ?? "未选择"}`,
      `模式：${modeLabel(session.activeModeId)}`,
      `模型：${this.sessionModelSummary(session)}`,
      modelLine ?? "",
      project?.path ? `路径：${project.path}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }
}

function isMeaninglessInput(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[.。．,，!！?？…·\s]+$/.test(t)) return true;
  if (t.length <= 2 && !/[\u4e00-\u9fff\w]/.test(t)) return true;
  return false;
}

function helpText(): string {
  return [
    "【Little Peanut · QQ】",
    "—— 三步就绪 ——",
    "1. 我的项目  2. 我的模型（可选）  3. 模式 agent",
    "",
    "—— 推荐指令（无歧义）——",
    "模式 agent · 模式 chat · 模式 3",
    "选 1 · 项目 1 · 模型 moonshot kimi-k2.6",
    "开始 · 状态 · 帮助",
    "",
    "—— 说明 ——",
    "· 纯数字仅在「刚看过列表」后 10 分钟内有效",
    "· 已选项目后发 3 会切到 plan（不再当成选第 3 个项目）",
    "· agent 下简短问答自动走 chat",
    "",
    "选好项目后直接提问即可。"
  ].join("\n");
}

function formatProjectLine(n: number, p: Project): string {
  return `${n}. ${p.name}${p.path ? ` (${p.path})` : ""}`;
}

function modeLabel(modeId: string): string {
  const m = CHAT_MODE_MAP[modeId as keyof typeof CHAT_MODE_MAP];
  return m ? `${m.icon} ${modeId}` : modeId;
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
