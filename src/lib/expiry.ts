import { addDays, daysBetween } from './dates';
import type { Category, InventoryItem, Location } from './types';

/**
 * Conservative default shelf life in days, by category and storage location.
 * Used only when the user doesn't enter a printed date. Values follow
 * USDA FoodKeeper guidance, rounded down.
 */
const SHELF_LIFE: Record<Category, Record<Location, number>> = {
  produce: { fridge: 7, freezer: 240, pantry: 5 },
  meat: { fridge: 2, freezer: 120, pantry: 0 },
  seafood: { fridge: 2, freezer: 90, pantry: 0 },
  dairy: { fridge: 7, freezer: 90, pantry: 0 },
  eggs: { fridge: 28, freezer: 180, pantry: 0 },
  bakery: { fridge: 10, freezer: 90, pantry: 5 },
  pantry: { fridge: 180, freezer: 365, pantry: 365 },
  frozen: { fridge: 3, freezer: 180, pantry: 0 },
  beverages: { fridge: 10, freezer: 180, pantry: 180 },
  other: { fridge: 7, freezer: 90, pantry: 30 },
};

/** Keyword overrides for common items whose shelf life differs a lot from their category. */
const KEYWORD_OVERRIDES: Array<[RegExp, Partial<Record<Location, number>>]> = [
  [/berr|raspberr|strawberr|blueberr/, { fridge: 4 }],
  [/lettuce|spinach|greens|arugula|herb|cilantro|basil/, { fridge: 5 }],
  [/banana|avocado/, { pantry: 4, fridge: 5 }],
  [/potato|onion|garlic|squash/, { pantry: 30 }],
  [/carrot|cabbage|celery/, { fridge: 21 }],
  [/apple|citrus|orange|lemon|lime/, { fridge: 28, pantry: 7 }],
  [/ground/, { fridge: 2 }],
  [/bacon|deli|ham|turkey slices/, { fridge: 7 }],
  [/hard cheese|parmesan|cheddar/, { fridge: 28 }],
  [/yogurt/, { fridge: 14 }],
  [/milk/, { fridge: 7 }],
  [/butter/, { fridge: 60 }],
  [/tofu/, { fridge: 7 }],
];

export function estimateShelfLifeDays(name: string, category: Category, location: Location): number {
  const lower = name.toLowerCase();
  for (const [re, days] of KEYWORD_OVERRIDES) {
    const d = days[location];
    if (re.test(lower) && d !== undefined) return d;
  }
  const days = SHELF_LIFE[category][location];
  // A category with 0 days in a location (e.g. raw meat in the pantry) means "don't store it there":
  // treat it as expiring the same day so it surfaces at the top.
  return days;
}

export function estimateExpiry(
  name: string,
  category: Category,
  location: Location,
  purchasedOn: string,
): string {
  return addDays(purchasedOn, estimateShelfLifeDays(name, category, location));
}

export type Freshness = 'expired' | 'urgent' | 'soon' | 'fresh';

export function daysLeft(item: Pick<InventoryItem, 'expiresOn'>, today: string): number {
  return daysBetween(today, item.expiresOn);
}

export function freshness(item: Pick<InventoryItem, 'expiresOn'>, today: string): Freshness {
  const d = daysLeft(item, today);
  if (d < 0) return 'expired';
  if (d <= 2) return 'urgent';
  if (d <= 5) return 'soon';
  return 'fresh';
}
