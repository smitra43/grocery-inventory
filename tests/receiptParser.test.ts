import { describe, expect, it } from 'vitest';
import { classify, expandName, findPrice, fixUnits, normalizeKey, parseReceipt, type Alias } from '../src/lib/receiptParser';

const KROGER = `
KROGER
1234 MAIN ST CINCINNATI OH
(513) 555-0100
KRO BNLS SKNLS CHKN BRST       6.46 F
  1.62 lb @ 3.99 /lb
SC KROGER SAVINGS              1.00-F
BROCCOLI CROWNS                2.19 F
  1.10 lb @ 1.99 /lb
KRO LG EGGS 12CT               2.99 F
2 @ 1.25
KRO FRZN PEAS                  2.50 F
STRWBRY 1LB                    3.99 F
BNTY PPR TWL 6RL               9.99 T
PS GRK YGRT PLN                5.49 F
SUBTOTAL                      32.61
TAX                            0.70
**** BALANCE                  32.31
VISA                          32.31
KROGER PLUS CARD SAVINGS       1.00
TOTAL SAVINGS                  1.00
09/22/26 10:41am 00123 04 5678
`.split('\n');

describe('parseReceipt', () => {
  const r = parseReceipt(KROGER);

  it('finds the items and skips header, tax, totals and payment lines', () => {
    expect(r.items.map((i) => i.receiptText)).toEqual([
      'KRO BNLS SKNLS CHKN BRST',
      'BROCCOLI CROWNS',
      'KRO LG EGGS 12CT',
      'KRO FRZN PEAS',
      'STRWBRY 1LB',
      'BNTY PPR TWL 6RL',
      'PS GRK YGRT PLN',
    ]);
  });

  it('applies savings to the item above and reads weights and multi-buys', () => {
    const [chicken, broccoli, , peas] = r.items;
    expect(chicken).toMatchObject({ price: 5.46, quantity: 1.62, unit: 'lb', category: 'meat', location: 'fridge' });
    expect(broccoli).toMatchObject({ price: 2.19, quantity: 1.1, unit: 'lb', category: 'produce' });
    expect(peas).toMatchObject({ quantity: 2, category: 'frozen', location: 'freezer' });
  });

  it('expands abbreviations and flags non-food', () => {
    expect(r.items[0].name).toBe('Boneless skinless chicken breast');
    expect(r.items[2].name).toBe('Large eggs');
    expect(r.items[4].name).toBe('Strawberries');
    expect(r.items[5].name).toBe('Bnty paper towels');
    expect(r.items[5]).toMatchObject({ isFood: false, category: 'other' });
    expect(r.items[6]).toMatchObject({ name: 'Greek yogurt pln', category: 'dairy' });
  });

  it('reads the date and balance', () => {
    expect(r.date).toBe('2026-09-22');
    expect(r.total).toBe(32.31);
  });

  it('uses saved corrections and marks them known', () => {
    const aliases = new Map<string, Alias>([
      [normalizeKey('PS GRK YGRT PLN'), { key: '', name: 'Plain Greek yogurt', category: 'dairy', location: 'fridge' }],
    ]);
    const item = parseReceipt(KROGER, aliases).items[6];
    expect(item).toMatchObject({ name: 'Plain Greek yogurt', known: true });
    expect(r.items[6].known).toBe(false);
  });

  it('attaches a multi-buy line to the item it prices, above or below', () => {
    expect(parseReceipt(['YOGURT CUP 2.00 F', '2 @ 1.00']).items[0].quantity).toBe(2);
    expect(parseReceipt(['3 @ 0.50', 'LIMES 1.50 F']).items[0].quantity).toBe(3);
    expect(parseReceipt(['3 @ 0.50', 'LIMES 1.99 F']).items[0].quantity).toBe(1);
  });

  it('handles a name on one line and its price on the next', () => {
    const items = parseReceipt(['BANANAS', '2.13 lb @ 0.59 /lb   1.26 F']).items;
    expect(items).toEqual([expect.objectContaining({ receiptText: 'BANANAS', price: 1.26, quantity: 2.13, unit: 'lb' })]);
  });
});

describe('fixUnits', () => {
  it('repairs lb misread as 1b/Ib only in unit position', () => {
    expect(fixUnits('1.62 1b @ 3.99 /1b')).toBe('1.62 lb @ 3.99 /lb');
    expect(fixUnits('0.80 Ibs @ 2.49 / Ib')).toBe('0.80 lbs @ 2.49 / lb');
    expect(fixUnits('KRO 1B BREAD')).toBe('KRO 1B BREAD');
  });

  it('reads weight lines with a lost decimal point or @ misread as 4', () => {
    expect(parseReceipt(['CHKN BRST 6.46 F', '1 62 1b 43 99 /1b']).items[0]).toMatchObject({ quantity: 1.62, unit: 'lb', price: 6.46 });
    expect(parseReceipt(['BANANAS', '2.13 lb @ 0.59 /lb']).items[0]).toMatchObject({ quantity: 2.13, price: 1.26 });
  });

  it('lets weights parse after the fix', () => {
    const items = parseReceipt(['KRO BNLS SKNLS CHKN BRST 6.46 F', '1.62 1b @ 3.99 /1b']).items;
    expect(items[0]).toMatchObject({ quantity: 1.62, unit: 'lb' });
  });
});

describe('findPrice', () => {
  it('reads plain, flagged, and negative prices', () => {
    expect(findPrice('MILK 3.49 F')).toMatchObject({ value: 3.49, negative: false });
    expect(findPrice('SC SAVINGS 1.00-F')).toMatchObject({ value: 1, negative: true });
    expect(findPrice('MILK $3,49')).toMatchObject({ value: 3.49 });
  });

  it('reads prices whose decimal point faded out, only at the end of a line', () => {
    expect(findPrice('KRO LG EGGS 12CT 2 99 F')?.value).toBe(2.99);
    expect(findPrice('ONIONS 3')).toBeNull();
    expect(findPrice('09/22/26 10:41am 00123 04 5678')).toBeNull();
  });

  it('fixes OCR letter/digit confusions in the price only', () => {
    expect(findPrice('BREAD 2.O9 F')?.value).toBe(2.09);
    expect(findPrice('SOUP l.5O')?.value).toBe(1.5);
    expect(findPrice('ONIONS')).toBeNull();
    expect(findPrice('PS GRR YGRT PLN S 49 F')?.value).toBe(5.49);
    expect(findPrice('BhTY PPR Twl ORL 9 99 1')?.value).toBe(9.99);
    expect(findPrice('KRO BNLS 6.46 T')?.value).toBe(6.46);
  });
});

describe('classify / expandName', () => {
  it('does not confuse similar words', () => {
    expect(classify('Peanut butter').category).toBe('pantry');
    expect(classify('Chicken broth').category).toBe('pantry');
    expect(classify('Butter').category).toBe('dairy');
    expect(classify('Paper towels').isFood).toBe(false);
    expect(classify('Russet potatoes').location).toBe('pantry');
    expect(classify('Orange juice')).toMatchObject({ category: 'beverages', location: 'fridge' });
  });

  it('keeps unknown words readable', () => {
    expect(expandName('KRO GRND BF 80/20')).toBe('Ground beef');
    expect(expandName('PPR TWLS')).toBe('Paper towels');
  });
});

describe('real Safeway receipt (OCR output from a phone photo)', () => {
  // Tesseract's output for a real Safeway receipt photo, item section through the balance and
  // payment lines (store address and card lines trimmed).
  const SAFEWAY = `SAFEWAY 9
           GROCERY
SIG 100% JCE GRPFT 3.49 S
SEAFOOD
SMOKED SALMON LOX       4.99 S
\\          |       PRODUCE
1.36 1b @ $1.99 /lb     y
WT      RADISH DAIKON           2.71°S
LIQUOR
      2 QTY TRUMER PIL . 17.98 T
CRV BEER 6 PK TAX      0.60 T
Regular Price    20.98
Card Savings      3.00-
TAX                       1.72
x%%% BALANCE                31.49
SNAP BAL DUE       11.19
SNAP Purchase 05/15/19 23:17      |
SNAP Purchase              11.19
SNAP BALANCE                111.16
CASH BALANCE                  0.00`.split('\n');

  const r = parseReceipt(SAFEWAY);

  it('finds exactly the four purchases', () => {
    expect(r.items.map((i) => i.receiptText)).toEqual([
      'SIG 100% JCE GRPFT',
      'SMOKED SALMON LOX',
      'WT RADISH DAIKON',
      'TRUMER PIL .',
    ]);
  });

  it('reads the weight printed above the item, the QTY prefix, and sale prices as paid', () => {
    const [juice, lox, radish, beer] = r.items;
    expect(juice).toMatchObject({ price: 3.49, name: '100% juice grpft' });
    expect(lox).toMatchObject({ price: 4.99, category: 'seafood' });
    expect(radish).toMatchObject({ name: 'Radish daikon', price: 2.71, quantity: 1.36, unit: 'lb' });
    expect(beer).toMatchObject({ price: 17.98, quantity: 2 });
  });

  it('stops at the balance line and reads the date', () => {
    expect(r.total).toBe(31.49);
    expect(r.date).toBe('2019-05-15');
  });
});

describe('OCR slips seen on real Safeway receipts', () => {
  it('reads prices with a stray third decimal, symbol flags and trailing dots', () => {
    expect(findPrice('SIG CHEESE PARMESA      2.499 S')?.value).toBe(2.49);
    expect(findPrice('0 ORANG BLUEBERRIE     13.99 §')?.value).toBe(13.99);
    expect(findPrice('CAREFREE PANTILINE.     1.00 T.')?.value).toBe(1);
    expect(findPrice('Card Savinss      0.256-')).toMatchObject({ value: 0.25, negative: true });
  });

  it('treats misspelled Regular Price / Card Savings lines as information, and QTY lines above items', () => {
    const r = parseReceipt([
      '2 QTY',
      'SKITTLES FILLED PL.     2.38 S',
      'Regular Price     3.00',
      'Card Savinss      0.62-',
      'SIG PANTILINERS   :     0.99 T',
      'Resular Price     1.29',
      'Card Savings      0.30-',
    ]);
    expect(r.items.map((i) => [i.receiptText, i.price, i.quantity])).toEqual([
      ['SKITTLES FILLED PL.', 2.38, 2],
      ['SIG PANTILINERS :', 0.99, 1],
    ]);
    expect(r.items[1].isFood).toBe(false);
  });

  it('does not re-apply a savings line when OCR misread one digit of the sale price', () => {
    // Real: 9.89 = 11.49 - 1.60, but OCR read the item as 9.99.
    const r = parseReceipt(['TW PITCHERS RADLER.     9.99 T', 'Regular Price    11.49', 'Card Suvinps      1.60-']);
    expect(r.items[0].price).toBe(9.99);
  });

  it('does not call a radish a dish', () => {
    expect(classify('Radish daikon')).toMatchObject({ category: 'produce', isFood: true });
    expect(classify('Dish soap').isFood).toBe(false);
  });
});
