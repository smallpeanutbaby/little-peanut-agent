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
