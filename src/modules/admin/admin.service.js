import mongoose from 'mongoose';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';
import { BillingSchedule } from '../../models/billingSchedule.model.js';
import { AttendancePolicy } from '../../models/attendancePolicy.model.js';
import { Student } from '../../models/student.model.js';
import { Person } from '../../models/person.model.js';
import { allEndpointMetadata, validateEndpointMetadataShape, warnMetadataWithoutRoute } from '../../admin/endpointMetadataRegistry.js';
import { ApiError } from '../../utils/errors.js';
import { getEnrollmentContextMapByStudentIds } from '../../shared/enrollmentCurrent.js';

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

export async function updateClassroom(classroomId, data) {
  const classroom = await Classroom.findById(classroomId);
  if (!classroom) throw new ApiError(404, 'Salon no encontrado');

  const nextValues = {
    campusId: data.campusId ?? classroom.campusId,
    cycleId: data.cycleId ?? classroom.cycleId,
    level: data.level ?? classroom.level,
    grade: data.grade ?? classroom.grade,
    section: data.section ?? classroom.section,
    capacity: data.capacity ?? classroom.capacity,
    displayName: data.displayName ?? classroom.displayName,
    isActive: data.isActive ?? classroom.isActive,
    notes: data.notes ?? classroom.notes ?? '',
  };

  classroom.set(nextValues);
  await classroom.save();

  return Classroom.findById(classroom._id).populate('campusId').populate('cycleId');
}

export async function createBillingConcept(data) {
  const concept = new BillingConcept(data);
  return concept.save();
}

export async function listBillingConcepts() {
  return BillingConcept.find();
}

export async function upsertBillingSchedule({ cycleId, conceptCode, items }) {
  const cycle = await Cycle.findById(cycleId);
  if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

  const concept = await BillingConcept.findOne({ code: conceptCode });
  if (!concept) throw new ApiError(404, `BillingConcept no encontrado: ${conceptCode}`);

  const seen = new Set();
  for (const item of items) {
    const key = item.monthIndex === null ? 'null' : String(item.monthIndex);
    if (seen.has(key)) throw new ApiError(400, `monthIndex duplicado en items: ${key}`);
    seen.add(key);
  }

  await BillingSchedule.deleteMany({ cycleId: cycle._id, conceptCode });

  const docs = items.map((item) => ({
    cycleId: cycle._id,
    conceptCode,
    monthIndex: item.monthIndex,
    label: item.label || '',
    dueDate: new Date(item.dueDate),
  }));

  await BillingSchedule.insertMany(docs);

  return BillingSchedule.find({ cycleId: cycle._id, conceptCode }).sort({ monthIndex: 1, dueDate: 1 }).lean();
}

export async function getBillingSchedule({ cycleId, conceptCode }) {
  const schedule = await BillingSchedule.find({ cycleId, conceptCode })
    .sort({ monthIndex: 1, dueDate: 1 })
    .lean();

  return {
    cycleId,
    conceptCode,
    items: schedule.map((row) => ({
      monthIndex: row.monthIndex ?? null,
      label: row.label || '',
      dueDate: row.dueDate,
    })),
  };
}

function mapAttendancePolicy(policy) {
  if (!policy) return null;

  return {
    id: String(policy._id),
    campusId: String(policy.campusId),
    cycleId: String(policy.cycleId),
    level: policy.level || null,
    name: policy.name,
    defaultOnTimeUntil: policy.defaultOnTimeUntil,
    notes: policy.notes || '',
    isActive: Boolean(policy.isActive),
    updatedAt: policy.updatedAt,
  };
}

export async function getAttendancePolicy({ campusId, cycleId, level }) {
  const policy = await AttendancePolicy.findOne({
    scopeType: 'REGULAR_STUDENT',
    campusId,
    cycleId,
    level,
    classroomId: null,
    programId: null,
    isActive: true,
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return { item: mapAttendancePolicy(policy) };
}

export async function upsertAttendancePolicy({ campusId, cycleId, level, name, defaultOnTimeUntil, notes }, user) {
  const payload = {
    scopeType: 'REGULAR_STUDENT',
    campusId,
    cycleId,
    level,
    classroomId: null,
    programId: null,
    isActive: true,
    name,
    defaultOnTimeUntil,
    notes: notes || null,
    updatedByUserId: user.id,
  };

  const existing = await AttendancePolicy.findOne({
    scopeType: 'REGULAR_STUDENT',
    campusId,
    cycleId,
    level,
    classroomId: null,
    programId: null,
    isActive: true,
  }).sort({ updatedAt: -1, createdAt: -1 });

  if (existing) {
    existing.set(payload);
    await existing.save();
    return { item: mapAttendancePolicy(existing.toObject()) };
  }

  const created = await AttendancePolicy.create({
    ...payload,
    createdByUserId: user.id,
  });

  return { item: mapAttendancePolicy(created.toObject()) };
}

function slugifyFilePart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'todos';
}

function formatDateForFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function levelToSpanish(level) {
  const safeLevel = String(level || '').toUpperCase();
  if (safeLevel === 'INITIAL') return 'INICIAL';
  if (safeLevel === 'PRIMARY') return 'PRIMARIA';
  if (safeLevel === 'SECONDARY') return 'SECUNDARIA';
  return '';
}

function csvEscape(value) {
  const safeValue = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

function ensureCampusScopeAccess({ requestedCampus, user }) {
  if (!requestedCampus) return;
  const campusScope = Array.isArray(user?.campusScope) ? user.campusScope : [];
  if (!campusScope.length || campusScope.includes('ALL')) return;
  if (!campusScope.includes(requestedCampus)) {
    throw new ApiError(403, 'No autorizado para exportar alumnos de este campus');
  }
}

function getAllowedCampusCodes(user) {
  const campusScope = Array.isArray(user?.campusScope) ? user.campusScope : [];
  if (!campusScope.length || campusScope.includes('ALL')) return null;
  return new Set(campusScope.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean));
}

const COMPOUND_SURNAME_PARTICLES = new Set([
  'DE',
  'DEL',
  'DELA',
  'DE LA',
  'DE LAS',
  'DE LOS',
  'LA',
  'LAS',
  'LOS',
  'SAN',
  'SANTA',
  'VAN',
  'VON',
  'MC',
  'MAC',
]);

function splitNames(rawNames) {
  const tokens = String(rawNames || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase());

  if (!tokens.length) {
    return { firstName: '', secondName: '' };
  }

  return {
    firstName: tokens[0] || '',
    secondName: tokens.slice(1).join(' '),
  };
}

function isSurnameParticle(token) {
  return COMPOUND_SURNAME_PARTICLES.has(String(token || '').trim().toUpperCase());
}

function splitLastNames(rawLastNames) {
  const tokens = String(rawLastNames || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase());

  if (!tokens.length) {
    return { paternalLastName: '', maternalLastName: '' };
  }

  if (tokens.length === 1) {
    return { paternalLastName: tokens[0], maternalLastName: '' };
  }

  if (tokens.length === 2) {
    return { paternalLastName: tokens[0], maternalLastName: tokens[1] };
  }

  if (isSurnameParticle(tokens[0])) {
    return {
      paternalLastName: tokens.slice(0, -1).join(' ').trim(),
      maternalLastName: tokens[tokens.length - 1] || '',
    };
  }

  const paternalTokens = [];
  const maternalTokens = [];

  let index = 0;
  paternalTokens.push(tokens[index]);
  index += 1;

  while (index < tokens.length - 1 && isSurnameParticle(tokens[index])) {
    paternalTokens.push(tokens[index]);
    index += 1;
    if (index < tokens.length - 1) {
      paternalTokens.push(tokens[index]);
      index += 1;
    }
  }

  maternalTokens.push(...tokens.slice(index));

  return {
    paternalLastName: paternalTokens.join(' ').trim(),
    maternalLastName: maternalTokens.join(' ').trim(),
  };
}

function extractPensionAmount(enrollmentStudent) {
  const amounts = Array.isArray(enrollmentStudent?.pensionMonthlyAmounts)
    ? enrollmentStudent.pensionMonthlyAmounts
    : [];

  const firstValid = amounts.find((value) => Number.isFinite(Number(value)) && Number(value) >= 0);
  if (firstValid === undefined) return '';
  return String(Number(firstValid));
}

async function resolveExportCycle(cycleId) {
  if (cycleId) {
    const explicitCycle = await Cycle.findById(cycleId).lean();
    if (!explicitCycle) throw new ApiError(404, 'Ciclo no encontrado');
    return explicitCycle;
  }

  const currentDate = new Date();
  const activeCycle = await Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: currentDate },
    endDate: { $gte: currentDate },
  })
    .sort({ startDate: -1, _id: -1 })
    .lean();

  if (activeCycle) return activeCycle;

  const fallbackCycle = await Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true })
    .sort({ year: -1, startDate: -1, _id: -1 })
    .lean();

  if (!fallbackCycle) throw new ApiError(404, 'No hay ciclo escolar activo para exportar');
  return fallbackCycle;
}

export async function buildCajaArequipaExport({ query, user }) {
  const requestedCampus = query?.campus ? String(query.campus).trim().toUpperCase() : null;
  ensureCampusScopeAccess({ requestedCampus, user });
  const allowedCampusCodes = getAllowedCampusCodes(user);

  const cycle = await resolveExportCycle(query?.cycleId || null);

  const campusDoc = requestedCampus
    ? await Campus.findOne({ code: requestedCampus }).select('_id code name').lean()
    : null;

  if (requestedCampus && !campusDoc) {
    throw new ApiError(404, 'Campus no encontrado');
  }

  const students = await Student.find({ activeStatus: 'ACTIVE' })
    .select('_id personId bankCode')
    .lean();

  const studentIds = students.map((student) => String(student._id));
  const contextMap = await getEnrollmentContextMapByStudentIds(studentIds, { cycleId: cycle._id });

  const exportableStudents = [];
  for (const student of students) {
    const context = contextMap.get(String(student._id));
    if (!context?.classroom || !context?.campus) continue;
    if (allowedCampusCodes && !allowedCampusCodes.has(String(context.campus.code || '').toUpperCase())) continue;
    if (campusDoc && String(context.campus._id) !== String(campusDoc._id)) continue;
    exportableStudents.push({ student, context });
  }

  const personIds = exportableStudents.map(({ student }) => student.personId).filter(Boolean);
  const people = personIds.length
    ? await Person.find({ _id: { $in: personIds } }).select('_id names lastNames').lean()
    : [];
  const personById = new Map(people.map((person) => [String(person._id), person]));

  const rows = exportableStudents
    .map(({ student, context }) => {
      const person = personById.get(String(student.personId)) || {};
      const classroom = context.classroom || null;
      const enrollmentStudent = context.enrollmentStudent || null;
      const { firstName, secondName } = splitNames(person.names);
      const { paternalLastName, maternalLastName } = splitLastNames(person.lastNames);

      return {
        bankCode: String(student.bankCode || '').trim(),
        institutionCode: '',
        firstName,
        secondName,
        paternalLastName,
        maternalLastName,
        classification1: levelToSpanish(classroom?.level),
        classification2: String(classroom?.grade || '').trim(),
        classification3: String(classroom?.section || '').trim().toUpperCase(),
        enrollmentFee: '',
        pension: extractPensionAmount(enrollmentStudent),
        period: '',
        levelOrder: classroom?.level === 'INITIAL' ? 1 : classroom?.level === 'PRIMARY' ? 2 : classroom?.level === 'SECONDARY' ? 3 : 99,
        gradeOrder: Number(classroom?.grade) || 999,
        sectionOrder: String(classroom?.section || '').trim().toUpperCase(),
        sortName: `${paternalLastName} ${maternalLastName} ${firstName} ${secondName}`.trim(),
      };
    })
    .sort((a, b) => {
      if (a.levelOrder !== b.levelOrder) return a.levelOrder - b.levelOrder;
      if (a.gradeOrder !== b.gradeOrder) return a.gradeOrder - b.gradeOrder;
      if (a.sectionOrder !== b.sectionOrder) return a.sectionOrder.localeCompare(b.sectionOrder, 'es');
      return a.sortName.localeCompare(b.sortName, 'es');
    });

  const header = [
    'CODIGO CAJA',
    'CÓDIGO INSTITUCIÓN',
    '1ER NOMBRE',
    '2DO NOMBRE',
    'APELLIDO PATERNO',
    'APELLIDO MATERNO',
    'CLASIFICACION1',
    'CLASIFICACION2',
    'CLASIFICACION3',
    'MATRICULA',
    'PENSION',
    'PERIODO',
  ];
  const body = rows.map((row) => [
    row.bankCode,
    row.institutionCode,
    row.firstName,
    row.secondName,
    row.paternalLastName,
    row.maternalLastName,
    row.classification1,
    row.classification2,
    row.classification3,
    row.enrollmentFee,
    row.pension,
    row.period,
  ].map(csvEscape).join(','));
  const content = `\uFEFF${[header.join(','), ...body].join('\r\n')}`;

  return {
    fileName: `caja-arequipa-${slugifyFilePart(requestedCampus || 'todos')}-${formatDateForFileName()}.csv`,
    rowCount: rows.length,
    content,
    cycle: {
      id: String(cycle._id),
      name: cycle.name,
      year: cycle.year,
    },
    campus: campusDoc ? { id: String(campusDoc._id), code: campusDoc.code, name: campusDoc.name } : null,
  };
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
