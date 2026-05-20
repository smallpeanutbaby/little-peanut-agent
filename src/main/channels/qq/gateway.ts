import { getQqAccessToken } from "./access.js";
import { fetchQqGatewayUrl } from "./api.js";
import { describeGatewayClose } from "./gatewayErrors.js";

/** 单聊消息 + 就绪等基础事件 */
export const QQ_INTENT_C2C = 1 << 25;

type GatewayPayload = {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
};

export type C2CMessageHandler = (msg: {
  openid: string;
  content: string;
  msgId: string;
}) => void;

export interface QqGatewayOptions {
  appId: string;
  clientSecret: string;
  botToken: string;
  sandbox?: boolean;
  intents?: number;
  onC2CMessage: C2CMessageHandler;
  onError?: (err: Error) => void;
  onReady?: () => void;
}

/**
 * QQ 官方 Bot WebSocket（私聊 C2C_MESSAGE_CREATE）。
 * 鉴权依次尝试：QQBot AccessToken（API v2 文档）→ Bot {appId}.{botToken}（接入指南）。
 */
export class QqGateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeq: number | null = null;
  private stopped = false;

  constructor(private readonly opts: QqGatewayOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    const sandbox = !!this.opts.sandbox;
    const url = await fetchQqGatewayUrl(
      this.opts.appId,
      this.opts.clientSecret,
      sandbox
    );
    const accessToken = await getQqAccessToken(this.opts.appId, this.opts.clientSecret);
    const botToken = this.opts.botToken.trim();
    const candidates: { label: string; token: string }[] = [
      { label: "QQBot AccessToken", token: `QQBot ${accessToken}` },
      { label: "Bot appId.token", token: `Bot ${this.opts.appId}.${botToken}` }
    ];

    console.info("[qq-bot] 连接 Gateway", url, sandbox ? "(沙箱)" : "(正式)");

    let lastErr: Error | null = null;
    for (const c of candidates) {
      if (this.stopped) break;
      try {
        await this.connectOnce(url, c.token, sandbox);
        console.info("[qq-bot] 鉴权成功:", c.label);
        return;
      } catch (e) {
        lastErr = e as Error;
        console.warn("[qq-bot] 鉴权失败:", c.label, lastErr.message);
        this.resetSocket();
      }
    }
    throw lastErr ?? new Error("WebSocket 鉴权失败");
  }

  stop(): void {
    this.stopped = true;
    this.resetSocket();
  }

  private resetSocket(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private connectOnce(url: string, identifyToken: string, sandbox: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let identified = false;
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.opts.onError?.(err);
        reject(err);
      };

      ws.onopen = () => {
        /* wait for Hello */
      };

      ws.onmessage = (ev) => {
        try {
          const payload = JSON.parse(String(ev.data)) as GatewayPayload;
          if (typeof payload.s === "number") this.lastSeq = payload.s;

          if (payload.op === 10) {
            const interval =
              (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 45000;
            this.startHeartbeat(ws, interval);
            ws.send(
              JSON.stringify({
                op: 2,
                d: {
                  token: identifyToken,
                  intents: this.opts.intents ?? QQ_INTENT_C2C,
                  shard: [0, 1],
                  properties: {
                    $os: process.platform,
                    $browser: "little-peanut",
                    $device: "little-peanut"
                  }
                }
              })
            );
            return;
          }

          if (payload.op === 0 && payload.t === "READY") {
            identified = true;
            if (!settled) {
              settled = true;
              this.opts.onReady?.();
              resolve();
            }
            return;
          }

          if (payload.op === 0 && payload.t === "C2C_MESSAGE_CREATE") {
            const d = payload.d as {
              id?: string;
              content?: string;
              author?: { user_openid?: string };
            };
            const openid = d.author?.user_openid;
            if (openid && d.id) {
              console.info(
                "[qq-bot] 收到私聊",
                openid,
                String(d.content ?? "").slice(0, 60)
              );
              void this.opts.onC2CMessage({
                openid,
                content: d.content ?? "",
                msgId: d.id
              });
            }
            return;
          }

          if (payload.op === 9) {
            const d = payload.d as { resumable?: boolean } | undefined;
            console.error("[qq-bot] Invalid Session (op 9), resumable=", d?.resumable);
            /* 具体原因通常在随后的 close 帧 code 里 */
          }
        } catch (e) {
          this.opts.onError?.(e as Error);
        }
      };

      ws.onerror = () => {
        if (!identified) fail(new Error("QQ WebSocket 网络错误"));
      };

      ws.onclose = (ev) => {
        this.clearHeartbeat();
        if (!identified && !settled) {
          fail(new Error(describeGatewayClose(ev.code, ev.reason, sandbox)));
        }
      };
    });
  }

  private startHeartbeat(ws: WebSocket, intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 1, d: this.lastSeq }));
      }
    }, intervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
