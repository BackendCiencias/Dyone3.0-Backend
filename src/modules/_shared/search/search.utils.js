export function normalizeSearchTerm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildAccentInsensitiveRegex(term) {
  const normalized = normalizeSearchTerm(term);
  if (!normalized) return null;

  const map = {
    a: '[aáàäâãAÁÀÄÂÃ]',
    e: '[eéèëêEÉÈËÊ]',
    i: '[iíìïîIÍÌÏÎ]',
    o: '[oóòöôõOÓÒÖÔÕ]',
    u: '[uúùüûUÚÙÜÛ]',
    n: '[nñNÑ]',
  };

  const pattern = normalized
    .split('')
    .map((char) => (char === ' ' ? '\\s*' : map[char.toLowerCase()] || escapeRegExp(char)))
    .join('');

  return new RegExp(pattern, 'i');
}

export function buildSearchScore({ normalizedQ, dni, names, lastNames, internalCode }) {
  const dniValue = String(dni || '').toLowerCase();
  const namesValue = normalizeSearchTerm(names || '');
  const lastNamesValue = normalizeSearchTerm(lastNames || '');
  const fullValue = `${lastNamesValue} ${namesValue}`.trim();
  const internalCodeValue = normalizeSearchTerm(internalCode || '');

  if (dniValue && dniValue === normalizedQ) return 300;
  if (lastNamesValue.startsWith(normalizedQ) || namesValue.startsWith(normalizedQ) || fullValue.startsWith(normalizedQ)) return 200;
  if (dniValue.includes(normalizedQ) || namesValue.includes(normalizedQ) || lastNamesValue.includes(normalizedQ) || fullValue.includes(normalizedQ) || internalCodeValue.includes(normalizedQ)) return 100;
  return 10;
}

export function byScoreThenId(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  return String(a.id).localeCompare(String(b.id));
}
