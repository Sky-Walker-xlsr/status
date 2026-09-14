interface StatusBadgeProps {
  healthy: boolean;
  healthyLabel?: string;
  unhealthyLabel?: string;
}

export default function StatusBadge({ healthy, healthyLabel = "Healthy", unhealthyLabel = "Unhealthy" }: StatusBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: healthy ? "var(--color-success-bg)" : "var(--color-danger-bg)",
        color: healthy ? "var(--color-success)" : "var(--color-danger-text)",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: healthy ? "var(--color-success)" : "var(--color-danger-text)" }}
      />
      {healthy ? healthyLabel : unhealthyLabel}
    </span>
  );
}
