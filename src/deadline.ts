export const DEADLINE_TIME_ZONE = "America/Sao_Paulo";

const calendarFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DEADLINE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function calendarDateAt(instant: Date): string {
  const parts = Object.fromEntries(
    calendarFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isDeadlineExpired(deadline: string, now: Date): boolean {
  return calendarDateAt(now) > deadline;
}
