import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCivilDate } from '../../utils/dateTime';

export function formatMonthYearLabel(month: Date, locale: string): string {
  const intlLocale = locale === 'he' ? 'he-IL' : locale === 'ru' ? 'ru-RU' : 'en-US';
  const raw = new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric' }).format(month);
  if (locale === 'ru') {
    return `${raw.charAt(0).toUpperCase()}${raw.slice(1).replace(' Г.', ' г.')}`;
  }
  return raw;
}

export function MonthGrid({
  month,
  selected,
  disabled,
  onSelect,
  onMonth,
  locale,
}: {
  month: Date;
  selected: string;
  disabled: (iso: string) => boolean;
  onSelect: (iso: string) => void;
  onMonth: (next: Date) => void;
  locale: string;
}) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = start.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const label = formatMonthYearLabel(month, locale);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="rounded-lg p-2 hover:bg-canvas" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="previous">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        <p className="font-semibold text-ink">{label}</p>
        <button type="button" className="rounded-lg p-2 hover:bg-canvas" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="next">
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {Array.from({ length: startOffset }).map((_, index) => <span key={`pad-${index}`} />)}
        {Array.from({ length: days }).map((_, index) => {
          const date = new Date(month.getFullYear(), month.getMonth(), index + 1);
          const iso = formatCivilDate(date);
          const isDisabled = disabled(iso);
          const isSelected = iso === selected;
          return (
            <button
              key={iso}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(iso)}
              className={`h-8 rounded-md text-xs font-medium ${isSelected ? 'bg-primary text-white' : 'hover:bg-highlight'} disabled:cursor-not-allowed disabled:text-muted/50`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
