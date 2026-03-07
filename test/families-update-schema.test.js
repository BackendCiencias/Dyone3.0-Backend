import test from 'node:test';
import assert from 'node:assert/strict';
import { familyUpdateSchema } from '../src/modules/families/families.schemas.js';

test('familyUpdateSchema permite actualizar address de forma parcial', () => {
  const payload = familyUpdateSchema.parse({ address: '  Ciudad Majes  ' });
  assert.equal(payload.address, 'Ciudad Majes');
});

test('familyUpdateSchema rechaza body vacío', () => {
  assert.throws(() => familyUpdateSchema.parse({}));
});
