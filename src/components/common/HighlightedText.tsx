export function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  if (!needle) return <>{text}</>;

  const haystack = text.toLocaleLowerCase("zh-CN");
  const index = haystack.indexOf(needle);
  if (index < 0) return <>{text}</>;

  const before = text.slice(0, index);
  const match = text.slice(index, index + needle.length);
  const after = text.slice(index + needle.length);

  return (
    <>
      {before}
      <mark>{match}</mark>
      {after}
    </>
  );
}
