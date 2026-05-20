/** Open https links in the system browser (Electron) with fallbacks. */
export async function openExternalUrl(
  url: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!url.startsWith("http:") && !url.startsWith("https:")) {
    return { ok: false, message: "无效链接" };
  }
  try {
    const api = window.electronAPI;
    if (api?.openExternal) {
      await api.openExternal(url);
      return { ok: true };
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message || "打开失败" };
  }
  // Do not use window.open — in Electron it can spawn an empty child window.
  return {
    ok: false,
    message: `无法打开浏览器，请手动访问：${url}`
  };
}
