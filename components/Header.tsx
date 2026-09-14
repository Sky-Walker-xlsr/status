function PulseIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 8-5-16-3 8H2" />
    </svg>
  );
}

export default function Header() {
  return (
    <div className="flex items-center gap-3">
      <PulseIcon />
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
          Health Dashboard
        </h1>
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          Live status and uptime for monitored endpoints
        </p>
      </div>
    </div>
  );
}
