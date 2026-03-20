function sanitizeSpaces(value) {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizePersonNames(value) {
  if (typeof value !== 'string') return value;

  const sanitized = sanitizeSpaces(value);
  if (!sanitized) return sanitized;

  return sanitized
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizePersonLastNames(value) {
  if (typeof value !== 'string') return value;

  const sanitized = sanitizeSpaces(value);
  if (!sanitized) return sanitized;

  return sanitized.toUpperCase();
}

export function normalizePersonNameFields(data = {}) {
  if (!data || typeof data !== 'object') return data;

  const normalized = { ...data };

  if (typeof normalized.names === 'string') {
    normalized.names = normalizePersonNames(normalized.names);
  }

  if (typeof normalized.lastNames === 'string') {
    normalized.lastNames = normalizePersonLastNames(normalized.lastNames);
  }

  return normalized;
}

export function normalizePersonUpdatePayload(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update;

  const normalizedUpdate = { ...update };

  if (normalizedUpdate.$set && typeof normalizedUpdate.$set === 'object' && !Array.isArray(normalizedUpdate.$set)) {
    normalizedUpdate.$set = normalizePersonNameFields(normalizedUpdate.$set);
  }

  if (Object.prototype.hasOwnProperty.call(normalizedUpdate, 'names')) {
    normalizedUpdate.names = normalizePersonNames(normalizedUpdate.names);
  }

  if (Object.prototype.hasOwnProperty.call(normalizedUpdate, 'lastNames')) {
    normalizedUpdate.lastNames = normalizePersonLastNames(normalizedUpdate.lastNames);
  }

  return normalizedUpdate;
}

