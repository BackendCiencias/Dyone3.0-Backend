const PAYMENT_WRITE_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];
const PAYMENT_READ_ROLES = [...PAYMENT_WRITE_ROLES, 'SECRETARY_VIEWER', 'AUXILIAR'];

export const moduleEndpointMetadata = [
  { method: 'POST', path: '/api/payments', module: 'payments', authRequired: true, rolesAllowed: PAYMENT_WRITE_ROLES, description: 'Registrar pago', requestSchema: { body: 'paymentCreateSchema' }, responseSchema: 'Payment' },
  { method: 'GET', path: '/api/payments/debtors', module: 'payments', authRequired: true, rolesAllowed: PAYMENT_READ_ROLES, description: 'Listar cartera de pagos paginada', requestSchema: { query: { campusId: 'ObjectId?', cycleId: 'ObjectId?', onlyOverdue: 'boolean?', page: 'number?', limit: 'number?' } }, responseSchema: { conceptColumns: 'array', items: 'array', pageInfo: 'object' } },
  { method: 'GET', path: '/api/payments/debtors/search', module: 'payments', authRequired: true, rolesAllowed: PAYMENT_READ_ROLES, description: 'Buscar alumnos para caja/pagos', requestSchema: { query: { campusId: 'ObjectId?', cycleId: 'ObjectId?', q: 'string', limit: 'number?' } }, responseSchema: { conceptColumns: 'array', items: 'array' } },
];
