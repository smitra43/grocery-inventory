import { daysBetween } from './dates';
import { estimateExpiry } from './expiry';
import { classify } from './receiptParser';
import type { InventoryItem, Unit } from './types';

/**
 * Import purchases from kroger.com using the same request Kroger's own "Purchases" page
 * makes (POST /atlas/v1/purchase-history/v2/details). The importer runs in the user's
 * logged-in kroger.com tab (console or bookmark), so the Kroger login never leaves Kroger.
 */

export interface KrogerItem {
  name: string;
  size: string;
  upc: string;
  quantity: number;
  weighted: boolean;
  unitPrice: number;
  /** Total paid for the line, after item coupons/sales. */
  price: number;
}

export interface KrogerReceipt {
  key: string;
  /** YYYY-MM-DD, from the receipt ID (store's local date). */
  date: string;
  store: string;
  total: number;
  tax: number;
  savings: number;
  items: KrogerItem[];
}

export interface KrogerImportPayload {
  larder: 1;
  receipts: KrogerReceipt[];
}

/**
 * Runs on www.kroger.com. Self-contained (it is serialized into a bookmark / console snippet).
 * Finds receipt IDs on the page ("011~00335~2026-09-17~514~751431"), fetches their details,
 * skips fuel, and opens the app with a compact JSON copy in the URL hash.
 */
export async function krogerImporter(appUrl: string): Promise<void> {
  const API = 'https://www.kroger.com/atlas/v1/purchase-history/v2/details';
  const KEY = /\b\d{3}~\d{5}~\d{4}-\d{2}-\d{2}~\d+~\d+\b/g;
  const keys = new Set<string>();
  const sources = [decodeURIComponent(location.href), document.documentElement.innerHTML];
  for (const s of sources) for (const m of s.match(KEY) ?? []) keys.add(m);
  if (!keys.size) {
    alert('No receipts found on this page. Open kroger.com → Purchases (or one receipt) and try again.');
    return;
  }
  const ids = [...keys].map((k) => {
    const [divisionNumber, storeNumber, transactionDate, terminalNumber, transactionId] = k.split('~');
    return { divisionNumber, storeNumber, transactionDate, terminalNumber, transactionId };
  });
  const ask = async (batch: typeof ids) => {
    const r = await fetch(API, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-kroger-channel': 'WEB' },
      body: JSON.stringify(batch),
    });
    if (!r.ok) throw new Error(`Kroger answered ${r.status}`);
    const j = await r.json();
    return (j?.data?.purchaseHistoryDetails ?? []) as Array<Record<string, any>>;
  };
  const details: Array<Record<string, any>> = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    try {
      details.push(...(await ask(batch)));
    } catch (e) {
      // If Kroger won't take a batch, ask one receipt at a time.
      if (batch.length === 1) throw e;
      for (const one of batch) details.push(...(await ask([one])));
    }
  }
  const money = (s: unknown) => Number(String(s ?? '').replace(/[^\d.-]/g, '')) || 0;
  const receipts = details
    .filter((p) => p.purchaseType !== 'FUEL')
    .map((p) => {
      const key = String(p.purchaseId?.receiptId ?? '');
      return {
        key,
        date: key.split('~')[2] ?? String(p.receiptCreateDateTime?.value ?? '').slice(0, 10),
        store: String(p.storeInfo?.vanityName ?? ''),
        total: money(p.costSummary?.total),
        tax: money(p.costSummary?.totalTax),
        savings: money(p.costSummary?.savings),
        items: ((p.items ?? []) as Array<Record<string, any>>).map((it) => {
          const d = it.purchasedData ?? {};
          return {
            name: String(d.displayInfo?.description ?? d.upc ?? ''),
            size: String(d.displayInfo?.customerFacingSize ?? ''),
            upc: String(d.upc ?? ''),
            quantity: Number(d.quantityInfo?.received ?? 1),
            weighted: Boolean(d.isWeighted),
            unitPrice: money(d.pricingInfo?.unitPricePaid),
            price: money(d.pricingInfo?.totalPricePaid),
          };
        }),
      };
    });
  location.href = appUrl + '#import=' + encodeURIComponent(JSON.stringify({ larder: 1, receipts }));
}

/** Console snippet: paste into the DevTools console on kroger.com. */
export function krogerConsoleSnippet(appUrl: string): string {
  return `(${krogerImporter.toString()})(${JSON.stringify(appUrl)}).catch((e) => alert('Import failed: ' + e.message));`;
}

/** Same code as a bookmark URL. */
export function krogerImportBookmarklet(appUrl: string): string {
  return 'javascript:' + encodeURIComponent(krogerConsoleSnippet(appUrl));
}

export function parseImportPayload(text: string): KrogerImportPayload | null {
  if (!text.startsWith('{')) return null;
  try {
    const p = JSON.parse(text);
    return p?.larder === 1 && Array.isArray(p.receipts) ? (p as KrogerImportPayload) : null;
  } catch {
    return null;
  }
}

/** "Tazo® Classic Chai Latte" → "Tazo Classic Chai Latte" */
export function cleanKrogerName(name: string): string {
  return name.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim();
}

/** Receipts older than this only count toward spending; their food is assumed eaten. */
export const PANTRY_WINDOW_DAYS = 14;

export function isRecent(receipt: Pick<KrogerReceipt, 'date'>, today: string): boolean {
  return daysBetween(receipt.date, today) <= PANTRY_WINDOW_DAYS;
}

/**
 * Turn a Kroger receipt into inventory rows. Recent food goes into the pantry; older
 * receipts and non-food lines are recorded as already used, so they count in spending only.
 */
export function receiptToItems(receipt: KrogerReceipt, today: string): InventoryItem[] {
  const recent = isRecent(receipt, today);
  return receipt.items.map((it) => {
    const name = cleanKrogerName(it.name);
    const cls = classify(name);
    let quantity = it.quantity || 1;
    let unit: Unit = 'count';
    if (it.weighted && it.unitPrice > 0) {
      // Weighted lines: price per lb × lbs = total, so lbs = total ÷ unit price.
      quantity = Math.round((it.price / it.unitPrice) * 100) / 100;
      unit = 'lb';
    }
    const expiresOn = estimateExpiry(name, cls.category, cls.location, receipt.date);
    const inPantry = recent && cls.isFood && expiresOn >= today;
    return {
      name,
      category: cls.category,
      location: cls.location,
      quantity,
      unit,
      price: it.price,
      purchasedOn: receipt.date,
      expiresOn,
      expiryEstimated: true,
      status: inPantry ? 'active' : 'used',
      ...(inPantry ? {} : { closedOn: receipt.date }),
    };
  });
}
