const DASHBOARD_READ_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_VIEWER', 'AUXILIAR'];

export const moduleEndpointMetadata = [
  {
    method: 'GET',
    path: '/api/dashboard/secretary/overview',
    module: 'dashboard',
    authRequired: true,
    rolesAllowed: DASHBOARD_READ_ROLES,
    description: 'Resumen operativo del inicio para Secretaria',
    requestSchema: { query: { campus: 'string?' } },
    responseSchema: {
      summary: 'object',
      critical: 'object',
      studentsWithoutTutors: 'array',
      incompleteStudents: 'array',
      topDebtors: 'array',
      upcomingDue: 'array',
      recentActivity: 'array',
    },
  },
];
