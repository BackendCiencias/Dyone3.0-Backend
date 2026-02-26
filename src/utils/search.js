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
