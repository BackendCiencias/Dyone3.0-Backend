const ENROLLMENT_WRITE_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];
const ENROLLMENT_READ_ROLES = [...ENROLLMENT_WRITE_ROLES, 'SECRETARY_VIEWER', 'AUXILIAR'];

export const moduleEndpointMetadata = [
  { method: 'POST', path: '/api/enrollments/finalize', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_WRITE_ROLES, description: 'Confirmación final de matrícula V2', requestSchema: { body: 'enrollmentFinalizeSchema' }, responseSchema: { ok: 'boolean', enrollmentId: 'ObjectId', studentIds: 'ObjectId[]', status: 'string' } },
  { method: 'POST', path: '/api/enrollments/:id/confirm', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_WRITE_ROLES, description: 'Confirmar matrícula', requestSchema: { params: { id: 'ObjectId' }, body: 'enrollmentConfirmSchema' }, responseSchema: 'Enrollment' },
  { method: 'GET', path: '/api/enrollments', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Listar matrículas', requestSchema: { query: 'enrollmentListQuerySchema' }, responseSchema: { items: 'Enrollment[]', nextCursor: 'string|null' } },
  { method: 'GET', path: '/api/enrollments/classrooms/:classroomId/capacity', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Capacidad de aula por ciclo', requestSchema: { params: { classroomId: 'ObjectId' }, query: { cycleId: 'ObjectId' } }, responseSchema: { capacity: 'number', occupied: 'number', available: 'number' } },
  { method: 'GET', path: '/api/enrollments/capacity', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Capacidad agregada por campus/ciclo', requestSchema: { query: { campusId: 'ObjectId?', cycleId: 'ObjectId?' } }, responseSchema: { items: 'array' } },
  { method: 'GET', path: '/api/enrollments/:id', module: 'enrollments', authRequired: true, rolesAllowed: ENROLLMENT_READ_ROLES, description: 'Obtener matrícula por id', requestSchema: { params: { id: 'ObjectId' } }, responseSchema: 'Enrollment' },
];
