import { describe, expect, it } from "vitest";
import { parseReleaseNotes } from "./releaseNotes";

describe("parseReleaseNotes", () => {
  it("解析 1~3 级标题，更深的层级压到 3 级", () => {
    const blocks = parseReleaseNotes("# 一级\n## 二级\n### 三级\n##### 五级");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, inlines: [{ type: "text", value: "一级" }] },
      { kind: "heading", level: 2, inlines: [{ type: "text", value: "二级" }] },
      { kind: "heading", level: 3, inlines: [{ type: "text", value: "三级" }] },
      { kind: "heading", level: 3, inlines: [{ type: "text", value: "五级" }] },
    ]);
  });

  it("合并连续的列表项为一个 list 块", () => {
    const blocks = parseReleaseNotes("- 第一条\n- 第二条\n\n- 新的一段");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "list",
      items: [
        [{ type: "text", value: "第一条" }],
        [{ type: "text", value: "第二条" }],
      ],
    });
  });

  it("有序列表与无序列表同样识别", () => {
    const blocks = parseReleaseNotes("1. 首先\n2. 然后");
    expect(blocks[0]).toEqual({
      kind: "list",
      items: [
        [{ type: "text", value: "首先" }],
        [{ type: "text", value: "然后" }],
      ],
    });
  });

  it("识别分割线并作为块分隔", () => {
    const blocks = parseReleaseNotes("前段\n---\n后段");
    expect(blocks).toEqual([
      { kind: "paragraph", inlines: [{ type: "text", value: "前段" }] },
      { kind: "divider" },
      { kind: "paragraph", inlines: [{ type: "text", value: "后段" }] },
    ]);
  });

  it("行内解析粗体、行内代码与链接", () => {
    const blocks = parseReleaseNotes(
      "打开软件后**直接弹出更新窗口**，见 `App.tsx` 与[发布页](https://example.com/r)。",
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      inlines: [
        { type: "text", value: "打开软件后" },
        { type: "strong", value: "直接弹出更新窗口" },
        { type: "text", value: "，见 " },
        { type: "code", value: "App.tsx" },
        { type: "text", value: " 与" },
        {
          type: "link",
          value: "发布页",
          href: "https://example.com/r",
        },
        { type: "text", value: "。" },
      ],
    });
  });

  it("非 http(s) 的链接降级为纯文本，不生成 href", () => {
    const blocks = parseReleaseNotes(
      "[点我](file:///C:/evil.exe) 与 [正常](http://example.com)",
    );
    const inlines = (blocks[0] as { inlines: unknown[] }).inlines;
    expect(inlines).toEqual([
      { type: "text", value: "[点我](file:///C:/evil.exe) 与 " },
      { type: "link", value: "正常", href: "http://example.com" },
    ]);
  });

  it("未闭合的粗体标记按字面文本输出，不吞字符", () => {
    const blocks = parseReleaseNotes("这里有 **未闭合的加粗");
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      inlines: [{ type: "text", value: "这里有 **未闭合的加粗" }],
    });
  });

  it("标题里可以包含行内标记", () => {
    const blocks = parseReleaseNotes("### 🚀 **新版本**自动更新提示");
    expect(blocks[0]).toEqual({
      kind: "heading",
      level: 3,
      inlines: [
        { type: "text", value: "🚀 " },
        { type: "strong", value: "新版本" },
        { type: "text", value: "自动更新提示" },
      ],
    });
  });

  it("段落内的软换行保留（交由 CSS pre-wrap 呈现）", () => {
    const blocks = parseReleaseNotes("第一行\n第二行");
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      inlines: [{ type: "text", value: "第一行\n第二行" }],
    });
  });

  it("空输入与纯空白返回空数组", () => {
    expect(parseReleaseNotes("")).toEqual([]);
    expect(parseReleaseNotes("   \n\n  ")).toEqual([]);
  });

  it("不支持的表格语法按纯文本降级，不抛错", () => {
    const blocks = parseReleaseNotes(
      "| 文件名 | 平台 |\n| :--- | :--- |\n| a.exe | Windows |",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("处理真实发布说明：标题、列表、分割线混合且不丢内容", () => {
    const notes = `## 🚀 新版本自动更新提示

打开软件后若检测到新版本，将**直接弹出更新窗口**。

- 启动 3 秒后静默检查更新。
- 弹窗内可直接下载安装包。

---

### 免打扰策略

- **当天**再次启动不再弹出；
- **次日**启动若仍未升级，会重新提醒。`;
    const blocks = parseReleaseNotes(notes);
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "divider",
      "heading",
      "list",
    ]);
    expect(blocks[2]).toEqual({
      kind: "list",
      items: [
        [{ type: "text", value: "启动 3 秒后静默检查更新。" }],
        [{ type: "text", value: "弹窗内可直接下载安装包。" }],
      ],
    });
  });
});
