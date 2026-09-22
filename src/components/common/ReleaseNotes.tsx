import { parseReleaseNotes, type ReleaseInline } from "../../utils/releaseNotes";

/**
 * 把 Release notes 的 Markdown 渲染为 React 元素。
 *
 * 输出全程是 React 子元素，不拼 HTML、不用 dangerouslySetInnerHTML——
 * Release body 是远程内容，渲染层必须保持零注入面。
 *
 * 标题用 h4/h5 而不是 h1~h3：本组件出现在对话框与设置面板内部，
 * 用 h1~h3 会打乱页面既有的标题层级，视觉层级交给 class 控制。
 */
export function ReleaseNotes({
  markdown,
  className = "",
}: {
  markdown: string;
  className?: string;
}) {
  const blocks = parseReleaseNotes(markdown);
  if (blocks.length === 0) return null;

  return (
    <div className={`release-notes ${className}`.trim()}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const Tag = block.level === 1 ? "h4" : "h5";
            return (
              <Tag key={index} className={`release-notes-h level-${block.level}`}>
                {renderInlines(block.inlines)}
              </Tag>
            );
          }
          case "list":
            return (
              <ul key={index} className="release-notes-list">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInlines(item)}</li>
                ))}
              </ul>
            );
          case "divider":
            return <hr key={index} className="release-notes-divider" />;
          default:
            return (
              <p key={index} className="release-notes-p">
                {renderInlines(block.inlines)}
              </p>
            );
        }
      })}
    </div>
  );
}

function renderInlines(inlines: ReleaseInline[]) {
  return inlines.map((inline, index) => {
    switch (inline.type) {
      case "code":
        return <code key={index}>{inline.value}</code>;
      case "strong":
        return <strong key={index}>{inline.value}</strong>;
      case "link":
        return (
          <a
            key={index}
            href={inline.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {inline.value}
          </a>
        );
      default:
        return inline.value;
    }
  });
}
