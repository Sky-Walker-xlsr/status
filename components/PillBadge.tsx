interface PillBadgeProps {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}

export default function PillBadge({ label, value, tone = "neutral" }: PillBadgeProps) {
  const color =
    tone === "success" ? "var(--color-success)" : tone === "danger" ? "var(--color-danger-text)" : "var(--color-text)";

  return (
    <div
      className="flex flex-col items-center gap-1 rounded-[var(--radius-main)] px-3 py-2 text-center"
      style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
    >
      <span className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </span>
      <span className="text-sm font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
