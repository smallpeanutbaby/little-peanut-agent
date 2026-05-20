import type {

  ChannelBotConfig,

  ChannelBotKind,

  ChannelBotRuntimeStatus,

  ChannelBotTestResult

} from "@shared/channelBots.js";

import { CHANNEL_BOT_KINDS } from "@shared/channelBots.js";

import type { AppDatabase } from "../db/database.js";

import { QqBotConnector } from "./qq/connector.js";

import { clearQqAccessTokenCache } from "./qq/access.js";

import { fetchQqGatewayUrl } from "./qq/api.js";



class ChannelBotManager {

  private db: AppDatabase | null = null;

  private status = new Map<ChannelBotKind, ChannelBotRuntimeStatus>();

  private qq: QqBotConnector | null = null;



  init(database: AppDatabase): void {

    this.db = database;

    this.qq = new QqBotConnector(database);

    for (const id of CHANNEL_BOT_KINDS) {

      this.status.set(id, {

        id,

        running: false,

        connected: false,

        lastError: null,

        lastStartedAt: null

      });

    }

    this.applyAll();

  }



  applyAll(): void {

    if (!this.db) return;

    const configs = this.db.listChannelBots();

    for (const cfg of configs) {

      if (cfg.enabled) void this.start(cfg);

      else this.stop(cfg.id);

    }

  }



  applyOne(id: ChannelBotKind): void {

    if (!this.db) return;

    const cfg = this.db.getChannelBot(id);

    if (!cfg) return;

    if (cfg.enabled) void this.start(cfg);

    else this.stop(id);

  }



  private async start(cfg: ChannelBotConfig): Promise<void> {

    const st = this.status.get(cfg.id)!;

    st.running = true;

    st.lastStartedAt = Date.now();

    st.connected = false;

    st.lastError = null;



    if (!cfg.appId.trim()) {

      st.lastError = "缺少 App ID";

      return;

    }

    if (cfg.id === "qq") {

      if (!cfg.hasAppSecret) {

        st.lastError = "请填写 App Secret";

        return;

      }

      if (!cfg.hasToken) {

        st.lastError = "请填写 Bot Token（WebSocket 鉴权）";

        return;

      }

      try {

        await this.qq?.start(cfg);

        st.connected = true;

        st.lastError = null;

      } catch (e) {

        st.connected = false;

        st.lastError = (e as Error).message || "QQ 连接失败";

        console.error("[channel] qq start failed:", e);

      }

      return;

    }



    st.lastError = "该渠道连接器尚未实现";

  }



  private stop(id: ChannelBotKind): void {

    const st = this.status.get(id)!;

    if (id === "qq") {

      void this.qq?.stop();

    }

    st.running = false;

    st.connected = false;

    st.lastError = null;

    st.lastStartedAt = null;

    clearQqAccessTokenCache();

  }



  listStatus(): ChannelBotRuntimeStatus[] {

    return CHANNEL_BOT_KINDS.map((id) => this.status.get(id)!);

  }



  async testConfig(cfg: ChannelBotConfig): Promise<ChannelBotTestResult> {

    if (!cfg.appId.trim()) {

      return { ok: false, message: "请填写 App ID" };

    }

    if (cfg.id === "qq") {

      if (!cfg.hasAppSecret) {

        return { ok: false, message: "请填写 App Secret（用于 AccessToken）" };

      }

      if (!cfg.hasToken) {

        return { ok: false, message: "请填写 Bot Token（WebSocket 鉴权）" };

      }

      if (!this.db) return { ok: false, message: "数据库未就绪" };

      const creds = this.db.getChannelBotSecrets("qq");

      if (!creds?.appSecret || !creds.botToken) {

        return { ok: false, message: "凭证未保存完整" };

      }

      try {

        await fetchQqGatewayUrl(creds.appId, creds.appSecret, cfg.sandboxMode);

        return {

          ok: true,

          message: "凭证有效，Gateway 可达。保存并启用后将连接私聊 WebSocket。"

        };

      } catch (e) {

        return { ok: false, message: (e as Error).message };

      }

    }

    if (!cfg.hasAppSecret) {

      return { ok: false, message: "请填写 App Secret" };

    }

    return { ok: true, message: "配置项完整（连接器开发中）" };

  }

}



export const channelBotManager = new ChannelBotManager();


