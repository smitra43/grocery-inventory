import { addDays } from './dates';
import type { Category, InventoryItem } from './types';

export interface MonthSpend {
  /** YYYY-MM */
  month: string;
  total: number;
  byCategory: Partial<Record<Category, number>>;
  wasted: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monthly spend (by purchase month), newest first. `wasted` is money spent on items later marked wasted. */
export function spendByMonth(items: InventoryItem[]): MonthSpend[] {
  const months = new Map<string, MonthSpend>();
  for (const item of items) {
    const month = item.purchasedOn.slice(0, 7);
    const m = months.get(month) ?? { month, total: 0, byCategory: {}, wasted: 0 };
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
