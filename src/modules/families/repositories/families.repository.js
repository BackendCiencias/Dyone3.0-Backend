import mongoose from 'mongoose';
import { Family } from '../../../models/family.model.js';
import { Campus } from '../../../models/campus.model.js';
import { StudentCycle } from '../../../models/studentCycle.model.js';

async function resolveCampusStudentIds(campusCode) {
  if (!campusCode) return null;

  const campuses = await Campus.find({ code: campusCode }).select('_id').lean();
  if (!campuses.length) return [];

  const cycles = await StudentCycle.find({ campusId: { $in: campuses.map((c) => c._id) } })
    .select('studentId')
    .lean();

  return [...new Set(cycles.map((row) => String(row.studentId)))].map((id) => new mongoose.Types.ObjectId(id));
}

function baseFamilyQuery() {
  return Family.find()
    .populate({ path: 'studentIds', populate: { path: 'personId' } })
    .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } });
}

export async function findFamiliesList({ limit, cursor, campus }) {
  const where = {};
  const campusStudentIds = await resolveCampusStudentIds(campus);
  if (campusStudentIds && !campusStudentIds.length) return [];
  if (campusStudentIds) where.studentIds = { $in: campusStudentIds };

  if (cursor) {
    const cursorDoc = await Family.findById(cursor).select('_id updatedAt').lean();
    if (!cursorDoc) return [];
    where.$or = [
      { updatedAt: { $lt: cursorDoc.updatedAt } },
      { updatedAt: cursorDoc.updatedAt, _id: { $lt: cursorDoc._id } },
    ];
  }

  return Family.find(where)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate({ path: 'studentIds', populate: { path: 'personId' } })
    .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } })
    .lean();
}

export async function searchFamilies({ campus }) {
  const where = {};
  const campusStudentIds = await resolveCampusStudentIds(campus);
  if (campusStudentIds && !campusStudentIds.length) return [];
  if (campusStudentIds) where.studentIds = { $in: campusStudentIds };

  return Family.find(where)
    .sort({ _id: 1 })
    .populate({ path: 'studentIds', populate: { path: 'personId' } })
    .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } })
    .lean();
}

export async function findFamilyById(id) {
  return baseFamilyQuery().findOne({ _id: id }).lean();
}

export const findFamiliesBase = findFamiliesList;
export const findFamiliesForSearch = searchFamilies;
