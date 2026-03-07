export function toFamilyListItem(family = {}) {

  // console.log("[DBG] [family]: ",family)
  
  const primaryTutorRaw = (family.tutorIds || []).find((tutor) => tutor.isPrimary) || family.primaryTutor || null;

  // console.log("[DBG] [primaryTutorRaw]: ",primaryTutorRaw)

  const primaryTutor = primaryTutorRaw
    ? {
      names: primaryTutorRaw.tutorPersonId?.names || primaryTutorRaw.names || null,
      lastNames: primaryTutorRaw.tutorPersonId?.lastNames || primaryTutorRaw.lastNames || null,
      dni: primaryTutorRaw.tutorPersonId?.dni || primaryTutorRaw.dni || null,
      phone: primaryTutorRaw.tutorPersonId?.phone || primaryTutorRaw.phone || null,
    }
    : null;

  return {
    familyId: String(family._id || family.familyId),
    notes: family.notes || null,
    students: family.students || family.studentIds || [],
    studentsCount: family.studentsCount ?? family.studentIds?.length ?? 0,
    tutorsCount: family.tutorsCount ?? family.tutorIds?.length ?? 0,
    primaryTutor,
    updatedAt: family.updatedAt || family.createdAt || null,
  };
}
