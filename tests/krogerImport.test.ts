import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  krogerConsoleSnippet,
  krogerImporter,
  parseImportPayload,
  receiptToItems,
  type KrogerImportPayload,
} from '../src/lib/krogerImport';

// Real response from POST /atlas/v1/purchase-history/v2/details (loyalty card and payment removed).
const DETAILS = JSON.parse(readFileSync(new URL('./fixtures/kroger-details.json', import.meta.url), 'utf8'));

function fakeKroger(html: string, responder: (body: unknown[]) => Response) {
  const calls: unknown[][] = [];
  const loc = { href: 'https://www.kroger.com/mypurchases', pathname: '/mypurchases' };
  vi.stubGlobal('location', loc);
  vi.stubGlobal('document', { documentElement: { innerHTML: html } });
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return responder(body);
  });
  return { loc, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('krogerImporter (runs on kroger.com)', () => {
  it('finds receipt IDs on the page, fetches details, and hands the app compact receipts', async () => {
    const { loc, calls } = fakeKroger('<a href="/mypurchases/image/011~00346~2026-09-11~504~471202">Sep 11</a>', () => new Response(JSON.stringify(DETAILS)));
    await krogerImporter('https://larder.example/');
    expect(calls).toEqual([[{ divisionNumber: '011', storeNumber: '00346', transactionDate: '2026-09-11', terminalNumber: '504', transactionId: '471202' }]]);
    expect(loc.href.startsWith('https://larder.example/#import=')).toBe(true);
    const payload = parseImportPayload(decodeURIComponent(loc.href.split('#import=')[1]))!;
    expect(payload.receipts).toHaveLength(1);
    const r = payload.receipts[0];
    expect(r).toMatchObject({ key: '011~00346~2026-09-11~504~471202', date: '2026-09-11', store: 'Howell Mill Square', total: 27.78, tax: 1.34, savings: 8.6 });
    expect(r.items.map((i) => [i.name, i.quantity, i.price])).toEqual([
      ['Everyday Living® Milkshake Straws', 1, 3.49],
      ['Tazo® Chai Skinny Latte Black Tea Concentrate', 2, 9.98],
      ['Tazo® Classic Chai Latte Black Tea Concentrate', 2, 9.98],
      ['Twinings® Earl Grey', 1, 2.99],
    ]);
    // Items after coupons + tax = receipt total
    expect(Math.round((r.items.reduce((s, i) => s + i.price, 0) + r.tax) * 100) / 100).toBe(r.total);
  });

  it('skips fuel and falls back to one receipt per request if a batch is refused', async () => {
    const html = '011~00346~2026-09-11~504~471202 011~00672~2026-08-06~118~1311119';
    const fuel = { data: { purchaseHistoryDetails: [{ purchaseType: 'FUEL', purchaseId: { receiptId: '011~00672~2026-08-06~118~1311119' }, items: [] }] } };
    const { loc, calls } = fakeKroger(html, (body) =>
      body.length > 1
        ? new Response('no', { status: 400 })
        : new Response(JSON.stringify((body[0] as { transactionId: string }).transactionId === '1311119' ? fuel : DETAILS)),
    );
    await krogerImporter('https://larder.example/');
    expect(calls.map((c) => c.length)).toEqual([2, 1, 1]);
    expect(parseImportPayload(decodeURIComponent(loc.href.split('#import=')[1]))!.receipts.map((r) => r.key)).toEqual([
      '011~00346~2026-09-11~504~471202',
    ]);
  });

  it('builds a console snippet that is valid JavaScript', () => {
    expect(() => new Function(krogerConsoleSnippet('https://larder.example/'))).not.toThrow();
  });
});

describe('receiptToItems', () => {
  const payload: KrogerImportPayload = {
    larder: 1,
    receipts: [
      {
        key: 'k',
        date: '2026-09-17',
        store: 'Kroger',
        total: 0,
        tax: 0,
        savings: 0,
        items: [
          { name: 'Ciresa Fontina Cheese', size: '1 lb', upc: '1', quantity: 1, weighted: true, unitPrice: 16, price: 5.6 },
          { name: 'Everyday Living® Milkshake Straws', size: '50 ct', upc: '2', quantity: 1, weighted: false, unitPrice: 3.49, price: 3.49 },
          { name: 'Tazo® Classic Chai Latte Black Tea Concentrate', size: '32 fl oz', upc: '3', quantity: 2, weighted: false, unitPrice: 4.99, price: 9.98 },
        ],
      },
    ],
  };

  it('puts recent food in the pantry, with weights from price ÷ unit price, and non-food in spending only', () => {
    const [cheese, straws, chai] = receiptToItems(payload.receipts[0], '2026-09-20');
    expect(cheese).toMatchObject({ name: 'Ciresa Fontina Cheese', quantity: 0.35, unit: 'lb', price: 5.6, category: 'dairy', status: 'active' });
    expect(straws).toMatchObject({ name: 'Everyday Living Milkshake Straws', status: 'used' });
    expect(chai).toMatchObject({ quantity: 2, category: 'beverages', status: 'active' });
  });

  it('records old receipts as spending only', () => {
    const items = receiptToItems({ ...payload.receipts[0], date: '2026-07-01' }, '2026-09-25');
    expect(items.every((i) => i.status === 'used' && i.purchasedOn === '2026-07-01')).toBe(true);
  });
});
