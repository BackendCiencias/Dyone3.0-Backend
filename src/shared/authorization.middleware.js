import { Campus } from '../models/campus.model.js';
import { ApiError } from '../utils/errors.js';

const SCOPED_ROLES = new Set(['ADMIN', 'SECRETARY', 'SECRETARY_VIEWER', 'AUXILIAR', 'DIRECTOR', 'PROMOTER', 'TEACHER']);

function isScopedUser(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.some((role) => SCOPED_ROLES.has(role));
}

function resolveCampusScope(user) {
  if (!user || !Array.isArray(user.campusScope)) return [];
  return user.campusScope.map(String);
}

async function resolveCampusCode(campusValue) {
  if (!campusValue) return null;

  if (typeof campusValue === 'object') {
    if (campusValue.code) return String(campusValue.code);
    if (campusValue.id) {
      const campus = await Campus.findById(campusValue.id).select('code').lean();
      return campus?.code || null;
    }
  }

  const value = String(campusValue);
  const campus = await Campus.findOne({ $or: [{ _id: value }, { code: value }] }).select('code').lean();
  if (campus?.code) return campus.code;

  return ['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS'].includes(value) ? value : null;
}

async function assertCampusAllowed(req, campusValue) {
  const scope = resolveCampusScope(req.user);
  if (scope.includes('ALL')) return;
  if (!campusValue) throw new ApiError(403, 'Campus requerido para este usuario');

  const campusCode = await resolveCampusCode(campusValue);
  if (!campusCode) throw new ApiError(403, 'No autorizado para este campus');

  if (!scope.includes(campusCode)) throw new ApiError(403, 'No autorizado para este campus');
}

export function authorizeByCampusScope(resolveCampus) {
  return async (req, _res, next) => {
    try {
      const scope = resolveCampusScope(req.user);
      req.campusScope = scope;

      if (!isScopedUser(req.user) || scope.includes('ALL')) return next();
      if (!scope.length) throw new ApiError(403, 'Usuario sin campusScope configurado');

      const campus = await resolveCampus(req);
      if (Array.isArray(campus)) {
        for (const campusItem of campus) await assertCampusAllowed(req, campusItem);
      } else {
        await assertCampusAllowed(req, campus);
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

    if (isScopedUser(req.user) && !scope.includes('ALL') && !scope.length) {
      return next(new ApiError(403, 'Usuario sin campusScope configurado'));
    }

    next();
  };
}
