interface StatCardProps {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}

export default function StatCard({ label, value, valueColor }: StatCardProps) {
  return (
    <div
      className="flex-1 rounded-[var(--radius-main)] p-4"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold" style={{ color: valueColor ?? "var(--color-text)" }}>
        {value}
      </div>
    </div>
  );
}
