import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": path.join(__dirname, "shared")
      }
    },
    build: {
      lib: {
        entry: path.join(__dirname, "main/index.ts")
      },
      outDir: "dist-electron/main"
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": path.join(__dirname, "shared")
      }
    },
    build: {
      lib: {
        entry: path.join(__dirname, "preload/index.ts"),
        formats: ["cjs"],
        fileName: () => "index"
      },
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.cjs"
        }
      },
      outDir: "dist-electron/preload"
    }
  },
  renderer: {
    root: path.join(__dirname, "renderer"),
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // If 5173 is taken, fail loudly instead of moving to 5174 while Electron
      // still loads 5173 — that produces a blank #0a0a0a window with no UI.
      strictPort: true
    },
    resolve: {
      alias: {
        "@renderer": path.join(__dirname, "renderer/src"),
        "@shared": path.join(__dirname, "shared")
      }
    },
    build: {
      outDir: path.join(__dirname, "dist"),
      rollupOptions: {
        input: path.join(__dirname, "renderer/index.html")
      }
    }
  }
});
