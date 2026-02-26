const TUTOR_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];

export const moduleEndpointMetadata = [
  { method: 'POST', path: '/api/tutors', module: 'tutors', authRequired: true, rolesAllowed: TUTOR_ROLES, description: 'Crear o actualizar tutor para estudiante (body.studentId)', requestSchema: { body: 'tutorCreateSchema' }, responseSchema: 'Tutor' },
  { method: 'POST', path: '/api/tutors/student/:studentId', module: 'tutors', authRequired: true, rolesAllowed: TUTOR_ROLES, description: 'Crear o actualizar tutor por studentId en URL', requestSchema: { params: { studentId: 'ObjectId' }, body: 'tutorCreateSchema' }, responseSchema: 'Tutor' },
];
