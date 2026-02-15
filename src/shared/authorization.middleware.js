import { ApiError } from '../utils/errors.js';

const CAMPUS_BY_ROLE = {
  SECRETARY_CIMAS: ['CIMAS'],
  SECRETARY_CIENCIAS_SEC: ['CIENCIAS'],
  SECRETARY_CIENCIAS_PRIM: ['CIENCIAS'],
  SECRETARY_CIENCIAS: ['CIENCIAS'],
  SECRETARY_APLICADAS: ['CIENCIAS_APLICADAS'],
};

function isScopedUser(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.some((role) => role === 'SECRETARY' || role.startsWith('SECRETARY_'));
}

function resolveCampusScope(user) {
  if (!user) return [];
  if (Array.isArray(user.campusScope) && user.campusScope.length) return user.campusScope.map(String);

  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.includes('ADMIN')) return ['*'];

  const scopes = new Set();
  for (const role of roles) {
    for (const code of CAMPUS_BY_ROLE[role] || []) scopes.add(code);
  }
  return [...scopes];
}

function assertCampusAllowed(req, campusValue) {
  const scope = resolveCampusScope(req.user);
  if (scope.includes('*')) return;
  if (!campusValue) throw new ApiError(403, 'Campus requerido para este usuario');

  const candidates = typeof campusValue === 'object'
    ? [campusValue.id, campusValue.code].filter(Boolean).map(String)
    : [String(campusValue)];

  const allowed = candidates.some((value) => scope.includes(value));
  if (!allowed) throw new ApiError(403, 'No autorizado para este campus');
}

export function authorizeByCampusScope(resolveCampus) {
  return async (req, _res, next) => {
    try {
      const scope = resolveCampusScope(req.user);
      req.campusScope = scope;

      if (!isScopedUser(req.user) || scope.includes('*')) return next();
      if (!scope.length) throw new ApiError(403, 'Usuario sin campusScope configurado');

      const campus = await resolveCampus(req);
      if (Array.isArray(campus)) {
        for (const campusItem of campus) assertCampusAllowed(req, campusItem);
      } else {
        assertCampusAllowed(req, campus);
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function attachCampusScope() {
  return (req, _res, next) => {
    const scope = resolveCampusScope(req.user);
    req.campusScope = scope;

    if (isScopedUser(req.user) && !scope.includes('*') && !scope.length) {
      return next(new ApiError(403, 'Usuario sin campusScope configurado'));
    }

    next();
  };
}
