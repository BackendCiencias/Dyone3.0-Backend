const PAYMENT_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_CIENCIAS_SEC', 'SECRETARY_CIENCIAS_PRIM', 'SECRETARY_CIMAS'];

export const moduleEndpointMetadata = [
  { method: 'POST', path: '/api/payments', module: 'payments', authRequired: true, rolesAllowed: PAYMENT_ROLES, description: 'Registrar pago', requestSchema: { body: 'paymentCreateSchema' }, responseSchema: 'Payment' },
  { method: 'GET', path: '/api/payments/debtors', module: 'payments', authRequired: true, rolesAllowed: PAYMENT_ROLES, description: 'Listar deudores', requestSchema: { query: { campusId: 'ObjectId?', cycleId: 'ObjectId?', q: 'string?' } }, responseSchema: { items: 'array', totals: 'object' } },
];
