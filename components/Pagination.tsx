interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="rounded-[var(--radius-main)] px-3 py-1.5 text-sm disabled:opacity-40"
        style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
      >
        Previous
      </button>
      <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
        Page {page} of {Math.max(totalPages, 1)}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="rounded-[var(--radius-main)] px-3 py-1.5 text-sm disabled:opacity-40"
        style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
      >
        Next
      </button>
    </div>
  );
}
