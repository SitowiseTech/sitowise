/** Loading placeholder. `.skeleton` in globals.css owns the shimmer. */

export type SkeletonProps = {
  className?: string;
};

export function Skeleton({className}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton block ${className ?? "h-4 w-24"}`}
    />
  );
}

export type SkeletonTextProps = {
  lines?: number;
  className?: string;
};

/** A paragraph-shaped stack. The last line is short so it reads as text. */
export function SkeletonText({lines = 3, className}: SkeletonTextProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`flex flex-col gap-2 ${className ?? ""}`}
    >
      {Array.from({length: lines}, (_, i) => (
        <Skeleton
          key={i}
          className={i === lines - 1 ? "h-3.5 w-2/5" : "h-3.5 w-full"}
        />
      ))}
    </span>
  );
}
