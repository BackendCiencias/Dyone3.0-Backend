const CLASSROOM_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_VIEWER', 'AUXILIAR'];

export const moduleEndpointMetadata = [
  {
    method: 'GET',
    path: '/api/classrooms/options',
    module: 'classrooms',
    authRequired: true,
    rolesAllowed: CLASSROOM_ROLES,
    description: 'Opciones de aulas por nivel, grado opcional y campus opcional',
    requestSchema: { query: { level: 'string', grade: 'number?', campus: 'string?', includeCapacity: 'boolean?' } },
    responseSchema: {
      grade: 'number|null',
      level: 'string',
      items: [{ classroomId: 'ObjectId', label: 'string', grade: 'string|number|null', section: 'string', level: 'string', campusCode: 'string|null', capacity: 'number|null', occupied: 'number|null', available: 'number|null', status: 'OK|FULL|LOW|UNKNOWN' }],
    },
  },
  {
    method: 'GET',
    path: '/api/classrooms/board',
    module: 'classrooms',
    authRequired: true,
    rolesAllowed: ['ADMIN', 'SECRETARY', 'AUXILIAR'],
    description: 'Vista global de salones por campus, nivel y grado',
    requestSchema: { query: { campus: 'string', level: 'string', grade: 'number' } },
    responseSchema: { cycleId: 'ObjectId', campus: 'object', columns: 'array', totals: 'object' },
  },
];
