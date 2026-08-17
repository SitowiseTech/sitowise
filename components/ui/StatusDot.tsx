/**
 * Small state indicator. Always paired with a text label when it carries
 * meaning, because colour alone is not a status anyone can read.
 */

export type StatusTone = "live" | "pending" | "error" | "idle";

export type StatusDotProps = {
  tone?: StatusTone;
  label?: string;
  className?: string;
};

const TONE = {
  live: "bg-green ring-green/20",
  pending: "bg-orange ring-orange/20",
  error: "bg-red ring-red/20",
  idle: "bg-faint ring-faint/20",
} as const;

export function StatusDot({tone = "idle", label, className}: StatusDotProps) {
  const dot = (
    <span
      aria-hidden="true"
      className={`inline-block size-[5px] shrink-0 rounded-full ring-2 ${TONE[tone]}`}
    />
  );

  if (!label) {
    return <span className={className}>{dot}</span>;
  }

  return (
    <span
      className={["inline-flex items-center gap-[7px] mono-label", className]
        .filter(Boolean)
        .join(" ")}
    >
      {dot}
      {label}
    </span>
  );
}
