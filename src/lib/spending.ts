import { addDays } from './dates';
import type { InventoryItem, MealKit } from './types';

export interface MonthSpend {
  /** YYYY-MM */
  month: string;
  total: number;
  /** Grocery categories plus "meal kits". */
  byCategory: Record<string, number>;
  wasted: number;
}

interface Purchase {
  purchasedOn: string;
  price: number;
  category: string;
  status: string;
}

/** Meal kits as spending rows, under their own category. */
export function kitPurchases(kits: MealKit[]): Purchase[] {
  return kits.map((k) => ({ purchasedOn: k.deliveredOn, price: k.price, category: 'meal kits', status: k.status }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monthly spend (by purchase month), newest first. `wasted` is money spent on items later marked wasted. */
export function spendByMonth(items: Purchase[]): MonthSpend[] {
  const months = new Map<string, MonthSpend>();
  for (const item of items) {
    const month = item.purchasedOn.slice(0, 7);
    const m: MonthSpend = months.get(month) ?? { month, total: 0, byCategory: {}, wasted: 0 };
    m.total += item.price;
    m.byCategory[item.category] = (m.byCategory[item.category] ?? 0) + item.price;
    if (item.status === 'wasted') m.wasted += item.price;
    months.set(month, m);
  }
  return [...months.values()]
    .map((m) => ({
      ...m,
      total: round2(m.total),
      wasted: round2(m.wasted),
      byCategory: Object.fromEntries(Object.entries(m.byCategory).map(([k, v]) => [k, round2(v)])),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** Dollar value of active items that expire in the next `days` days — the "use it or lose it" number. */
export function valueAtRisk(items: InventoryItem[], today: string, days = 3): number {
  const cutoffISO = addDays(today, days);
  return round2(
    items
      .filter((i) => i.status === 'active' && i.expiresOn >= today && i.expiresOn <= cutoffISO)
      .reduce((s, i) => s + i.price, 0),
  );
}
