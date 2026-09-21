export const BUSINESS_TIME_ZONE = 'Asia/Jerusalem';

interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const map: Partial<ZonedParts> = {};
  for (const part of formatter.formatToParts(date)) {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute' ||
      part.type === 'second'
    ) {
      map[part.type] = part.value;
    }
  }

  return {
    year: map.year ?? '0000',
    month: map.month ?? '01',
    day: map.day ?? '01',
    hour: map.hour === '24' ? '00' : map.hour ?? '00',
    minute: map.minute ?? '00',
    second: map.second ?? '00',
  };
}

export function todayISOInTimeZone(timeZone: string, now = new Date()): string {
  const parts = getZonedParts(now, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatCivilDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calendarDateFromISO(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function zonedTimeToUtc(dateISO: string, timeHHMM: string, timeZone: string): Date {
  const [year, month, day] = dateISO.split('-').map(Number);
  const [hour, minute] = timeHHMM.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0));
  const offset = timeZoneOffsetMs(utcGuess, timeZone);
  const utc = new Date(utcGuess.getTime() - offset);
  const offsetAfter = timeZoneOffsetMs(utc, timeZone);
  if (offset === offsetAfter) return utc;
  return new Date(utcGuess.getTime() - offsetAfter);
}

export function formatAppointmentInZone(iso: string, timeZone: string): string {
  const parts = getZonedParts(new Date(iso), timeZone);
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function formatISODateToDisplay(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function parseDisplayDateTime(value: string): { date: string; time: string } | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || year < 1900) {
    return null;
  }

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }

  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export function parseDisplayDate(value: string): string | null {
  return parseDisplayDateTime(`${value.trim()} 00:00`)?.date ?? null;
}

export function normalizeClock(value: string): string {
  return value.slice(0, 5);
}
