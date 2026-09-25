import { classify, normalizeKey, type Alias, type ParsedItem, type ParsedReceipt } from './receiptParser';

/**
 * Kroger's digital receipt (kroger.com → Purchases → receipt, or its PDF):
 *
 *   Ciresa Fontina Cheese, 1 lb                 $5.60
 *   0.35 lbs x $16.00 each
 *   UPC: 0028648130000
 *   Jasper Hill Cabot Clothbound Cheddar, 1 lb  $8.55
 *   0.38 lbs x $22.50 $25.00 each
 *   Item Coupon/Sale: -$0.95
 *
 * The price on the name line is already after coupons (the coupon line is information),
 * names are written out in full, and weights/quantities have their own line.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** True when the text looks like Kroger's digital receipt rather than a paper one. */
export function isDigitalReceipt(lines: string[]): boolean {
  const text = lines.join('\n');
  const upcs = (text.match(/\bUPC\s*:/gi) ?? []).length;
  const each = (text.match(/\d\s*(?:lbs?|x)\b[^\n]*\beach\b/gi) ?? []).length;
  return /item details|order summary|order total/i.test(text) || upcs >= 2 || each >= 2;
}

// "0.35 lbs x $16.00 each", "1x $2.99 each". OCR reads "lbs" as "Ibs"/"1bs".
const QTY_RE = /^\s*(\d+(?:\.\d+)?)\s*([lI1|]bs?|oz|kg|x)\s*(?:x\s*)?\$?\s*(\d+(?:\.\d{2}))/i;
const LINE_PRICE_RE = /\$\s*(\d{1,4}(?:,\d{3})*\.\d{2})\s*$/;
const STOP_RE = /^(payment details|alcoholic beverages|www\.kroger\.com)/i;
const SKIP_RE = /^\W*(upc\s*:|item coupon|coupon|sale\b|order |loyalty|rewards|total savings|original item total|item coupons|sales tax|\d+\s+items?$|item details|order summary)/i;

/** "Club® Original Crackers, 13.7 oz" → "Club Original Crackers" */
export function cleanDigitalName(raw: string): string {
  let name = raw.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim();
  // Drop a trailing size after the last comma: ", 13.7 oz", ", 750 ml", and OCR'd ", 1 1b" / ", 11b".
  const lastComma = name.lastIndexOf(',');
  if (lastComma > 0) {
    const tail = name.slice(lastComma + 1).trim();
    if (tail.length <= 12 && /\d/.test(tail) && /^[\d.\s]*[a-z]{1,5}(\s*[a-z]{1,5})?$/i.test(tail)) name = name.slice(0, lastComma);
  }
  return name.replace(/\s+[\d.]+\s*(fl oz|oz)\s*$/i, '').trim();
}

/**
 * Copied web-page text puts a value under its label ("Order Total" / "$83.16",
 * "Ciresa Fontina Cheese, 1 lb" / "$5.60"). Join those back into one line.
 */
function joinValueLines(lines: string[]): string[] {
  const out: string[] = [];
  const money = /^[-+]?\s*\$\s*[\d,]+\.\d{2}$/;
  for (const raw of lines) {
    const line = raw.trim();
    const prev = out[out.length - 1];
    if (money.test(line) && prev && /[a-z]/i.test(prev) && !/\$\s*[\d,]+\.\d{2}\s*$/.test(prev) && !/\beach\b|^upc/i.test(prev)) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

export function parseDigitalReceipt(rawLines: string[], aliases: Map<string, Alias> = new Map()): ParsedReceipt {
  const lines = joinValueLines(rawLines);
  const items: ParsedItem[] = [];
  let date = '';
  let total = 0;
  let tax: number | undefined;
  const hasHeader = lines.some((l) => /^\W*item details/i.test(l.trim()));
  let inItems = false;
  let last: ParsedItem | null = null;
  /** Copied web-page text can put the price on its own line under the name. */
  let pendingName: string | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    if (!date) {
      const d = /order date:?\s*([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(line);
      if (d && MONTHS.includes(d[1].toLowerCase())) {
        date = `${d[3]}-${String(MONTHS.indexOf(d[1].toLowerCase()) + 1).padStart(2, '0')}-${d[2].padStart(2, '0')}`;
      }
    }
    const t = /^\W*order total\s*\$?\s*([\d,]+\.\d{2})/i.exec(line);
    if (t) total = Number(t[1].replace(/,/g, ''));
    const tx = /^\W*sales tax\s*\+?\s*\$?\s*([\d,]+\.\d{2})/i.exec(line);
    if (tx) tax = Number(tx[1].replace(/,/g, ''));

    if (/^\W*item details/i.test(line)) {
      inItems = true;
      continue;
    }
    if (STOP_RE.test(line)) break;
    // Without an "Item Details" header (e.g. pasted text), start at the first priced line followed by UPC/qty lines.
    if (!inItems && (hasHeader || !LINE_PRICE_RE.test(line))) continue;

    const qty = QTY_RE.exec(line);
    if (qty && last) {
      const unit = qty[2].toLowerCase();
      last.quantity = Number(qty[1]);
      last.unit = unit === 'x' ? 'count' : /^[li1|]b/.test(unit) ? 'lb' : unit === 'oz' ? 'oz' : 'kg';
      continue;
    }
    if (SKIP_RE.test(line)) continue;

    const price = LINE_PRICE_RE.exec(line);
    if (!price) {
      if (inItems && /[a-z]{3}/i.test(line)) pendingName = line;
      continue;
    }
    {
      let receiptText = line.slice(0, price.index).trim();
      if (!/[a-z]{2}/i.test(receiptText)) {
        if (!pendingName) continue;
        receiptText = pendingName; // "$5.60" alone, under its name
      }
      pendingName = null;
      inItems = true;
      const alias = aliases.get(normalizeKey(receiptText));
      const name = alias?.name ?? cleanDigitalName(receiptText);
      const cls = classify(name);
      last = {
        receiptText,
        name,
        category: alias?.category ?? cls.category,
        location: alias?.location ?? cls.location,
        quantity: 1,
        unit: 'count',
        price: Number(price[1].replace(/,/g, '')),
        isFood: cls.isFood,
        // Digital receipts spell names out, so they don't need the "guess" flag.
        known: true,
      };
      items.push(last);
    }
  }
  return { date, total, tax, items };
}
