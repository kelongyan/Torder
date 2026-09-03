import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist/**",
      "dist-*",
      "dist-*/**",
      "dist-ssr",
      "dist-ssr/**",
      "node_modules",
      "src-tauri/target",
      "src-tauri/target-cv",
      "src-tauri/gen/**",
      ".playwright-cli/**",
      ".playwright-mcp/**",
      // P1-01：以下目录不属于产品源码，禁止纳入 lint 扫描——
      // .workbuddy/tmp 为本机会话数据（曾混入 Chrome profile 扩展代码，
      // 产生数千条无关错误）；设计稿为渲染资料（其脚本如需质量检查，
      // 应单独配置浏览器环境与独立命令，见优化方案 P1-01）。
      ".workbuddy/**",
      "tmp/**",
      "设计稿/**",
      "docx/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
