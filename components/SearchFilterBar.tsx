export type SortBy = "name" | "status";

interface SearchFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  groups: string[];
  groupFilter: string;
  onGroupFilterChange: (value: string) => void;
  sortBy: SortBy;
  onSortByChange: (value: SortBy) => void;
}

const selectStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text)",
};

export default function SearchFilterBar({
  search,
  onSearchChange,
  groups,
  groupFilter,
  onGroupFilterChange,
  sortBy,
  onSortByChange,
}: SearchFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search endpoints…"
        className="min-w-[220px] flex-1 rounded-[var(--radius-main)] px-3 py-2 text-sm outline-none"
        style={selectStyle}
      />
      <select
        value={groupFilter}
        onChange={(e) => onGroupFilterChange(e.target.value)}
        className="rounded-[var(--radius-main)] px-3 py-2 text-sm outline-none"
        style={selectStyle}
      >
        <option value="all">Filter by: All groups</option>
        {groups.map((group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ))}
      </select>
      <select
        value={sortBy}
        onChange={(e) => onSortByChange(e.target.value as SortBy)}
        className="rounded-[var(--radius-main)] px-3 py-2 text-sm outline-none"
        style={selectStyle}
      >
        <option value="name">Sort by: Name</option>
        <option value="status">Sort by: Status</option>
      </select>
    </div>
  );
}
