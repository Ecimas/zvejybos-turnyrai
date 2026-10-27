import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eur, parseEur, validateSplit, placeAmounts, payouts, sponsorTotal } from '../../src/lib/prizes.js';

test('eurų formatas ir skaitymas', () => {
  assert.equal(eur(50000), '500 €');
  assert.equal(eur(125050), '1 250,50 €');
  assert.equal(eur(0), '0 €');
  assert.equal(parseEur('500'), 50000);
  assert.equal(parseEur('1 250,5'), 125050);
  assert.equal(parseEur('99.99'), 9999);
  assert.equal(parseEur(''), 0);
  assert.ok(Number.isNaN(parseEur('-5')));
  assert.ok(Number.isNaN(parseEur('1,234')));
  assert.ok(Number.isNaN(parseEur('abc')));
});

test('padalijimo patikra', () => {
  assert.equal(validateSplit([50, 30, 20]), null);
  assert.equal(validateSplit([100]), null);
  assert.match(validateSplit([50, 30]), /100 \(dabar 80\)/);
  assert.match(validateSplit([]), /1 iki 10/);
  assert.match(validateSplit([50.5, 49.5]), /sveikas/);
  assert.match(validateSplit([20, 30, 50]), /mažiau/);
  assert.match(validateSplit(Array(11).fill(9)), /1 iki 10/);
});

test('sumos vietoms: centai nepasimeta', () => {
  assert.deepEqual(placeAmounts(50000, [50, 30, 20]), [25000, 15000, 10000]);
  const a = placeAmounts(10001, [40, 25, 15, 12, 8]);
  assert.equal(a.reduce((x, y) => x + y, 0), 10001);
  assert.deepEqual(placeAmounts(0, [100]), []);
});

test('išmokos: lygūs rezultatai dalijasi užimtomis vietomis', () => {
  const board = [
    { user_id: 'a', rank: 1 }, { user_id: 'b', rank: 2 }, { user_id: 'c', rank: 2 }, { user_id: 'd', rank: 4 }
  ];
  const p = payouts(board, 50000, [50, 30, 20]);
  assert.equal(p.get('a'), 25000);
  assert.equal(p.get('b') + p.get('c'), 25000, '2 ir 3 vietų suma dalijama po lygiai');
  assert.equal(p.get('b'), 12500);
  assert.equal(p.has('d'), false, 'ketvirta vieta be prizo');
  const few = payouts([{ user_id: 'x', rank: 1 }], 30000, [50, 30, 20]);
  assert.equal(few.get('x'), 15000, 'nepaskirstytos vietos lieka organizatoriui');
  const hidden = payouts([{ user_id: 'x', rank: null }], 30000, [100]);
  assert.equal(hidden.size, 0, 'paslėptoje lentelėje išmokų nerodom');
});

test('rėmėjų įnašų suma', () => {
  assert.equal(sponsorTotal([{ amount_cents: 30000 }, { amount_cents: null }, { amount_cents: 5000 }]), 35000);
  assert.equal(sponsorTotal(null), 0);
});
