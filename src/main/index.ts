import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppDatabase } from "./db/database";
import { cancelAllStreamsForWindow, registerIpc } from "./ipc/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: "Little Peanut",
    backgroundColor: "#0a0a0a",
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    // DevTools is opt-in even in dev. Set LP_OPEN_DEVTOOLS=1 to auto-open,
    // or just press F12 / Ctrl+Shift+I in the running window.
    if (process.env.LP_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[main] render-process-gone:", details);
  });
  mainWindow.webContents.on("preload-error", (_e, preloadPath, error) => {
    console.error("[main] preload-error:", preloadPath, error);
  });
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    console.error("[main] did-fail-load:", errorCode, errorDescription, validatedURL);
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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
