import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';

// Servicios del módulo de administración

export async function createCampus(data) {
  const campus = new Campus(data);
  return campus.save();
}

export async function listCampuses() {
  return Campus.find();
}

export async function createCycle(data) {
  // Convertir fechas a objetos Date
  const cycle = new Cycle({
    ...data,
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
  });
  return cycle.save();
}

export async function listCycles() {
  return Cycle.find();
}

export async function createClassroom(data) {
  const classroom = new Classroom(data);
  return classroom.save();
}

export async function listClassrooms() {
  return Classroom.find().populate('campusId').populate('cycleId');
}

export async function createBillingConcept(data) {
  const concept = new BillingConcept(data);
  return concept.save();
}

export async function listBillingConcepts() {
  return BillingConcept.find();
}

function normalizePath(basePath, routePath) {
  const rawRoutePath = Array.isArray(routePath) ? routePath.join('|') : String(routePath || '');
  return `${basePath}${rawRoutePath === '/' ? '' : rawRoutePath}`;
}

function extractRouterEndpoints(mount) {
  const entries = [];

  for (const layer of mount.router.stack || []) {
    if (!layer.route) continue;

    const methods = Object.keys(layer.route.methods || {})
      .filter((method) => layer.route.methods[method])
      .map((method) => method.toUpperCase());

    for (const method of methods) {
      entries.push({
        method,
        path: normalizePath(mount.basePath, layer.route.path),
        module: mount.module || 'unknown',
        authRequired: mount.authRequired ?? null,
        rolesAllowed: mount.rolesAllowed ?? null,
        description: `${method} ${normalizePath(mount.basePath, layer.route.path)}`,
        requestSchema: null,
        responseSchema: null,
      });
    }
  }

  return entries;
}

export async function listAvailableEndpoints(app) {
  const mounts = app?.locals?.routeCatalogMounts || [];

  const items = [
    {
      method: 'GET',
      path: '/health',
      module: 'core',
      authRequired: false,
      rolesAllowed: null,
      description: 'Health check',
      requestSchema: null,
      responseSchema: { ok: 'boolean' },
    },
  ];

  for (const mount of mounts) {
    items.push(...extractRouterEndpoints(mount));
  }

  items.sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });

  return items;
}
