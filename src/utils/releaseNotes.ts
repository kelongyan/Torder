/**
 * 发布说明（Release notes）的极简 Markdown 解析器。
 *
 * 背景：`updateInfo.notes` 直接取自 GitHub / Gitee Release body，是原始
 * Markdown。此前 UI 只是按 `\n` 切行塞进 `<p>`，导致 `###`、`**` 等标记
 * 原样显示。引入 react-markdown 会带进一整棵 remark/rehype 依赖树，且渲染
 * 远程内容需要额外做 HTML 清洗；这里改成自研解析器 + React 元素映射，
 * 全程不产生 HTML 字符串，天然无注入面。
 *
 * 只支持实际发布说明用到的子集：`#`~`###` 标题、`**粗体**`、`` `行内代码` ``、
 * `[文字](http(s) 链接)`、`-` / `* / `1.` 列表、`---` 分割线、段落。
 * 未支持的语法（表格、引用块等）按纯文本输出 —— 降级但不破版。
 */

export type ReleaseInline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type ReleaseNoteBlock =
  | { kind: "heading"; level: 1 | 2 | 3; inlines: ReleaseInline[] }
  | { kind: "paragraph"; inlines: ReleaseInline[] }
  | { kind: "list"; items: ReleaseInline[][] }
  | { kind: "divider" };

// 行内标记按优先级匹配：行内代码 > 粗体 > 链接。
// 各自的字符集都排除换行，避免跨行误吞导致整段被吞掉。
const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]*\]\([^)\n]*\))/g;
const LINK_DETAIL_PATTERN = /^\[([^\]\n]*)\]\(([^)\n]*)\)$/;
// 只放行 http(s)：Release body 是远程内容，绝不能把 file:// 或自定义
// scheme 交给渲染层的 <a href>。
const SAFE_LINK_PATTERN = /^https?:\/\/\S+$/i;

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const DIVIDER_PATTERN = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET_PATTERN = /^\s*[-*+]\s+(.*)$/;
const ORDERED_PATTERN = /^\s*\d+[.)]\s+(.*)$/;

export function parseReleaseNotes(markdown: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: ReleaseInline[][] | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join("\n").trim();
    paragraphLines = [];
    if (text) {
      blocks.push({ kind: "paragraph", inlines: tokenizeInline(text) });
    }
  };

  const flushList = () => {
    if (!listItems) return;
    blocks.push({ kind: "list", items: listItems });
    listItems = null;
  };

  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (DIVIDER_PATTERN.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "divider" });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        // 4 级及更深的标题统一压到 3 级：发布说明里再深的层级也没有视觉意义。
        level: Math.min(heading[1]?.length ?? 1, 3) as 1 | 2 | 3,
        inlines: tokenizeInline((heading[2] ?? "").trim()),
      });
      continue;
    }

    const item = BULLET_PATTERN.exec(line) ?? ORDERED_PATTERN.exec(line);
    if (item) {
      flushParagraph();
      if (!listItems) listItems = [];
      listItems.push(tokenizeInline((item[1] ?? "").trim()));
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function tokenizeInline(text: string): ReleaseInline[] {
  const nodes: ReleaseInline[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      pushText(nodes, text.slice(cursor, start));
    }
    const [raw, code, strong, link] = match;

    if (code) {
      nodes.push({ type: "code", value: code.slice(1, -1).trim() });
    } else if (strong) {
      nodes.push({ type: "strong", value: strong.slice(2, -2) });
    } else if (link) {
      const detail = LINK_DETAIL_PATTERN.exec(link);
      const href = (detail?.[2] ?? "").trim();
      // 非 http(s) 的链接不建 <a>，原样当文本显示。
      if (detail && SAFE_LINK_PATTERN.test(href)) {
        nodes.push({ type: "link", value: (detail[1] ?? "").trim() || href, href });
      } else {
        pushText(nodes, raw);
      }
    }

    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    pushText(nodes, text.slice(cursor));
  }
  return nodes;
}

function pushText(nodes: ReleaseInline[], value: string): void {
  if (!value) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    last.value += value;
    return;
  }
  nodes.push({ type: "text", value });
}
