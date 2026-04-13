import mongoose from 'mongoose';
import { Activity } from '../../models/activity.model.js';
import { ActivityParticipant } from '../../models/activityParticipant.model.js';
import { ActivityCollection } from '../../models/activityCollection.model.js';
import { Campus } from '../../models/campus.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { Counter } from '../../models/counter.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Student } from '../../models/student.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Person } from '../../models/person.model.js';
import { User } from '../../models/user.model.js';
import { ApiError } from '../../utils/errors.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { buildAccentInsensitiveRegex, normalizeSearchTerm } from '../../utils/search.js';

function toMoney(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function toDecimal(value) {
  return mongoose.Types.Decimal128.fromString(roundMoney(value).toFixed(2));
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function mapMethodLabel(method) {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'YAPE') return 'Yape';
  if (method === 'TRANSFER') return 'Transferencia';
  return method || '-';
}

function mapActivityTypeLabel(type) {
  const labels = {
    CONTEST: 'Concurso',
    EVENT: 'Evento',
    CAMPAIGN: 'Campaña',
    SPECIAL_COLLECTION: 'Recaudación especial',
  };
  return labels[type] || type || '-';
}

function mapAudienceLabel(activity) {
  if (!activity) return '-';
  if (activity.audienceType === 'LEVEL') {
    return activity.targetLevel === 'SECONDARY'
      ? 'Secundaria'
      : activity.targetLevel === 'PRIMARY'
        ? 'Primaria'
        : activity.targetLevel === 'INITIAL'
          ? 'Inicial'
          : 'Nivel';
  }
  if (activity.audienceType === 'GRADE') {
    const levelLabel = activity.targetLevel === 'SECONDARY'
      ? 'Secundaria'
      : activity.targetLevel === 'PRIMARY'
        ? 'Primaria'
        : activity.targetLevel === 'INITIAL'
          ? 'Inicial'
          : '';
    return `${activity.targetGrade || ''}° ${levelLabel}`.trim();
  }
  if (activity.audienceType === 'CLASSROOMS') return 'Salones específicos';
  if (activity.audienceType === 'CUSTOM') return 'Selección manual';
  return '-';
}

function getScopedCampusCodes(campusScope = []) {
  if (!Array.isArray(campusScope)) return [];
  return campusScope.map(String).filter(Boolean);
}

function resolveEffectiveRole(user, activeRoleHeader) {
  const userRoles = Array.isArray(user?.roles) ? user.roles.map((role) => String(role).toUpperCase()) : [];
  const requested = String(activeRoleHeader || '').trim().toUpperCase();
  if (requested && userRoles.includes(requested)) return requested;
  return userRoles.find((role) => ['ADMIN', 'SECRETARY', 'AUXILIAR'].includes(role)) || null;
}

function resolveCollectorRoleFromUser(user, preferredRole = null) {
  const roles = Array.isArray(user?.roles) ? user.roles.map((role) => String(role).toUpperCase()) : [];
  const normalizedPreferred = String(preferredRole || '').trim().toUpperCase();
  if (normalizedPreferred && roles.includes(normalizedPreferred) && ['ADMIN', 'SECRETARY', 'AUXILIAR'].includes(normalizedPreferred)) {
    return normalizedPreferred;
  }
  return roles.find((role) => ['ADMIN', 'SECRETARY', 'AUXILIAR'].includes(role)) || null;
}

async function assertCampusAllowed(campusCode, campusScope = []) {
  const allowed = getScopedCampusCodes(campusScope);
  if (allowed.includes('ALL')) return;
  if (!allowed.includes(campusCode)) {
    throw new ApiError(403, 'No autorizado para este campus');
  }
}

async function resolveCampusByCode(campusCode) {
  const campus = await Campus.findOne({ code: campusCode }).select('_id code name').lean();
  if (!campus) throw new ApiError(404, 'Campus no encontrado');
  return campus;
}

async function resolveCurrentCycle() {
  const now = new Date();
  const current = await Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).sort({ startDate: -1 }).lean();

  if (current) return current;

  const fallback = await Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true }).sort({ startDate: -1 }).lean();
  if (!fallback) throw new ApiError(400, 'No hay ciclo escolar activo');
  return fallback;
}

async function ensureUniqueSlug(slug, excludeId = null, session = null) {
  if (!slug) throw new ApiError(400, 'No se pudo generar slug para la actividad');
  const where = { slug };
  if (excludeId) where._id = { $ne: excludeId };
  const query = Activity.findOne(where).select('_id');
  if (session) query.session(session);
  const existing = await query.lean();
  if (existing) throw new ApiError(409, 'Ya existe una actividad con nombre similar');
}

async function nextActivityReceiptInternalCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { key: 'activity_receipt_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  return `ACT-${String(counter.seq).padStart(6, '0')}`;
}

async function getAudienceStudentIds({ activity, campusId, cycleId, session = null }) {
  if (activity.audienceType === 'CUSTOM') return [];

  const classroomWhere = { campusId, cycleId };

  if (activity.audienceType === 'LEVEL') classroomWhere.level = activity.targetLevel;
  if (activity.audienceType === 'GRADE') {
    classroomWhere.level = activity.targetLevel;
    classroomWhere.grade = activity.targetGrade;
  }
  if (activity.audienceType === 'CLASSROOMS') {
    classroomWhere._id = { $in: activity.classroomIds || [] };
  }

  const classroomQuery = Classroom.find(classroomWhere).select('_id');
  if (session) classroomQuery.session(session);
  const classrooms = await classroomQuery.lean();
  const classroomIds = classrooms.map((row) => row._id);
  if (!classroomIds.length) return [];

  const vacancyQuery = Vacancy.find({
    cycleId,
    classroomId: { $in: classroomIds },
  }).select('studentId');
  if (session) vacancyQuery.session(session);
  const vacancies = await vacancyQuery.lean();

  return [...new Set(vacancies.map((row) => String(row.studentId)).filter(Boolean))];
}

async function syncParticipantsForActivity({ activity, userId, role, session }) {
  const studentIds = await getAudienceStudentIds({
    activity,
    campusId: activity.campusId,
    cycleId: activity.cycleId,
    session,
  });

  if (!studentIds.length) return 0;

  const existingRows = await ActivityParticipant.find({
    activityId: activity._id,
    studentId: { $in: studentIds },
  }).select('studentId').session(session).lean();
  const existingIds = new Set(existingRows.map((row) => String(row.studentId)));

  const toCreate = studentIds
    .filter((studentId) => !existingIds.has(String(studentId)))
    .map((studentId) => ({
      activityId: activity._id,
      studentId,
      status: 'PENDING',
      registeredByUserId: userId,
      registeredByRole: role,
      registeredAt: new Date(),
    }));

  if (toCreate.length) {
    await ActivityParticipant.insertMany(toCreate, { session });
  }

  return toCreate.length;
}

async function assertStudentMatchesAudience({ activity, studentId }) {
  if (activity.audienceType === 'CUSTOM') return;

  const vacancy = await Vacancy.findOne({ studentId, cycleId: activity.cycleId })
    .populate({ path: 'classroomId', select: '_id campusId level grade' })
    .lean();

  if (!vacancy?.classroomId) {
    throw new ApiError(400, 'El alumno no pertenece al alcance de esta actividad');
  }

  const classroom = vacancy.classroomId;
  if (String(classroom.campusId) !== String(activity.campusId)) {
    throw new ApiError(400, 'El alumno no pertenece al campus de esta actividad');
  }

  if (activity.audienceType === 'LEVEL' && classroom.level !== activity.targetLevel) {
    throw new ApiError(400, 'El alumno no pertenece al alcance de esta actividad');
  }

  if (activity.audienceType === 'GRADE' && (classroom.level !== activity.targetLevel || Number(classroom.grade) !== Number(activity.targetGrade))) {
    throw new ApiError(400, 'El alumno no pertenece al alcance de esta actividad');
  }

  if (activity.audienceType === 'CLASSROOMS') {
    const classroomIds = (activity.classroomIds || []).map((value) => String(value));
    if (!classroomIds.includes(String(classroom._id))) {
      throw new ApiError(400, 'El alumno no pertenece al alcance de esta actividad');
    }
  }
}

function buildActivityCard(activity, campus) {
  return {
    id: String(activity._id),
    name: activity.name,
    slug: activity.slug,
    type: activity.type,
    typeLabel: mapActivityTypeLabel(activity.type),
    description: activity.description || null,
    audienceType: activity.audienceType,
    audienceLabel: mapAudienceLabel(activity),
    targetLevel: activity.targetLevel || null,
    targetGrade: activity.targetGrade || null,
    classroomIds: Array.isArray(activity.classroomIds) ? activity.classroomIds.map((value) => String(value)) : [],
    amount: roundMoney(toMoney(activity.amount)),
    status: activity.status,
    campus: campus
      ? { id: String(campus._id), code: campus.code, name: campus.name }
      : null,
    allowSecretaryCollection: Boolean(activity.allowSecretaryCollection),
    allowAuxiliarCollection: Boolean(activity.allowAuxiliarCollection),
    allowAdminCollection: Boolean(activity.allowAdminCollection),
    startsAt: activity.startsAt || null,
    endsAt: activity.endsAt || null,
    receiptSeries: activity.receiptSeries || 'ACT',
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
}

async function buildActivitySummary(activityId) {
  const [participantsAgg, collectionsAgg] = await Promise.all([
    ActivityParticipant.aggregate([
      { $match: { activityId: new mongoose.Types.ObjectId(activityId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ActivityCollection.aggregate([
      { $match: { activityId: new mongoose.Types.ObjectId(activityId), isVoided: false } },
      {
        $group: {
          _id: '$collectorRole',
          totalAmount: { $sum: { $toDouble: '$amount' } },
          collectionsCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const counts = participantsAgg.reduce((acc, row) => {
    acc[row._id] = Number(row.count || 0);
    return acc;
  }, {});

  const totalCollected = roundMoney(collectionsAgg.reduce((acc, row) => acc + Number(row.totalAmount || 0), 0));

  return {
    participantsCount: (counts.PENDING || 0) + (counts.PAID || 0) + (counts.ANULADO || 0),
    paidCount: counts.PAID || 0,
    pendingCount: counts.PENDING || 0,
    anulledCount: counts.ANULADO || 0,
    totalCollected,
    collectedByRole: collectionsAgg.map((row) => ({
      role: row._id || 'UNKNOWN',
      totalAmount: roundMoney(row.totalAmount || 0),
      collectionsCount: Number(row.collectionsCount || 0),
    })).sort((a, b) => b.totalAmount - a.totalAmount),
  };
}

async function getActivityOrThrow(activityId) {
  const activity = await Activity.findById(activityId).lean();
  if (!activity) throw new ApiError(404, 'Actividad no encontrada');
  return activity;
}

function assertManageAllowed(effectiveRole) {
  if (effectiveRole !== 'ADMIN') {
  throw new ApiError(403, 'Solo admin puede gestionar actividades');
  }
}

function assertCollectionAllowed(activity, effectiveRole) {
  if (activity.status !== 'ACTIVE') {
    throw new ApiError(400, 'La activity no está activa para cobros');
  }

  if (effectiveRole === 'ADMIN' && activity.allowAdminCollection) return;
  if (effectiveRole === 'SECRETARY' && activity.allowSecretaryCollection) return;
  if (effectiveRole === 'AUXILIAR' && activity.allowAuxiliarCollection) return;

  throw new ApiError(403, 'Tu rol activo no puede cobrar esta actividad');
}

export async function createActivityService({ payload, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  assertManageAllowed(effectiveRole);
  await assertCampusAllowed(payload.campusCode, campusScope);

  const campus = await resolveCampusByCode(payload.campusCode);
  const cycle = await resolveCurrentCycle();
  const slug = normalizeSlug(payload.name);

  const created = await runInTransaction(async (session) => {
    await ensureUniqueSlug(slug, null, session);

    const [activity] = await Activity.create([{
      campusId: campus._id,
      cycleId: cycle._id,
      name: payload.name,
      slug,
      type: payload.type,
      description: payload.description || undefined,
      audienceType: payload.audienceType,
      targetLevel: payload.targetLevel || null,
      targetGrade: payload.targetGrade || null,
      classroomIds: payload.classroomIds || [],
      amount: toDecimal(payload.amount),
      allowSecretaryCollection: payload.allowSecretaryCollection,
      allowAuxiliarCollection: payload.allowAuxiliarCollection,
      allowAdminCollection: payload.allowAdminCollection,
      startsAt: payload.startsAt || null,
      endsAt: payload.endsAt || null,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    }], { session });

    const createdCount = await syncParticipantsForActivity({
      activity,
      userId: user.id,
      role: effectiveRole,
      session,
    });

    await registerAuditLog({
      entityType: 'ACTIVITY',
      entityId: activity._id,
      action: 'ACTIVITY_CREATED',
      performedBy: user.id,
      campusId: campus._id,
      payloadSnapshot: {
        name: activity.name,
        type: activity.type,
        audienceType: activity.audienceType,
        amount: roundMoney(payload.amount),
        participantsSeeded: createdCount,
      },
    });

    return activity;
  });

  return {
    activity: buildActivityCard(created.toObject ? created.toObject() : created, campus),
  };
}

export async function updateActivityService({ activityId, payload, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  assertManageAllowed(effectiveRole);

  const current = await Activity.findById(activityId);
  if (!current) throw new ApiError(404, 'Actividad no encontrada');

  const campus = payload.campusCode
    ? await resolveCampusByCode(payload.campusCode)
    : await Campus.findById(current.campusId).select('_id code name').lean();
  await assertCampusAllowed(campus.code, campusScope);

  const updated = await runInTransaction(async (session) => {
    if (payload.name && payload.name !== current.name) {
      const slug = normalizeSlug(payload.name);
      await ensureUniqueSlug(slug, current._id, session);
      current.name = payload.name;
      current.slug = slug;
    }

    if (payload.campusCode) current.campusId = campus._id;
    if (payload.type) current.type = payload.type;
    if (payload.description !== undefined) current.description = payload.description || undefined;
    if (payload.audienceType) current.audienceType = payload.audienceType;
    if (payload.targetLevel !== undefined) current.targetLevel = payload.targetLevel || null;
    if (payload.targetGrade !== undefined) current.targetGrade = payload.targetGrade || null;
    if (payload.classroomIds) current.classroomIds = payload.classroomIds;
    if (payload.amount !== undefined) current.amount = toDecimal(payload.amount);
    if (payload.allowSecretaryCollection !== undefined) current.allowSecretaryCollection = payload.allowSecretaryCollection;
    if (payload.allowAuxiliarCollection !== undefined) current.allowAuxiliarCollection = payload.allowAuxiliarCollection;
    if (payload.allowAdminCollection !== undefined) current.allowAdminCollection = payload.allowAdminCollection;
    if (payload.startsAt !== undefined) current.startsAt = payload.startsAt || null;
    if (payload.endsAt !== undefined) current.endsAt = payload.endsAt || null;
    if (payload.status) current.status = payload.status;
    current.updatedByUserId = user.id;
    await current.save({ session });

    const createdCount = await syncParticipantsForActivity({
      activity: current,
      userId: user.id,
      role: effectiveRole,
      session,
    });

    await registerAuditLog({
      entityType: 'ACTIVITY',
      entityId: current._id,
      action: 'ACTIVITY_UPDATED',
      performedBy: user.id,
      campusId: current.campusId,
      payloadSnapshot: {
        status: current.status,
        amount: roundMoney(toMoney(current.amount)),
        participantsSeeded: createdCount,
      },
    });

    return current;
  });

  return {
    activity: buildActivityCard(updated.toObject ? updated.toObject() : updated, campus),
  };
}

export async function listActivitiesService({ filters, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  if (!effectiveRole) throw new ApiError(403, 'Rol no autorizado para actividades');

  const scoped = getScopedCampusCodes(campusScope);
  const where = {};

  if (!scoped.includes('ALL')) {
    const campuses = await Campus.find({ code: { $in: scoped } }).select('_id').lean();
    where.campusId = { $in: campuses.map((row) => row._id) };
  }

  if (filters.campus) {
    await assertCampusAllowed(filters.campus, campusScope);
    const campus = await resolveCampusByCode(filters.campus);
    where.campusId = campus._id;
  }
  if (filters.status) where.status = filters.status;
  if (filters.q) where.name = buildAccentInsensitiveRegex(filters.q);

  if (effectiveRole === 'AUXILIAR') {
    where.status = 'ACTIVE';
    where.allowAuxiliarCollection = true;
  }
  if (effectiveRole === 'SECRETARY' && !filters.status) {
    where.status = { $in: ['ACTIVE', 'CLOSED'] };
  }

  const activities = await Activity.find(where)
    .sort({ status: 1, createdAt: -1, _id: -1 })
    .limit(filters.limit || 20)
    .lean();

  const campusIds = [...new Set(activities.map((row) => String(row.campusId)).filter(Boolean))];
  const campuses = campusIds.length
    ? await Campus.find({ _id: { $in: campusIds } }).select('_id code name').lean()
    : [];
  const campusMap = new Map(campuses.map((row) => [String(row._id), row]));

  const summaries = await Promise.all(activities.map((activity) => buildActivitySummary(activity._id)));

  return {
    items: activities.map((activity, index) => ({
      ...buildActivityCard(activity, campusMap.get(String(activity.campusId))),
      summary: summaries[index],
    })),
  };
}

async function buildParticipantCards(activity, participants) {
  const studentIds = participants.map((row) => row.studentId).filter(Boolean);
  const collectionIds = participants.map((row) => row.latestCollectionId).filter(Boolean);

  const students = studentIds.length
    ? await Student.find({ _id: { $in: studentIds } })
      .populate({ path: 'personId', select: 'names lastNames dni' })
      .select('_id internalCode bankCode personId')
      .lean()
    : [];
  const studentMap = new Map(students.map((row) => [String(row._id), row]));

  const collections = collectionIds.length
    ? await ActivityCollection.find({ _id: { $in: collectionIds } })
      .select('_id amount method collectedAt receiptInternalCode collectorUserId collectorRole')
      .lean()
    : [];
  const collectionMap = new Map(collections.map((row) => [String(row._id), row]));

  const collectorIds = [...new Set(collections.map((row) => String(row.collectorUserId)).filter(Boolean))];
  const collectors = collectorIds.length
    ? await User.find({ _id: { $in: collectorIds } })
      .populate({ path: 'personId', select: 'names lastNames' })
      .select('_id personId email')
      .lean()
    : [];
  const collectorMap = new Map(collectors.map((row) => [String(row._id), row]));

  const vacancies = studentIds.length
    ? await Vacancy.find({
      studentId: { $in: studentIds },
      cycleId: activity.cycleId,
    })
      .populate({ path: 'classroomId', select: '_id displayName level grade section' })
      .select('studentId classroomId')
      .lean()
    : [];
  const vacancyMap = new Map(vacancies.map((row) => [String(row.studentId), row]));

  return participants.map((participant) => {
    const student = studentMap.get(String(participant.studentId)) || {};
    const person = student.personId || {};
    const vacancy = vacancyMap.get(String(participant.studentId));
    const classroom = vacancy?.classroomId || null;
    const latestCollection = participant.latestCollectionId ? collectionMap.get(String(participant.latestCollectionId)) : null;
    const collector = latestCollection?.collectorUserId ? collectorMap.get(String(latestCollection.collectorUserId)) : null;

    return {
      id: String(participant._id),
      activityId: String(activity._id),
      status: participant.status,
      notes: participant.notes || null,
      registeredAt: participant.registeredAt || null,
      registeredByUserId: participant.registeredByUserId ? String(participant.registeredByUserId) : null,
      registeredByRole: participant.registeredByRole || null,
      paidAt: participant.paidAt || latestCollection?.collectedAt || null,
      student: {
        id: student._id ? String(student._id) : null,
        internalCode: student.internalCode || null,
        bankCode: student.bankCode || null,
        names: person.names || null,
        lastNames: person.lastNames || null,
        dni: person.dni || null,
        classroomId: classroom?._id ? String(classroom._id) : null,
        classroomDisplayName: classroom?.displayName || null,
      },
      latestCollection: latestCollection
        ? {
            id: String(latestCollection._id),
            receiptInternalCode: latestCollection.receiptInternalCode,
            amount: roundMoney(toMoney(latestCollection.amount)),
            method: latestCollection.method,
            methodLabel: mapMethodLabel(latestCollection.method),
            collectedAt: latestCollection.collectedAt,
            collectorRole: latestCollection.collectorRole,
            collectorUserId: latestCollection.collectorUserId ? String(latestCollection.collectorUserId) : null,
            collectorName: collector?.personId
              ? [collector.personId.lastNames, collector.personId.names].filter(Boolean).join(', ')
              : collector?.email || null,
          }
        : null,
    };
  });
}

async function buildCollectorReport(activityId) {
  const rows = await ActivityCollection.aggregate([
    { $match: { activityId: new mongoose.Types.ObjectId(activityId), isVoided: false } },
    {
      $group: {
        _id: {
          collectorUserId: '$collectorUserId',
          collectorRole: '$collectorRole',
        },
        totalAmount: { $sum: { $toDouble: '$amount' } },
        collectionsCount: { $sum: 1 },
        studentIds: { $addToSet: '$studentId' },
      },
    },
    { $sort: { totalAmount: -1, collectionsCount: -1 } },
  ]);

  const userIds = [...new Set(rows.map((row) => String(row._id.collectorUserId)).filter(Boolean))];
  const studentIds = [...new Set(rows.flatMap((row) => row.studentIds || []).map((id) => String(id)).filter(Boolean))];

  const [users, students] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
        .populate({ path: 'personId', select: 'names lastNames' })
        .select('_id personId email')
        .lean()
      : [],
    studentIds.length
      ? Student.find({ _id: { $in: studentIds } })
        .populate({ path: 'personId', select: 'names lastNames dni' })
        .select('_id internalCode personId')
        .lean()
      : [],
  ]);

  const userMap = new Map(users.map((row) => [String(row._id), row]));
  const studentMap = new Map(students.map((row) => [String(row._id), row]));

  return rows.map((row) => {
    const user = userMap.get(String(row._id.collectorUserId));
    return {
      collectorUserId: String(row._id.collectorUserId),
      collectorRole: row._id.collectorRole,
      collectorName: user?.personId
        ? [user.personId.lastNames, user.personId.names].filter(Boolean).join(', ')
        : user?.email || 'Usuario',
      totalAmount: roundMoney(row.totalAmount || 0),
      collectionsCount: Number(row.collectionsCount || 0),
      students: (row.studentIds || []).map((studentId) => {
        const student = studentMap.get(String(studentId));
        return {
          id: String(studentId),
          internalCode: student?.internalCode || null,
          names: student?.personId?.names || null,
          lastNames: student?.personId?.lastNames || null,
          dni: student?.personId?.dni || null,
        };
      }).sort((a, b) => String(a.lastNames || '').localeCompare(String(b.lastNames || ''), 'es')),
    };
  });
}

async function buildRegistrationReport(activityId) {
  const rows = await ActivityParticipant.aggregate([
    { $match: { activityId: new mongoose.Types.ObjectId(activityId) } },
    {
      $group: {
        _id: {
          registeredByUserId: '$registeredByUserId',
          registeredByRole: '$registeredByRole',
        },
        participantsCount: { $sum: 1 },
        studentIds: { $addToSet: '$studentId' },
      },
    },
    { $sort: { participantsCount: -1 } },
  ]);

  const userIds = [...new Set(rows.map((row) => String(row._id.registeredByUserId)).filter(Boolean))];
  const studentIds = [...new Set(rows.flatMap((row) => row.studentIds || []).map((id) => String(id)).filter(Boolean))];

  const [users, students] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
        .populate({ path: 'personId', select: 'names lastNames' })
        .select('_id personId email')
        .lean()
      : [],
    studentIds.length
      ? Student.find({ _id: { $in: studentIds } })
        .populate({ path: 'personId', select: 'names lastNames dni' })
        .select('_id internalCode personId')
        .lean()
      : [],
  ]);

  const userMap = new Map(users.map((row) => [String(row._id), row]));
  const studentMap = new Map(students.map((row) => [String(row._id), row]));

  return rows.map((row) => {
    const user = userMap.get(String(row._id.registeredByUserId));
    return {
      registeredByUserId: String(row._id.registeredByUserId),
      registeredByRole: row._id.registeredByRole,
      registeredByName: user?.personId
        ? [user.personId.lastNames, user.personId.names].filter(Boolean).join(', ')
        : user?.email || 'Usuario',
      participantsCount: Number(row.participantsCount || 0),
      students: (row.studentIds || []).map((studentId) => {
        const student = studentMap.get(String(studentId));
        return {
          id: String(studentId),
          internalCode: student?.internalCode || null,
          names: student?.personId?.names || null,
          lastNames: student?.personId?.lastNames || null,
          dni: student?.personId?.dni || null,
        };
      }).sort((a, b) => String(a.lastNames || '').localeCompare(String(b.lastNames || ''), 'es')),
    };
  });
}

async function buildCollectionsList(activityId) {
  const collections = await ActivityCollection.find({ activityId, isVoided: false })
    .sort({ collectedAt: -1, _id: -1 })
    .lean();

  const userIds = [...new Set(collections.map((row) => String(row.collectorUserId)).filter(Boolean))];
  const studentIds = [...new Set(collections.map((row) => String(row.studentId)).filter(Boolean))];

  const [users, students] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
        .populate({ path: 'personId', select: 'names lastNames' })
        .select('_id personId email')
        .lean()
      : [],
    studentIds.length
      ? Student.find({ _id: { $in: studentIds } })
        .populate({ path: 'personId', select: 'names lastNames dni' })
        .select('_id internalCode personId')
        .lean()
      : [],
  ]);

  const userMap = new Map(users.map((row) => [String(row._id), row]));
  const studentMap = new Map(students.map((row) => [String(row._id), row]));

  return collections.map((collection) => {
    const user = userMap.get(String(collection.collectorUserId));
    const student = studentMap.get(String(collection.studentId));
    return {
      id: String(collection._id),
      receiptInternalCode: collection.receiptInternalCode,
      amount: roundMoney(toMoney(collection.amount)),
      method: collection.method,
      methodLabel: mapMethodLabel(collection.method),
      collectedAt: collection.collectedAt,
      notes: collection.notes || null,
      collectorUserId: String(collection.collectorUserId),
      collectorRole: collection.collectorRole,
      collectorName: user?.personId
        ? [user.personId.lastNames, user.personId.names].filter(Boolean).join(', ')
        : user?.email || 'Usuario',
      student: {
        id: String(collection.studentId),
        internalCode: student?.internalCode || null,
        names: student?.personId?.names || null,
        lastNames: student?.personId?.lastNames || null,
        dni: student?.personId?.dni || null,
      },
    };
  });
}

export async function getActivityDetailService({ activityId, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  if (!effectiveRole) throw new ApiError(403, 'Rol no autorizado para actividades');

  const activity = await getActivityOrThrow(activityId);
  const campus = await Campus.findById(activity.campusId).select('_id code name').lean();
  await assertCampusAllowed(campus.code, campusScope);

  if (effectiveRole === 'AUXILIAR' && !activity.allowAuxiliarCollection) {
    throw new ApiError(403, 'Tu rol activo no puede operar esta actividad');
  }
  if (effectiveRole === 'SECRETARY' && !activity.allowSecretaryCollection && activity.status === 'ACTIVE') {
    throw new ApiError(403, 'Tu rol activo no puede operar esta actividad');
  }

  const [summary, participantsRaw, collections, collectorReport, registrationReport] = await Promise.all([
    buildActivitySummary(activity._id),
    ActivityParticipant.find({ activityId: activity._id }).sort({ status: 1, updatedAt: -1 }).lean(),
    buildCollectionsList(activity._id),
    buildCollectorReport(activity._id),
    buildRegistrationReport(activity._id),
  ]);

  const participants = await buildParticipantCards(activity, participantsRaw);

  return {
    activity: buildActivityCard(activity, campus),
    summary,
    participants,
    collections,
    collectorReport,
    registrationReport,
    permissions: {
      canManage: effectiveRole === 'ADMIN',
      canCollect:
        (effectiveRole === 'ADMIN' && activity.allowAdminCollection) ||
        (effectiveRole === 'SECRETARY' && activity.allowSecretaryCollection) ||
        (effectiveRole === 'AUXILIAR' && activity.allowAuxiliarCollection),
    },
  };
}

export async function getActivityParticipantsService({ activityId, filters, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  if (!effectiveRole) throw new ApiError(403, 'Rol no autorizado para actividades');

  const activity = await getActivityOrThrow(activityId);
  const campus = await Campus.findById(activity.campusId).select('_id code').lean();
  await assertCampusAllowed(campus.code, campusScope);

  const where = { activityId: activity._id };
  if (filters.status) where.status = filters.status;

  const participantRows = await ActivityParticipant.find(where)
    .sort({ status: 1, updatedAt: -1 })
    .limit(filters.limit || 50)
    .lean();

  let cards = await buildParticipantCards(activity, participantRows);
  if (filters.q) {
    const normalized = normalizeSearchTerm(filters.q);
    cards = cards.filter((item) => {
      const haystack = normalizeSearchTerm([
        item.student?.internalCode,
        item.student?.bankCode,
        item.student?.dni,
        item.student?.lastNames,
        item.student?.names,
      ].filter(Boolean).join(' '));
      return haystack.includes(normalized);
    });
  }

  return { items: cards };
}

export async function addActivityParticipantService({ activityId, payload, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  if (!['ADMIN', 'SECRETARY'].includes(effectiveRole)) {
    throw new ApiError(403, 'Tu rol activo no puede inscribir alumnos en actividades');
  }

  const activity = await Activity.findById(activityId);
  if (!activity) throw new ApiError(404, 'Actividad no encontrada');

  const campus = await Campus.findById(activity.campusId).select('_id code name').lean();
  await assertCampusAllowed(campus.code, campusScope);
  await assertStudentMatchesAudience({ activity, studentId: payload.studentId });

  const participant = await runInTransaction(async (session) => {
    const existing = await ActivityParticipant.findOne({
      activityId: activity._id,
      studentId: payload.studentId,
    }).session(session);

    if (existing) return existing;

    const [created] = await ActivityParticipant.create([{
      activityId: activity._id,
      studentId: payload.studentId,
      status: 'PENDING',
      registeredByUserId: user.id,
      registeredByRole: effectiveRole,
      registeredAt: new Date(),
      notes: payload.notes || undefined,
    }], { session });

    await registerAuditLog({
      entityType: 'ACTIVITY',
      entityId: activity._id,
      action: 'ACTIVITY_PARTICIPANT_REGISTERED',
      performedBy: user.id,
      campusId: activity.campusId,
      payloadSnapshot: {
        participantId: created._id,
        studentId: payload.studentId,
        role: effectiveRole,
      },
    });

    return created;
  });

  const cards = await buildParticipantCards(activity, [participant.toObject ? participant.toObject() : participant]);
  return { participant: cards[0] || null };
}

export async function createActivityCollectionService({ activityId, payload, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  if (!effectiveRole) throw new ApiError(403, 'Rol no autorizado para actividades');

  const activity = await Activity.findById(activityId);
  if (!activity) throw new ApiError(404, 'Actividad no encontrada');

  const campus = await Campus.findById(activity.campusId).select('_id code name').lean();
  await assertCampusAllowed(campus.code, campusScope);
  assertCollectionAllowed(activity, effectiveRole);
  await assertStudentMatchesAudience({ activity, studentId: payload.studentId });

  const created = await runInTransaction(async (session) => {
    let participant = await ActivityParticipant.findOne({
      activityId: activity._id,
      studentId: payload.studentId,
    }).session(session);

    if (!participant) {
      [participant] = await ActivityParticipant.create([{
        activityId: activity._id,
        studentId: payload.studentId,
        status: 'PENDING',
        registeredByUserId: user.id,
        registeredByRole: effectiveRole,
        registeredAt: new Date(),
      }], { session });
    }

    if (participant.status === 'PAID') {
      throw new ApiError(409, 'El alumno ya pagó esta activity');
    }

    const amount = roundMoney(payload.amount ?? toMoney(activity.amount));
    if (amount <= 0) throw new ApiError(400, 'Monto de cobro invalido');

    const receiptInternalCode = await nextActivityReceiptInternalCode(session);

    const [collection] = await ActivityCollection.create([{
      activityId: activity._id,
      participantId: participant._id,
      studentId: payload.studentId,
      campusId: activity.campusId,
      collectorUserId: user.id,
      collectorRole: effectiveRole,
      amount: toDecimal(amount),
      method: payload.method,
      collectedAt: payload.collectedAt || new Date(),
      receiptInternalCode,
      notes: payload.notes || undefined,
      isVoided: false,
    }], { session });

    participant.status = 'PAID';
    participant.paidAt = collection.collectedAt;
    participant.latestCollectionId = collection._id;
    await participant.save({ session });

    await registerAuditLog({
      entityType: 'ACTIVITY_COLLECTION',
      entityId: collection._id,
      action: 'ACTIVITY_COLLECTION_CREATED',
      performedBy: user.id,
      campusId: activity.campusId,
      payloadSnapshot: {
        activityId: activity._id,
        studentId: payload.studentId,
        collectorRole: effectiveRole,
        amount,
        receiptInternalCode,
      },
    });

    return { collection };
  });

  const student = await Student.findById(payload.studentId)
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .select('_id internalCode bankCode personId')
    .lean();

  return {
    collection: {
      id: String(created.collection._id),
      receiptInternalCode: created.collection.receiptInternalCode,
      amount: roundMoney(toMoney(created.collection.amount)),
      method: created.collection.method,
      methodLabel: mapMethodLabel(created.collection.method),
      collectedAt: created.collection.collectedAt,
      notes: created.collection.notes || null,
      collectorRole: created.collection.collectorRole,
      student: {
        id: String(student?._id || payload.studentId),
        internalCode: student?.internalCode || null,
        bankCode: student?.bankCode || null,
        names: student?.personId?.names || null,
        lastNames: student?.personId?.lastNames || null,
        dni: student?.personId?.dni || null,
      },
      activity: {
        id: String(activity._id),
        name: activity.name,
        amount: roundMoney(toMoney(activity.amount)),
      },
    },
  };
}

export async function updateActivityCollectionService({ collectionId, payload, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  assertManageAllowed(effectiveRole);

  const collection = await ActivityCollection.findById(collectionId);
  if (!collection) throw new ApiError(404, 'Cobro no encontrado');

  const activity = await Activity.findById(collection.activityId);
  if (!activity) throw new ApiError(404, 'Actividad no encontrada');

  const campus = await Campus.findById(collection.campusId).select('_id code name').lean();
  await assertCampusAllowed(campus.code, campusScope);
  await assertStudentMatchesAudience({ activity, studentId: payload.studentId });

  const collectorUser = await User.findById(payload.collectorUserId)
    .populate({ path: 'personId', select: 'names lastNames' })
    .select('_id personId email roles campusScope isActive')
    .lean();

  if (!collectorUser || !collectorUser.isActive) {
    throw new ApiError(404, 'Cobrador no encontrado');
  }

  const collectorRole = resolveCollectorRoleFromUser(collectorUser, collection.collectorRole);
  if (!collectorRole) {
    throw new ApiError(400, 'El usuario seleccionado no puede cobrar actividades');
  }

  const collectorCampusScope = Array.isArray(collectorUser.campusScope) ? collectorUser.campusScope.map(String) : [];
  if (!collectorCampusScope.includes('ALL') && !collectorCampusScope.includes(campus.code)) {
    throw new ApiError(400, 'El cobrador no tiene acceso al campus de la actividad');
  }

  const updated = await runInTransaction(async (session) => {
    const currentParticipant = await ActivityParticipant.findById(collection.participantId).session(session);
    if (!currentParticipant) throw new ApiError(404, 'Participante no encontrado');

    let targetParticipant = await ActivityParticipant.findOne({
      activityId: activity._id,
      studentId: payload.studentId,
    }).session(session);

    const movingStudent = String(currentParticipant.studentId) !== String(payload.studentId);

    if (!targetParticipant) {
      [targetParticipant] = await ActivityParticipant.create([{
        activityId: activity._id,
        studentId: payload.studentId,
        status: 'PENDING',
        registeredByUserId: user.id,
        registeredByRole: effectiveRole,
        registeredAt: new Date(),
      }], { session });
    }

    if (movingStudent && String(targetParticipant._id) !== String(currentParticipant._id) && targetParticipant.status === 'PAID') {
      throw new ApiError(409, 'El alumno seleccionado ya figura como pagado en esta actividad');
    }

    const amount = roundMoney(payload.amount);
    if (amount <= 0) throw new ApiError(400, 'Monto de cobro invalido');

    collection.studentId = payload.studentId;
    collection.participantId = targetParticipant._id;
    collection.collectorUserId = collectorUser._id;
    collection.collectorRole = collectorRole;
    collection.amount = toDecimal(amount);
    await collection.save({ session });

    targetParticipant.studentId = payload.studentId;
    targetParticipant.status = 'PAID';
    targetParticipant.paidAt = collection.collectedAt;
    targetParticipant.latestCollectionId = collection._id;
    await targetParticipant.save({ session });

    if (String(currentParticipant._id) !== String(targetParticipant._id)) {
      currentParticipant.status = 'PENDING';
      currentParticipant.paidAt = null;
      currentParticipant.latestCollectionId = null;
      await currentParticipant.save({ session });
    }

    await registerAuditLog({
      entityType: 'ACTIVITY_COLLECTION',
      entityId: collection._id,
      action: 'ACTIVITY_COLLECTION_UPDATED',
      performedBy: user.id,
      campusId: activity.campusId,
      payloadSnapshot: {
        activityId: activity._id,
        studentId: payload.studentId,
        collectorUserId: collectorUser._id,
        collectorRole,
        amount,
      },
    });

    return { collection, targetParticipant };
  });

  const student = await Student.findById(updated.collection.studentId)
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .select('_id internalCode bankCode personId')
    .lean();

  return {
    collection: {
      id: String(updated.collection._id),
      receiptInternalCode: updated.collection.receiptInternalCode,
      amount: roundMoney(toMoney(updated.collection.amount)),
      method: updated.collection.method,
      methodLabel: mapMethodLabel(updated.collection.method),
      collectedAt: updated.collection.collectedAt,
      notes: updated.collection.notes || null,
      collectorRole,
      collectorUserId: String(collectorUser._id),
      collectorName: collectorUser?.personId
        ? [collectorUser.personId.lastNames, collectorUser.personId.names].filter(Boolean).join(', ')
        : collectorUser?.email || null,
      student: {
        id: String(student?._id || payload.studentId),
        internalCode: student?.internalCode || null,
        bankCode: student?.bankCode || null,
        names: student?.personId?.names || null,
        lastNames: student?.personId?.lastNames || null,
        dni: student?.personId?.dni || null,
      },
      activity: {
        id: String(activity._id),
        name: activity.name,
        amount: roundMoney(toMoney(activity.amount)),
      },
    },
  };
}

export async function getActivityReportService({ activityId, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  assertManageAllowed(effectiveRole);

  const activity = await getActivityOrThrow(activityId);
  const campus = await Campus.findById(activity.campusId).select('_id code name').lean();
  await assertCampusAllowed(campus.code, campusScope);

  const [summary, collectorReport, registrationReport, collections] = await Promise.all([
    buildActivitySummary(activity._id),
    buildCollectorReport(activity._id),
    buildRegistrationReport(activity._id),
    buildCollectionsList(activity._id),
  ]);

  return {
    activity: buildActivityCard(activity, campus),
    summary,
    collectorReport,
    registrationReport,
    collections,
  };
}

export async function searchActivityStudentsService({ filters, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  if (!['ADMIN', 'SECRETARY', 'AUXILIAR'].includes(effectiveRole)) {
    throw new ApiError(403, 'Rol no autorizado para buscar alumnos');
  }

  if (filters.campus) {
    await assertCampusAllowed(filters.campus, campusScope);
  }

  const regex = buildAccentInsensitiveRegex(filters.q);
  const people = await Person.find({
    $or: [{ names: regex }, { lastNames: regex }, { dni: regex }],
  }).select('_id').limit(filters.limit * 4).lean();

  const where = {
    $or: [
      { internalCode: regex },
      { bankCode: regex },
      ...(people.length ? [{ personId: { $in: people.map((row) => row._id) } }] : []),
    ],
  };

  const students = await Student.find(where)
    .limit(filters.limit * 4)
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .select('_id internalCode bankCode personId')
    .lean();

  const cycle = await resolveCurrentCycle();
  const studentIds = students.map((row) => row._id);
  const vacancies = studentIds.length
    ? await Vacancy.find({ studentId: { $in: studentIds }, cycleId: cycle._id })
      .populate({
        path: 'classroomId',
        select: 'displayName campusId level grade section',
        populate: { path: 'campusId', select: 'code name' },
      })
      .select('studentId classroomId')
      .lean()
    : [];

  const vacancyMap = new Map(vacancies.map((row) => [String(row.studentId), row]));

  const filtered = students
    .map((student) => {
      const vacancy = vacancyMap.get(String(student._id));
      const classroom = vacancy?.classroomId || null;
      const campusCode = classroom?.campusId?.code || null;
      return {
        id: String(student._id),
        internalCode: student.internalCode || null,
        bankCode: student.bankCode || null,
        names: student.personId?.names || null,
        lastNames: student.personId?.lastNames || null,
        dni: student.personId?.dni || null,
        campusCode,
        classroomDisplayName: classroom?.displayName || null,
      };
    })
    .filter((student) => {
      if (!filters.campus) return true;
      return student.campusCode === filters.campus;
    })
    .sort((a, b) => {
      const aLast = String(a.lastNames || '');
      const bLast = String(b.lastNames || '');
      if (aLast !== bLast) return aLast.localeCompare(bLast, 'es');
      const aNames = String(a.names || '');
      const bNames = String(b.names || '');
      return aNames.localeCompare(bNames, 'es');
    })
    .slice(0, filters.limit);

  return { items: filtered };
}

export async function searchActivityCollectorsService({ filters, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  assertManageAllowed(effectiveRole);

  if (filters.campus) {
    await assertCampusAllowed(filters.campus, campusScope);
  }

  const regex = buildAccentInsensitiveRegex(filters.q);
  const people = await Person.find({
    $or: [{ names: regex }, { lastNames: regex }],
  }).select('_id').limit(filters.limit * 4).lean();

  const users = await User.find({
    isActive: true,
    roles: { $in: ['ADMIN', 'SECRETARY', 'AUXILIAR'] },
    $or: [
      { email: regex },
      ...(people.length ? [{ personId: { $in: people.map((row) => row._id) } }] : []),
    ],
  })
    .populate({ path: 'personId', select: 'names lastNames' })
    .select('_id personId email roles campusScope')
    .limit(filters.limit * 4)
    .lean();

  const filtered = users
    .filter((row) => {
      const rowCampusScope = Array.isArray(row.campusScope) ? row.campusScope.map(String) : [];
      if (!filters.campus) return true;
      return rowCampusScope.includes('ALL') || rowCampusScope.includes(filters.campus);
    })
    .map((row) => ({
      id: String(row._id),
      name: row?.personId
        ? [row.personId.lastNames, row.personId.names].filter(Boolean).join(', ')
        : row.email,
      email: row.email,
      collectorRole: resolveCollectorRoleFromUser(row) || null,
      roles: Array.isArray(row.roles) ? row.roles : [],
      campusScope: Array.isArray(row.campusScope) ? row.campusScope : [],
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
    .slice(0, filters.limit);

  return { items: filtered };
}

export async function getActivityCollectionReceiptService({ collectionId, user, activeRole, campusScope = [] }) {
  const effectiveRole = resolveEffectiveRole(user, activeRole);
  if (!['ADMIN', 'SECRETARY', 'AUXILIAR'].includes(effectiveRole)) {
    throw new ApiError(403, 'Rol no autorizado');
  }

  const collection = await ActivityCollection.findById(collectionId).lean();
  if (!collection) throw new ApiError(404, 'Cobro no encontrado');

  const activity = await Activity.findById(collection.activityId).lean();
  if (!activity) throw new ApiError(404, 'Actividad no encontrada');

  const campus = await Campus.findById(collection.campusId).select('_id code name').lean();
  await assertCampusAllowed(campus.code, campusScope);

  const [student, collector] = await Promise.all([
    Student.findById(collection.studentId)
      .populate({ path: 'personId', select: 'names lastNames dni' })
      .select('_id internalCode bankCode personId')
      .lean(),
    User.findById(collection.collectorUserId)
      .populate({ path: 'personId', select: 'names lastNames' })
      .select('_id personId email')
      .lean(),
  ]);

  return {
    collection: {
      id: String(collection._id),
      receiptInternalCode: collection.receiptInternalCode,
      amount: roundMoney(toMoney(collection.amount)),
      method: collection.method,
      methodLabel: mapMethodLabel(collection.method),
      collectedAt: collection.collectedAt,
      notes: collection.notes || null,
      collectorRole: collection.collectorRole,
      collectorName: collector?.personId
        ? [collector.personId.lastNames, collector.personId.names].filter(Boolean).join(', ')
        : collector?.email || null,
    },
    student: {
      id: String(student?._id || collection.studentId),
      internalCode: student?.internalCode || null,
      bankCode: student?.bankCode || null,
      names: student?.personId?.names || null,
      lastNames: student?.personId?.lastNames || null,
      dni: student?.personId?.dni || null,
    },
    activity: {
      id: String(activity._id),
      name: activity.name,
      typeLabel: mapActivityTypeLabel(activity.type),
      amount: roundMoney(toMoney(activity.amount)),
      campus: { code: campus.code, name: campus.name },
    },
  };
}
