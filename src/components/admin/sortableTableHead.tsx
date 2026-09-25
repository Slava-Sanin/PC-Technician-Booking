import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc';

export function toggleSortState<T>(current: T | null, column: T, direction: SortDirection): { column: T; direction: SortDirection } {
  if (current === column) {
    return { column, direction: direction === 'asc' ? 'desc' : 'asc' };
  }
  return { column, direction: 'asc' };
}

export function compareSortValues(left: string | number | boolean, right: string | number | boolean, direction: SortDirection): number {
  if (left < right) return direction === 'asc' ? -1 : 1;
  if (left > right) return direction === 'asc' ? 1 : -1;
  return 0;
}

export function SortableTableHead<T extends string>({
  column,
  activeColumn,
  direction,
  onSort,
  label,
  className = '',
}: {
  column: T;
  activeColumn: T | null;
  direction: SortDirection;
  onSort: (column: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <th scope="col" onClick={() => onSort(column)} className={`cursor-pointer select-none hover:bg-canvas/80 ${className}`}>
      <div className="flex items-center justify-center gap-1">
        {label}
        {activeColumn === column ? (
          direction === 'asc' ? <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-30" aria-hidden />
        )}
      </div>
    </th>
  );
}

export function TableHead({ label, className = '' }: { label: string; className?: string }) {
  return (
    <th scope="col" className={className}>
      <div className="flex items-center justify-center">{label}</div>
    </th>
  );
}
