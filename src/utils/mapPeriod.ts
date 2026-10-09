import { calendarDateFromISO, formatCivilDate } from './dateTime';

export type MapPeriodPreset = 'day' | 'week' | 'month' | 'year' | 'custom';

export interface CivilDateRange {
  start: string;
  end: string;
}

function lastDayOfMonth(isoDate: string): string {
  const [yearText, monthText] = isoDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const last = new Date(year, month, 0);
  return formatCivilDate(last);
}

export function resolveMapPeriodRange(
  preset: MapPeriodPreset,
  todayIso: string,
  customFrom: string,
  customTo: string,
): CivilDateRange {
  switch (preset) {
    case 'day':
      return { start: todayIso, end: todayIso };
    case 'week': {
      const anchor = calendarDateFromISO(todayIso);
      const start = new Date(anchor);
      start.setDate(anchor.getDate() - anchor.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start: formatCivilDate(start), end: formatCivilDate(end) };
    }
    case 'month':
      return { start: `${todayIso.slice(0, 7)}-01`, end: lastDayOfMonth(todayIso) };
    case 'year':
      return { start: `${todayIso.slice(0, 4)}-01-01`, end: `${todayIso.slice(0, 4)}-12-31` };
    case 'custom': {
      const start = customFrom || todayIso;
      const end = customTo || customFrom || todayIso;
      return start <= end ? { start, end } : { start: end, end: start };
    }
  }
}

export function isCivilDateInRange(day: string, range: CivilDateRange): boolean {
  return day >= range.start && day <= range.end;
}
