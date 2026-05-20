import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../main/db/database.js";
import { runMigrations, CURRENT_SCHEMA_VERSION } from "../main/db/migrations.js";
import {
  IM_MENU_TTL_MS,
  hydrateMenuFromDb,
  loadImSession,
  saveImSession,
  setActiveMenu,
  type ImSession
} from "../main/channels/session.js";
import { ChannelOrchestrator } from "../main/channels/orchestrator.js";
import type { ChannelBotConfig } from "../shared/channelBots.js";

const emptyCfg: ChannelBotConfig = {
  id: "qq",
  enabled: true,
  appId: "",
  hasAppSecret: false,
  hasToken: false,
  allowFrom: [],
  defaultModeId: "chat",
  defaultProjectId: null,
  sandboxMode: false,
  createdAt: 0,
  updatedAt: 0
};

describe("channel_im_session menu persistence", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
  });

  afterEach(() => {
    db.close();
  });

  it("migration v11 adds last_menu columns", () => {
    const cols = (db.prepare("PRAGMA table_info(channel_im_session)").all() as Array<{ name: string }>).map(
      (r) => r.name
    );
    expect(cols).toEqual(expect.arrayContaining(["last_menu", "last_menu_at"]));
  });
});

describe("session load/save menu", () => {
  let tmpRoot: string;
  let dbFile: string;
  let appDb: AppDatabase;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "channel-session-"));
    dbFile = path.join(tmpRoot, "test.db");
    appDb = new AppDatabase(dbFile);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("persists last_menu across loadImSession", () => {
    const session: ImSession = {
      channel: "qq",
      peerId: "user-1",
      activeProjectId: projectId,
      activeConversationId: null,
      activeModeId: "chat",
      activeProviderId: null,
      activeModelId: null,
      replySeq: {}
    };
    setActiveMenu(session, "modes");
    saveImSession(appDb, session);

    const loaded = loadImSession(appDb, "qq", "user-1");
    expect(loaded._lastMenu).toBe("modes");
    expect(loaded._lastMenuAt).toBeTruthy();
  });

  it("expires menu after TTL", () => {
    const session: ImSession = {
      channel: "qq",
      peerId: "user-2",
      activeProjectId: null,
      activeConversationId: null,
      activeModeId: "chat",
      activeProviderId: null,
      activeModelId: null,
      replySeq: {}
    };
    const staleAt = Date.now() - IM_MENU_TTL_MS - 1;
    hydrateMenuFromDb(session, "modes", staleAt);
    expect(session._lastMenu).toBeUndefined();
  });
});

describe("ChannelOrchestrator dispatch", () => {
  let tmpRoot: string;
  let appDb: AppDatabase;
  let orchestrator: ChannelOrchestrator;
  let projectId: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "channel-orch-"));
    appDb = new AppDatabase(path.join(tmpRoot, "test.db"));
    projectId = appDb.createProject({ name: "OpsAdminApi", path: "F:\\OpsAdminApi" }).id;
    appDb.saveProviderConfig({
      id: "moonshot",
      name: "Moonshot",
      apiKey: "sk-test",
      baseUrl: "https://api.moonshot.cn/v1",
      enabled: true,
      protocol: "openai-chat",
      isCustom: false
    });
    orchestrator = new ChannelOrchestrator(appDb);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  type OrchPrivate = { dispatch: (cfg: ChannelBotConfig, s: ImSession, t: string) => Promise<string | null> };

  async function dispatch(peerId: string, text: string, base?: Partial<ImSession>) {
    const session: ImSession = {
      channel: "qq",
      peerId,
      activeProjectId: projectId,
      activeConversationId: null,
      activeModeId: "chat",
      activeProviderId: null,
      activeModelId: null,
      replySeq: {},
      ...base
    };
    return (orchestrator as unknown as OrchPrivate).dispatch(emptyCfg, session, text);
  }

  it("模式 3 selects plan without last_menu", async () => {
    const out = await dispatch("u1", "模式 3");
    expect(out).toContain("plan");
    expect(out).not.toContain("无效序号");
    expect(out).not.toContain("共 1 个项目");
  });

  it("bare digit 3 selects plan when project already active", async () => {
    const out = await dispatch("u2", "3");
    expect(out).toContain("plan");
  });

  it("persists modes menu: 模式 then 3 on reload", async () => {
    const peer = "openid-persist";
    const session1: ImSession = {
      channel: "qq",
      peerId: peer,
      activeProjectId: projectId,
      activeConversationId: null,
      activeModeId: "chat",
      activeProviderId: null,
      activeModelId: null,
      replySeq: {}
    };
    const out1 = await (orchestrator as unknown as OrchPrivate).dispatch(emptyCfg, session1, "模式");
    expect(out1).toContain("【模式】");
    saveImSession(appDb, session1);

    const session2 = loadImSession(appDb, "qq", peer);
    expect(session2._lastMenu).toBe("modes");
    const out2 = await (orchestrator as unknown as OrchPrivate).dispatch(emptyCfg, session2, "3");
    expect(out2).toContain("plan");
  });

  it("agent bare word switches mode", async () => {
    const out = await dispatch("u3", "agent");
    expect(out).toContain("agent");
  });
});
