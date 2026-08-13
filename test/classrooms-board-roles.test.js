import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { moduleEndpointMetadata } from '../src/modules/classrooms/classrooms.metadata.js';

test('SECRETARY puede consultar el tablero global de salones', () => {
  const boardEndpoint = moduleEndpointMetadata.find(
    (endpoint) => endpoint.method === 'GET' && endpoint.path === '/api/classrooms/board',
  );

  assert.ok(boardEndpoint);
  assert.ok(boardEndpoint.rolesAllowed.includes('SECRETARY'));

  const routesSource = fs.readFileSync(
    new URL('../src/modules/classrooms/classrooms.routes.js', import.meta.url),
    'utf8',
  );
  assert.match(
    routesSource,
    /router\.get\('\/board', requireRoles\(\[[^\]]*'SECRETARY'[^\]]*\]\)/,
  );
});
