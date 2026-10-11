import { defineConfig } from "vite";

// Tauri expects a fixed port and doesn't want the screen cleared.
export default defineConfig({
  clearScreen: false,
  base: "./",
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "safari15",
    sourcemap: false,
    outDir: "dist",
  },
});
