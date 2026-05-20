import { getQqAccessToken } from "./access.js";

const API_BASE = "https://api.sgroup.qq.com";
const SANDBOX_API_BASE = "https://sandbox.api.sgroup.qq.com";

function restBase(sandbox?: boolean): string {
  return sandbox ? SANDBOX_API_BASE : API_BASE;
}

export async function fetchQqGatewayUrl(
  appId: string,
  clientSecret: string,
  sandbox?: boolean
): Promise<string> {
  const accessToken = await getQqAccessToken(appId, clientSecret);
  const res = await fetch(`${restBase(sandbox)}/gateway/bot`, {
    headers: { Authorization: `QQBot ${accessToken}` }
  });
  const json = (await res.json()) as { url?: string; message?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.message || `获取 Gateway 失败 (${res.status})`);
  }
  return json.url;
}

export interface SendC2COptions {
  openid: string;
  content: string;
  msgId?: string;
  msgSeq?: number;
  appId: string;
  clientSecret: string;
  sandbox?: boolean;
}

/** 被动回复私聊（推荐，不计入每月 4 条主动消息额度）。 */
export async function sendC2CMessage(opts: SendC2COptions): Promise<void> {
  const accessToken = await getQqAccessToken(opts.appId, opts.clientSecret);
  const body: Record<string, unknown> = {
    content: opts.content.slice(0, 4000),
    msg_type: 0
  };
  if (opts.msgId) {
    body.msg_id = opts.msgId;
    body.msg_seq = opts.msgSeq ?? 1;
  }
  const res = await fetch(`${restBase(opts.sandbox)}/v2/users/${encodeURIComponent(opts.openid)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text) as { message?: string; code?: number };
      if (j.message) detail = `${j.message}${j.code != null ? ` (${j.code})` : ""}`;
    } catch {
      /* raw text */
    }
    console.error("[qq-bot] 发送私聊失败:", res.status, detail);
    throw new Error(detail || `发送私聊消息失败 (${res.status})`);
  }
}
