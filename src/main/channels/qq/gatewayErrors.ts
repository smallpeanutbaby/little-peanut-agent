/** Map QQ gateway WebSocket close codes to actionable UI copy. */

export function describeGatewayClose(code: number, reason: string, sandbox: boolean): string {
  const r = reason?.trim();
  const known: Record<number, string> = {
    4013: "订阅的 intents 无效。",
    4014:
      "没有「单聊 / C2C」事件权限。请到 QQ 开放平台 → 机器人 → 能力/权限 中开通「用户私聊」或 GROUP_AND_C2C 相关能力后再试。",
    4914: sandbox
      ? "当前已是沙箱连接仍失败，请核对 AppID、AppSecret、Bot Token 是否与开放平台一致。"
      : "该机器人只允许连接沙箱环境：请在设置里勾选「沙箱模式」后保存并重启渠道。",
    4915: "机器人已被封禁，请到开放平台申请解封。",
    4008: "发送过快，请稍后点击「重启渠道」。"
  };
  if (known[code]) return known[code] + (r ? `（${r}）` : "");
  if (code === 4004 || code === 1006) {
    return (
      "WebSocket 鉴权失败。请确认 Bot Token 填的是开放平台「机器人令牌」，不是 AppSecret；" +
      (sandbox ? "若机器人为正式环境，请关闭沙箱模式。" : "若平台提示仅沙箱可用，请开启沙箱模式。") +
      (r ? ` 详情：${r}` : "")
    );
  }
  if (code > 0) {
    return `WebSocket 关闭 (${code})${r ? `：${r}` : ""}`;
  }
  return (
    "WebSocket 鉴权失败。请核对：① Bot Token ≠ AppSecret；② 沙箱模式是否与开放平台环境一致；③ 是否已开通私聊/C2C 能力。" +
    (r ? ` 详情：${r}` : "")
  );
}
