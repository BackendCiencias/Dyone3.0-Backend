const CLASSROOM_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_VIEWER', 'AUXILIAR'];

export const moduleEndpointMetadata = [
  {
    method: 'GET',
    path: '/api/classrooms/options',
    module: 'classrooms',
    authRequired: true,
    rolesAllowed: CLASSROOM_ROLES,
    description: 'Opciones de aulas por nivel y grado en todos los campus',
    requestSchema: { query: { level: 'string', grade: 'number', includeCapacity: 'boolean?' } },
    responseSchema: {
      grade: 'number',
      level: 'string',
      items: [{ classroomId: 'ObjectId', label: 'string', grade: 'number', section: 'string', level: 'string', campusCode: 'string', capacity: 'number|null', occupied: 'number|null', available: 'number|null', status: 'OK|FULL|LOW|UNKNOWN' }],
    },
  },
];
