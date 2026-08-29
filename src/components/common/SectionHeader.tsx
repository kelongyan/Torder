const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function SectionHeader({
  label,
  progress,
}: {
  label: string;
  progress?: { done: number; total: number };
}) {
  const ratio =
    progress && progress.total > 0
      ? Math.min(1, progress.done / progress.total)
      : 0;

  return (
    <div className="section-header">
      <span className="section-header-label">{label}</span>
      {progress && (
        <span
          className="section-progress"
          title={`已完成 ${progress.done}/${progress.total}`}
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
            focusable="false"
          >
            <circle
              className="section-progress-track"
              cx="8"
              cy="8"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="2"
            />
            <circle
              className="section-progress-fill"
              cx="8"
              cy="8"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - ratio)}
              transform="rotate(-90 8 8)"
            />
          </svg>
          {progress.done}/{progress.total}
        </span>
      )}
    </div>
  );
}
