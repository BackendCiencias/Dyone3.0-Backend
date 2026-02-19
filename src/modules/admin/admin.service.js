import mongoose from 'mongoose';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';
import { allEndpointMetadata, validateEndpointMetadataShape, warnMetadataWithoutRoute } from '../../admin/endpointMetadataRegistry.js';

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

function extractRouterEndpoints(mount, metadataByKey) {
  const entries = [];

  for (const layer of mount.router.stack || []) {
    if (!layer.route) continue;

    const methods = Object.keys(layer.route.methods || {})
      .filter((method) => layer.route.methods[method])
      .map((method) => method.toUpperCase());

    for (const method of methods) {
      const path = normalizePath(mount.basePath, layer.route.path);
      const key = `${method} ${path}`;
      const metadata = metadataByKey.get(key);

      entries.push({
        method,
        path,
        module: mount.module || 'unknown',
        authRequired: mount.authRequired ?? null,
        rolesAllowed: null,
        description: `${method} ${path}`,
        requestSchema: null,
        responseSchema: null,
        ...(metadata ? {
          module: metadata.module || mount.module || 'unknown',
          authRequired: metadata.authRequired ?? (mount.authRequired ?? null),
          rolesAllowed: metadata.rolesAllowed ?? null,
          description: metadata.description || `${method} ${path}`,
          requestSchema: metadata.requestSchema ?? null,
          responseSchema: metadata.responseSchema ?? null,
        } : { metadataMissing: true }),
      });
    }
  }

  return entries;
}

export async function listAvailableEndpoints(app) {
  const mounts = app?.locals?.routeCatalogMounts || [];

  validateEndpointMetadataShape(allEndpointMetadata);
  const metadataByKey = new Map(
    allEndpointMetadata.map((entry) => [`${String(entry.method || '').toUpperCase()} ${entry.path}`, { ...entry, method: String(entry.method || '').toUpperCase() }])
  );

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
      metadataMissing: true,
    },
  ];

  for (const mount of mounts) {
    items.push(...extractRouterEndpoints(mount, metadataByKey));
  }

  warnMetadataWithoutRoute({ metadata: allEndpointMetadata, routeCatalog: items });

  items.sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });

  return items;
}

async function loadAllModelFiles() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const modelsDir = path.resolve(path.dirname(currentFilePath), '../../models');
  const files = await readdir(modelsDir);

  const modelFiles = files.filter((fileName) => fileName.endsWith('.model.js'));

  for (const fileName of modelFiles) {
    const absolutePath = path.join(modelsDir, fileName);
    await import(pathToFileURL(absolutePath).href);
  }
}

function getFieldMetadata(schemaType) {
  const options = schemaType.options || {};
  const baseMetadata = {
    type: schemaType.instance || 'Mixed',
    required: Boolean(options.required),
    unique: Boolean(options.unique),
    index: Boolean(options.index),
    ref: options.ref || null,
    enum: options.enum || null,
    default: options.default === undefined ? null : options.default,
  };

  if (schemaType.instance === 'Array') {
    const itemType = schemaType.caster?.instance || 'Mixed';
    baseMetadata.type = `Array<${itemType}>`;
    baseMetadata.ref = schemaType.caster?.options?.ref || options.ref || null;
  }

  return baseMetadata;
}

export async function listModelsCatalog() {
  await loadAllModelFiles();

  const models = mongoose.modelNames().map((modelName) => {
    const model = mongoose.model(modelName);

    const attributes = Object.entries(model.schema.paths)
      .map(([fieldName, schemaType]) => ({
        name: fieldName,
        ...getFieldMetadata(schemaType),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      model: model.modelName,
      collection: model.collection.collectionName,
      attributes,
    };
  });

  return models.sort((a, b) => a.model.localeCompare(b.model));
}
