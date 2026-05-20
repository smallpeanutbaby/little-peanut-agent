import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppDatabase } from "./db/database.js";
import { cancelAllStreamsForWindow, registerIpc } from "./ipc/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "../../resources/icon.png");

// Process-wide error handlers — without these, an async failure in the main
// process (e.g. a native module ABI mismatch when opening better-sqlite3) is
// silently swallowed by Electron, the main process stays alive doing nothing,
// and the user just sees "no window". With these, the real error shows up in
// the dev-server terminal where it belongs.
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: "Little Peanut",
    backgroundColor: "#0a0a0a",
    icon: process.platform === "win32" || process.platform === "linux" ? appIconPath : undefined,
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform !== "darwin" ? { color: "#0a0a0a", symbolColor: "#cccccc", height: 36 } : undefined,
    autoHideMenuBar: process.platform === "win32",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const loadRenderer = () => {
    if (!mainWindow) return;
    if (devUrl) {
      void mainWindow.loadURL(devUrl);
    } else {
      void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
    }
  };
  loadRenderer();

  if (devUrl && process.env.LP_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[main] render-process-gone:", details);
  });
  mainWindow.webContents.on("preload-error", (_e, preloadPath, error) => {
    console.error("[main] preload-error:", preloadPath, error);
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      // -3 = ERR_ABORTED (navigation cancelled); ignore.
      if (errorCode === -3) return;
      console.error("[main] did-fail-load:", errorCode, errorDescription, validatedURL);
      if (!mainWindow) return;
      const html = `<!DOCTYPE html><html><body style="margin:0;background:#0a0a0a;color:#e8e8e8;font:14px/1.6 system-ui;padding:32px">
<h1 style="margin:0 0 12px;font-size:20px">界面加载失败</h1>
<p>无法打开：<code>${validatedURL}</code></p>
<p>${errorDescription} (${errorCode})</p>
<p style="color:#aaa">开发模式常见原因：5173 端口被旧进程占用，Vite 换到 5174 但 Electron 仍访问 5173。</p>
<p>请关闭所有 Little Peanut / 终端里的 <code>npm run dev</code>，再重新运行。</p>
</body></html>`;
      event.preventDefault();
      void mainWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
      );
    }
  );

  // Never spawn blank child Electron windows (window.open / target=_blank).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // When the window goes away, abort any in-flight chat streams so we don't
  // burn API tokens (or leak fetch handles) on output nobody will see.
  mainWindow.on("closed", () => {
    if (mainWindow) cancelAllStreamsForWindow(mainWindow);
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const database = new AppDatabase(
    path.join(app.getPath("userData"), "little-peanut.db")
  );
  database.setValue("booted", "true");

  registerIpc(
    {
      name: "Little Peanut",
      version: app.getVersion(),
      platform: process.platform
    },
    database
  );
  // Channel bot manager is initialized inside registerIpc.

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((err) => {
  // Keep this — `app.whenReady()` rejections used to crash silently.
  console.error("[main] whenReady chain failed:", err?.stack || err);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
