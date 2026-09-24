import { describe, expect, it } from 'vitest';
import { planSlices } from '../src/lib/image';
import { cleanReceipt, RECEIPT_SCHEMA, validateImages } from '../server/receipt.mjs';

describe('cleanReceipt', () => {
  it('clamps bad enums, numbers and dates, and drops nameless lines', () => {
    const r = cleanReceipt({
      store: 'Kroger',
      date: '09/24/2026',
      total: 12.5,
      items: [
        { name: ' Chicken breast ', receiptText: 'KRO BNLS CHKN', category: 'poultry', location: 'fridge', quantity: 2.13, unit: 'lb', price: 8.499, isFood: true },
        { name: 'Paper towels', receiptText: 'BNTY', category: 'other', location: 'garage', quantity: -1, unit: 'roll', price: -3, isFood: false },
        { name: '', price: 1 },
        null,
      ],
    });
    expect(r.date).toBe('');
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ name: 'Chicken breast', category: 'other', quantity: 2.13, unit: 'lb', price: 8.5 });
    expect(r.items[1]).toMatchObject({ location: 'fridge', quantity: 1, unit: 'count', price: 0, isFood: false });
  });

  it('tolerates garbage', () => {
    expect(cleanReceipt(null)).toEqual({ store: '', date: '', total: 0, items: [] });
  });

  it('schema is strict for structured outputs', () => {
    const item = (RECEIPT_SCHEMA as any).properties.items.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
  });
});

describe('validateImages', () => {
  it('rejects empty, too many, and wrong types', () => {
    expect(validateImages([])).toMatch(/at least one/);
    expect(validateImages(Array(9).fill({ mediaType: 'image/jpeg', data: 'x' }))).toMatch(/At most/);
    expect(validateImages([{ mediaType: 'application/pdf', data: 'x' }])).toMatch(/JPEG/);
    expect(validateImages([{ mediaType: 'image/jpeg', data: 'x' }])).toBeNull();
  });
});

describe('planSlices', () => {
  it('leaves normal photos alone', () => {
    expect(planSlices(1000, 1500)).toEqual([[0, 1500]]);
  });

  it('splits long receipts into overlapping slices that cover everything', () => {
    const slices = planSlices(1000, 5000);
    expect(slices.length).toBe(3);
    expect(slices[0][0]).toBe(0);
    const last = slices[slices.length - 1];
    expect(last[0] + last[1]).toBe(5000);
    for (let i = 1; i < slices.length; i++) {
      // each slice starts before the previous one ends
      expect(slices[i][0]).toBeLessThan(slices[i - 1][0] + slices[i - 1][1]);
    }
    for (const [, h] of slices) expect(h).toBeLessThanOrEqual(1800);
  });
});
