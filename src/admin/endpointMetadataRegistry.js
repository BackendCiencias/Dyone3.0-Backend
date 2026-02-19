import { moduleEndpointMetadata as studentsMetadata } from '../modules/students/students.metadata.js';
import { moduleEndpointMetadata as familiesMetadata } from '../modules/families/families.metadata.js';
import { moduleEndpointMetadata as enrollmentsMetadata } from '../modules/enrollments/enrollments.metadata.js';
import { moduleEndpointMetadata as paymentsMetadata } from '../modules/payments/payments.metadata.js';
import { moduleEndpointMetadata as adminMetadata } from '../modules/admin/admin.metadata.js';
import { moduleEndpointMetadata as tutorsMetadata } from '../modules/tutors/tutors.metadata.js';

export const allEndpointMetadata = [
  ...studentsMetadata,
  ...familiesMetadata,
  ...enrollmentsMetadata,
  ...paymentsMetadata,
  ...adminMetadata,
  ...tutorsMetadata,
];

export function validateEndpointMetadataShape(metadata = allEndpointMetadata) {
  const requiredFields = ['method', 'path', 'module'];

  for (const entry of metadata) {
    for (const field of requiredFields) {
      if (!entry?.[field]) {
        console.warn(`[endpoint-metadata] Entrada inválida: falta "${field}" en`, entry);
      }
    }
  }
}

export function warnMetadataWithoutRoute({ metadata = allEndpointMetadata, routeCatalog = [] } = {}) {
  const routeKeySet = new Set(routeCatalog.map((row) => `${row.method} ${row.path}`));
  for (const entry of metadata) {
    const key = `${entry.method} ${entry.path}`;
    if (!routeKeySet.has(key)) {
      console.warn(`[endpoint-metadata] Metadata sin ruta registrada: ${key}`);
    }
  }
}
