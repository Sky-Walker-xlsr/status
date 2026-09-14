import type { StatusEvent } from "@/lib/types";
import { formatAbsoluteTime, formatDuration, formatRelativeTime } from "@/lib/format";

interface EventsListProps {
  events: StatusEvent[];
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function describeEvent(event: StatusEvent): string {
  if (event.type === "initial") return "Monitoring started";
  if (event.type === "became_healthy") {
    return event.duration_seconds !== null
      ? `Endpoint became healthy after being unhealthy for ${formatDuration(event.duration_seconds)}`
      : "Endpoint became healthy";
  }
  return "Endpoint became unhealthy";
}

export default function EventsList({ events }: EventsListProps) {
  if (events.length === 0) {
    return <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>No events recorded yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => {
        const isDown = event.type === "became_unhealthy";
        const color = isDown ? "var(--color-danger-text)" : "var(--color-success)";

        return (
          <li
            key={event.id}
            className="flex items-center gap-3 rounded-[var(--radius-main)] px-3 py-2.5"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ background: isDown ? "var(--color-danger-bg)" : "var(--color-success-bg)", color }}
            >
              {event.type === "initial" ? null : isDown ? <ArrowDownIcon /> : <ArrowUpIcon />}
            </span>
            <div className="flex flex-1 flex-col">
              <span className="text-sm" style={{ color: "var(--color-text)" }}>
                {describeEvent(event)}
              </span>
              <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {formatAbsoluteTime(event.occurred_at)} · {formatRelativeTime(event.occurred_at)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
