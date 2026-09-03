/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // dist 由构建脚本在 build 前清理,避免 vite 清空目录时触发
    // WorkBuddy 注入的 genie-safe-delete shim(其 genie-trash 会超时)
    emptyOutDir: false,
  },

  // P1-04：前端单测入口。纯函数层（services/utils）用 node 环境即可；
  // UI 组件测试与 E2E 属后续批次，届时再引入 jsdom/playwright 环境。
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
