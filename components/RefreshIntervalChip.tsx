"use client";

import { useState } from "react";

const OPTIONS = [
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
];

interface RefreshIntervalChipProps {
  onChange: (seconds: number) => void;
}

export default function RefreshIntervalChip({ onChange }: RefreshIntervalChipProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(OPTIONS[1]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
        style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
      >
        Refresh: {selected.label}
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 flex flex-col rounded-[var(--radius-main)] p-1 shadow-lg"
          style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
        >
          {OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                setSelected(option);
                onChange(option.seconds);
                setOpen(false);
              }}
              className="rounded-md px-3 py-1.5 text-left text-xs hover:opacity-80"
              style={{
                color: "var(--color-text)",
                background: option.label === selected.label ? "var(--color-bg)" : "transparent",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
