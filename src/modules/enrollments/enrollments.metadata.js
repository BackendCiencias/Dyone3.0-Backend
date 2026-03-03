const ENROLLMENT_WRITE_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];
const ENROLLMENT_READ_ROLES = [...ENROLLMENT_WRITE_ROLES, 'SECRETARY_VIEWER', 'AUXILIAR'];

export const moduleEndpointMetadata = [
  { method: 'POST', path: '/api/enrollments', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_WRITE_ROLES, description: 'Crear matrícula', requestSchema: { body: 'enrollmentCreateSchema' }, responseSchema: 'Enrollment' },
  { method: 'POST', path: '/api/enrollments/:id/confirm', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_WRITE_ROLES, description: 'Confirmar matrícula', requestSchema: { params: { id: 'ObjectId' }, body: 'enrollmentConfirmSchema' }, responseSchema: 'Enrollment' },
  { method: 'GET', path: '/api/enrollments/intake-search', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Búsqueda combinada de familias y alumnos para ventanilla (nueva matrícula)', requestSchema: { query: 'intakeSearchQuerySchema' }, responseSchema: 'intakeSearchResponseSchema' },
  { method: 'GET', path: '/api/enrollments', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Listar matrículas', requestSchema: { query: 'enrollmentListQuerySchema' }, responseSchema: { items: 'Enrollment[]', nextCursor: 'string|null' } },
  { method: 'GET', path: '/api/enrollments/classrooms/:classroomId/capacity', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Capacidad de aula por ciclo', requestSchema: { params: { classroomId: 'ObjectId' }, query: { cycleId: 'ObjectId' } }, responseSchema: { capacity: 'number', occupied: 'number', available: 'number' } },
  { method: 'GET', path: '/api/enrollments/capacity', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Capacidad agregada por campus/ciclo', requestSchema: { query: { campusId: 'ObjectId?', cycleId: 'ObjectId?' } }, responseSchema: { items: 'array' } },
  { method: 'GET', path: '/api/enrollments/:id', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Obtener matrícula por id', requestSchema: { params: { id: 'ObjectId' } }, responseSchema: 'Enrollment' },
];
