import { describe, expect, it } from 'vitest';
import { cleanDigitalName, isDigitalReceipt, parseDigitalReceipt } from '../src/lib/digitalReceipt';
import { parseReceipt } from '../src/lib/receiptParser';

// Text of a real Kroger digital receipt (kroger.com order PDF), line by line as read from the page.
const KROGER_DIGITAL = `Kroger
Order Type: In Store
Order Date: Sep. 17, 2026
Order Number: 011~00335~2026-09-17~514~751431
Loyalty Card (last 4): #3560
Rewards
Total Savings: $0.95
Order Summary
Original Item Total $81.54
Item Coupons/Sales -$0.95
Sales Tax +$2.57
Order Total $83.16
Item Details 10 Items
Ciresa Fontina Cheese, 1 lb $5.60
0.35 lbs x $16.00 each
UPC: 0028648130000
Cleveland Kitchen Kimchi Pickle Chips 16 fl oz, 16 oz $2.99
1 x $2.99 each
UPC: 0085977400772
Club® Original Crackers, 13.7 oz $4.79
1 x $4.79 each
UPC: 0003010010057
Fromage d'Affinois Cheese, 1 lb $3.71
0.18 lbs x $20.61 each (approx.)
UPC: 0029647610000
Jasper Hill Cabot Clothbound Cheddar, 1 lb $8.55
0.38 lbs x $22.50 $25.00 each
Item Coupon/Sale: -$0.95
UPC: 0028648180000
Murray's Marinated Feta & Greek Pitted Olives, 5.6 oz $6.99
1 x $6.99 each
UPC: 0081794401304
Taylor Fladgate Late Bottled Vintage Port, 750 ml $23.99
1 x $23.99 each
UPC: 0008469230084
Veroni Italy Pre Sliced Antipasto Italiano, 4 oz $17.98
2 x $8.99 each
UPC: 0085408600790
Wonderful Pistachios In-Shell Seasoned Salt Flavored Nuts, 14 oz $5.99
1 x $5.99 each
UPC: 0001411370105
Payment Details TERMINAL ID 514
VISA 2573 $83.16
Alcoholic beverages fulfilled from:
Kroger`.split('\n');

describe('Kroger digital receipt', () => {
  const r = parseDigitalReceipt(KROGER_DIGITAL);

  it('is recognized as digital, and the paper parser is routed to it', () => {
    expect(isDigitalReceipt(KROGER_DIGITAL)).toBe(true);
    expect(parseReceipt(KROGER_DIGITAL).items).toHaveLength(9);
  });

  it('reads all nine lines with full names, weights and quantities', () => {
    expect(r.items.map((i) => [i.name, i.quantity, i.unit, i.price])).toEqual([
      ['Ciresa Fontina Cheese', 0.35, 'lb', 5.6],
      ['Cleveland Kitchen Kimchi Pickle Chips', 1, 'count', 2.99],
      ['Club Original Crackers', 1, 'count', 4.79],
      ["Fromage d'Affinois Cheese", 0.18, 'lb', 3.71],
      ['Jasper Hill Cabot Clothbound Cheddar', 0.38, 'lb', 8.55],
      ["Murray's Marinated Feta & Greek Pitted Olives", 1, 'count', 6.99],
      ['Taylor Fladgate Late Bottled Vintage Port', 1, 'count', 23.99],
      ['Veroni Italy Pre Sliced Antipasto Italiano', 2, 'count', 17.98],
      ['Wonderful Pistachios In-Shell Seasoned Salt Flavored Nuts', 1, 'count', 5.99],
    ]);
  });

  it('treats the coupon line as information: prices sum to item total minus coupons', () => {
    const sum = Math.round(r.items.reduce((s, i) => s + i.price, 0) * 100) / 100;
    expect(sum).toBe(80.59); // $81.54 - $0.95
    expect(r.total).toBe(83.16);
    expect(r.tax).toBe(2.57);
    expect(r.date).toBe('2026-09-17');
  });

  it('files cheese as dairy and marks names as known', () => {
    expect(r.items[0]).toMatchObject({ category: 'dairy', known: true });
  });

  it('cleans sizes and symbols from names', () => {
    expect(cleanDigitalName('Club® Original Crackers, 13.7 oz')).toBe('Club Original Crackers');
    expect(cleanDigitalName('Cleveland Kitchen Kimchi Pickle Chips 16 fl oz, 16 oz')).toBe('Cleveland Kitchen Kimchi Pickle Chips');
  });
});

describe('Kroger digital receipt PDF read by OCR (actual output)', () => {
  // Tesseract's output for the rendered pages of the same receipt ("Print to PDF" copy has no text layer).
  const OCR = `\\& Hrdger
f=  Order Type: In Store      ©   pA    IRA
Order Date: Sep. 17, 2026     4    A  Lower Roswell R
© Total Savings: $0.95
Order Summary
Original Item Total       $81.54
Item Coupons/Sales        -$0.95
Sales Tax                 +$2.57
Order Total               $83.16
Item Details              10 Items
Ciresa Fontina Cheese, 1 1b          $5.60
0.35 Ibs x $16.00 each
UPC: 0028648130000
Cleveland Kitchen Kimchi Pickle Chips 16 fl oz, 16 oz     $2.99
1x $2.99 each
UPC: 0085977400772
Fromage d'Affinois Cheese, 11b          $3.71
0.18 Ibs x $20.61 each (approx.)
Jasper Hill Cabot Clothbound Cheddar, 11b       $8.55
0.38 Ibs x $22.50 $25:66 each
Item Coupon/Sale: -$0.95
UPC: 0028648180000
Veroni Italy Pre Sliced Antipasto Italiano, 4 oz     $17.98
2x $8.99 each
Payment Details     TERMINAL ID 514
VISA 2573           $83.16`.split('\n');

  it('reads items, weights and clean names despite OCR slips', () => {
    const r = parseReceipt(OCR);
    expect(r.items.map((i) => [i.name, i.quantity, i.unit, i.price])).toEqual([
      ['Ciresa Fontina Cheese', 0.35, 'lb', 5.6],
      ['Cleveland Kitchen Kimchi Pickle Chips', 1, 'count', 2.99],
      ["Fromage d'Affinois Cheese", 0.18, 'lb', 3.71],
      ['Jasper Hill Cabot Clothbound Cheddar', 0.38, 'lb', 8.55],
      ['Veroni Italy Pre Sliced Antipasto Italiano', 2, 'count', 17.98],
    ]);
    expect(r.total).toBe(83.16);
    expect(r.date).toBe('2026-09-17');
  });
});

describe('Kroger digital receipt pasted from the website', () => {
  it('pairs a price on its own line with the name above it', () => {
    const r = parseReceipt(['Item Details', '10 Items', 'Ciresa Fontina Cheese, 1 lb', '$5.60', '0.35 lbs x $16.00 each', 'UPC: 0028648130000', 'Club® Original Crackers, 13.7 oz', '$4.79', '1 x $4.79 each', 'UPC: 0003010010057', 'Payment Details']);
    expect(r.items.map((i) => [i.name, i.quantity, i.price])).toEqual([
      ['Ciresa Fontina Cheese', 0.35, 5.6],
      ['Club Original Crackers', 1, 4.79],
    ]);
  });
});

describe('Kroger receipt copied from the web page (select all, copy)', () => {
  it('joins labels and values split across lines, so totals and tax are read', () => {
    const r = parseReceipt(['Order Date: Sep. 17, 2026', 'Order Summary', 'Sales Tax', '+$2.57', 'Order Total', '$83.16', 'Item Details', '10 Items', 'Ciresa Fontina Cheese, 1 lb', '$5.60', '0.35 lbs x $16.00 each', 'UPC: 0028648130000', 'Payment Details', 'VISA 2573', '$83.16']);
    expect(r).toMatchObject({ total: 83.16, tax: 2.57, date: '2026-09-17' });
    expect(r.items.map((i) => [i.name, i.quantity, i.price])).toEqual([['Ciresa Fontina Cheese', 0.35, 5.6]]);
  });
});
