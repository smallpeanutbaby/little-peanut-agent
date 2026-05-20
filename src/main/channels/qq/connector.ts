import type { ChannelBotConfig } from "@shared/channelBots.js";
import type { AppDatabase } from "../../db/database.js";
import { ChannelOrchestrator } from "../orchestrator.js";
import { QqGateway } from "./gateway.js";
import { clearQqAccessTokenCache } from "./access.js";

export class QqBotConnector {
  private gateway: QqGateway | null = null;
  private readonly orchestrator: ChannelOrchestrator;

  constructor(private readonly db: AppDatabase) {
    this.orchestrator = new ChannelOrchestrator(db);
  }

  async start(cfg: ChannelBotConfig): Promise<void> {
    await this.stop();
    const creds = this.db.getChannelBotSecrets("qq");
    if (!creds) throw new Error("QQ 配置不完整");
    if (!creds.botToken.trim()) {
      throw new Error("请填写 Bot Token（开放平台机器人令牌，用于 WebSocket Bot {appId}.{token}）");
    }
    clearQqAccessTokenCache();

    const gateway = new QqGateway({
      appId: creds.appId,
      clientSecret: creds.appSecret,
      botToken: creds.botToken,
      sandbox: cfg.sandboxMode,
      onC2CMessage: (msg) => {
        void this.orchestrator
          .handleQqMessage(cfg, { appId: creds.appId, appSecret: creds.appSecret }, msg)
          .catch((e) => console.error("[qq-bot] handle message:", e));
      },
      onError: (e) => console.error("[qq-bot] gateway:", e.message),
      onReady: () => console.info("[qq-bot] READY — 私聊已就绪")
    });

    await gateway.start();
    this.gateway = gateway;
  }

  async stop(): Promise<void> {
    this.gateway?.stop();
    this.gateway = null;
    clearQqAccessTokenCache();
  }
}
