const LIMA_UTC_OFFSET_HOURS = -5;

function pad(value) {
  return String(value).padStart(2, '0');
}

function extractCurrentLimaDateParts() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function parseDateString(dateString) {
  const raw = String(dateString || '').trim();
  if (!raw) return null;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
}

export function resolveOperationalDay(dateString) {
  const parts = parseDateString(dateString) || extractCurrentLimaDateParts();
  const { year, month, day } = parts;

  const startUtc = new Date(Date.UTC(year, month - 1, day, -LIMA_UTC_OFFSET_HOURS, 0, 0, 0));
  const endUtc = new Date(Date.UTC(year, month - 1, day + 1, -LIMA_UTC_OFFSET_HOURS, 0, 0, 0));

  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    startUtc,
    endUtc,
  };
}
