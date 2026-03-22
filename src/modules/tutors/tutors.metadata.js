const TUTOR_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];

export const moduleEndpointMetadata = [
  { method: 'GET', path: '/api/tutors/search', module: 'tutors', authRequired: true, rolesAllowed: TUTOR_ROLES, description: 'Buscar personas que pueden actuar como tutores, incluyendo tutores ya vinculados y tutores sueltos', requestSchema: { query: 'tutorSearchQuerySchema' }, responseSchema: { items: 'array', nextCursor: 'null' } },
  { method: 'POST', path: '/api/tutors', module: 'tutors', authRequired: true, rolesAllowed: TUTOR_ROLES, description: 'Crear o actualizar uno o varios vínculos tutor-estudiante', requestSchema: { body: 'tutorCreateSchema' }, responseSchema: { primaryTutor: 'Tutor|null', tutors: 'Tutor[]', tutorsCount: 'number' } },
  { method: 'POST', path: '/api/tutors/student/:studentId', module: 'tutors', authRequired: true, rolesAllowed: TUTOR_ROLES, description: 'Crear o actualizar vínculo tutor-estudiante usando studentId en URL', requestSchema: { params: { studentId: 'ObjectId' }, body: 'tutorCreateSchema' }, responseSchema: { primaryTutor: 'Tutor|null', tutors: 'Tutor[]', tutorsCount: 'number' } },
  { method: 'PATCH', path: '/api/tutors/:id', module: 'tutors', authRequired: true, rolesAllowed: ['ADMIN'], description: 'Actualizar tutor y persona asociada', requestSchema: { params: { id: 'ObjectId' }, body: 'tutorUpdateSchema' }, responseSchema: 'Tutor' },
  { method: 'DELETE', path: '/api/tutors/:id', module: 'tutors', authRequired: true, rolesAllowed: ['ADMIN'], description: 'Eliminar vínculo tutor-estudiante y limpiar la persona si ya no tiene vínculos', requestSchema: { params: { id: 'ObjectId' } }, responseSchema: { status: 204 } },
];
