// Marks a feature that is built but not live yet (see src/config/features.ts).
export function SoonBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center rounded border border-accent/40 bg-accent/10 px-1 py-px font-mono text-[0.5625rem] font-extrabold uppercase leading-none tracking-wider text-accent ${className}`}>
      Soon
    </span>
  );
}
