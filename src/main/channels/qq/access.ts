/** QQ 开放平台 AccessToken（HTTPS OpenAPI 鉴权）。 */

export interface QqAccessToken {
  accessToken: string;
  expiresAt: number;
}

let cached: { appId: string; token: QqAccessToken } | null = null;

export async function getQqAccessToken(appId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (cached && cached.appId === appId && cached.token.expiresAt > now + 60_000) {
    return cached.token.accessToken;
  }
  const res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret })
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number | string;
    message?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.message || `获取 AccessToken 失败 (${res.status})`);
  }
  const expiresIn = Number(json.expires_in ?? 7200) * 1000;
  cached = {
    appId,
    token: { accessToken: json.access_token, expiresAt: now + expiresIn }
  };
  return json.access_token;
}

export function clearQqAccessTokenCache(): void {
  cached = null;
}
