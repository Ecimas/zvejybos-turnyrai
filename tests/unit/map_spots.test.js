import test from 'node:test';
import assert from 'node:assert/strict';
import { spotsGeoJSON } from '../../src/lib/map.js';

test('vienoje vietoje kelios žuvys – viena žymė su skaičiumi ir didžiausios žuvies spalva', () => {
  const pts = [
    { id: 'a', lat: 54.9, lng: 24, species_id: 2, length_mm: 300 },
    { id: 'b', lat: 54.90001, lng: 24.00001, species_id: 1, length_mm: 700 },
    { id: 'c', lat: 55.5, lng: 23, species_id: 3, length_mm: 500 }
  ];
  const fc = spotsGeoJSON(pts);
  assert.equal(fc.features.length, 2);
  const big = fc.features.find((f) => f.properties.count === 2);
  assert.equal(big.properties.id, 'b');
  assert.equal(fc.features.find((f) => f.properties.count === 1).properties.id, 'c');
});
