import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../src/lib/dates';
import { estimateExpiry, freshness } from '../src/lib/expiry';
import { caloriesFromMacros, scale, totalsForDay } from '../src/lib/macros';
import { RECIPES } from '../src/lib/recipes';
import { spendByMonth, valueAtRisk } from '../src/lib/spending';
import { ingredientMatches, matchRecipe, suggestRecipes, urgency } from '../src/lib/suggest';
import type { InventoryItem } from '../src/lib/types';
import { bestDeal, dealInfo, normalizeProduct } from '../server/deals.mjs';

const TODAY = '2026-09-24';
let nextId = 1;
function item(name: string, expiresIn: number, extra: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: nextId++,
    name,
    category: 'produce',
    location: 'fridge',
    quantity: 1,
    unit: 'count',
    price: 3,
    purchasedOn: TODAY,
    expiresOn: addDays(TODAY, expiresIn),
    expiryEstimated: false,
    status: 'active',
    ...extra,
  };
}

describe('dates', () => {
  it('handles month boundaries', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(daysBetween('2026-09-24', '2026-10-01')).toBe(7);
    expect(daysBetween('2026-09-24', '2026-09-20')).toBe(-4);
  });
});

describe('expiry', () => {
  it('uses category defaults and keyword overrides', () => {
    expect(estimateExpiry('Chicken breast', 'meat', 'fridge', TODAY)).toBe('2026-09-26');
    expect(estimateExpiry('Chicken breast', 'meat', 'freezer', TODAY)).toBe(addDays(TODAY, 120));
    expect(estimateExpiry('Strawberries', 'produce', 'fridge', TODAY)).toBe(addDays(TODAY, 4));
    expect(estimateExpiry('Yellow onion', 'produce', 'pantry', TODAY)).toBe(addDays(TODAY, 30));
  });

  it('classifies freshness', () => {
    expect(freshness(item('x', -1), TODAY)).toBe('expired');
    expect(freshness(item('x', 0), TODAY)).toBe('urgent');
    expect(freshness(item('x', 4), TODAY)).toBe('soon');
    expect(freshness(item('x', 10), TODAY)).toBe('fresh');
  });
});

describe('ingredient matching', () => {
  it('matches whole words with plurals', () => {
    expect(ingredientMatches({ match: 'egg' }, 'Large Eggs')).toBe(true);
    expect(ingredientMatches({ match: 'pea' }, 'Frozen peas')).toBe(true);
    expect(ingredientMatches({ match: 'pea' }, 'Peanut butter')).toBe(false);
    expect(ingredientMatches({ match: 'tomato' }, 'Roma tomatoes')).toBe(true);
    expect(ingredientMatches({ match: 'berry|strawberries' }, 'Organic strawberries')).toBe(true);
    expect(ingredientMatches({ match: 'ground beef' }, '80/20 Ground Beef')).toBe(true);
  });
});

describe('recipe suggestions', () => {
  it('scores urgency: today > later, expired = 0', () => {
    expect(urgency(0)).toBe(1);
    expect(urgency(3)).toBeCloseTo(0.5);
    expect(urgency(-1)).toBe(0);
  });

  it('ranks recipes that use soon-to-expire food first', () => {
    const inv = [
      item('Chicken breast', 1, { category: 'meat' }),
      item('Broccoli', 2),
      item('Red bell pepper', 5),
      item('Jasmine rice', 300, { category: 'pantry' }),
      item('Soy sauce', 300, { category: 'pantry' }),
      item('Eggs', 20, { category: 'eggs' }),
      item('Pasta', 300, { category: 'pantry' }),
      item('Marinara', 300, { category: 'pantry' }),
    ];
    const top = suggestRecipes(RECIPES, inv, TODAY)[0];
    expect(top.recipe.id).toBe('chicken-stir-fry');
    expect(top.missing).toHaveLength(0);
    expect(top.rescues.map((r) => r.name)).toEqual(['Chicken breast', 'Broccoli']);
  });

  it('ignores expired and closed items and prefers the soonest-expiring duplicate', () => {
    const old = item('Spinach', -2);
    const used = item('Eggs', 5, { status: 'used' });
    const soon = item('Eggs', 1);
    const later = item('Eggs', 10);
    const m = matchRecipe(RECIPES.find((r) => r.id === 'veggie-omelette')!, [old, used, later, soon], TODAY);
    expect(m.have.map((h) => h.item.id)).toEqual([soon.id]);
    expect(m.missingOptional.map((i) => i.match)).toContain('spinach');
  });

  it('filters by max missing ingredients', () => {
    const inv = [item('Salmon fillet', 1, { category: 'seafood' })];
    expect(suggestRecipes(RECIPES, inv, TODAY, { maxMissing: 0 })).toHaveLength(0);
    expect(suggestRecipes(RECIPES, inv, TODAY, { maxMissing: 1 }).map((m) => m.recipe.id)).toContain('salmon-sheet-pan');
  });
});

describe('spending', () => {
  it('groups by purchase month and tracks waste', () => {
    const items = [
      item('A', 3, { price: 10.1, purchasedOn: '2026-09-01', category: 'meat' }),
      item('B', 3, { price: 5.2, purchasedOn: '2026-09-15', status: 'wasted' }),
      item('C', 3, { price: 7, purchasedOn: '2026-08-30', category: 'dairy' }),
    ];
    const [sep, aug] = spendByMonth(items);
    expect(sep).toMatchObject({ month: '2026-09', total: 15.3, wasted: 5.2, byCategory: { meat: 10.1, produce: 5.2 } });
    expect(aug).toMatchObject({ month: '2026-08', total: 7 });
  });

  it('computes value at risk for active, unexpired items only', () => {
    const items = [item('a', 0, { price: 2 }), item('b', 3, { price: 3 }), item('c', 4, { price: 100 }), item('d', -1, { price: 50 }), item('e', 1, { price: 9, status: 'used' })];
    expect(valueAtRisk(items, TODAY)).toBe(5);
  });
});

describe('macros', () => {
  it('scales, sums per day, and derives calories', () => {
    expect(scale({ calories: 100, protein: 10, carbs: 5, fat: 3 }, 1.5)).toEqual({ calories: 150, protein: 15, carbs: 8, fat: 5 });
    const logs = [
      { date: TODAY, name: 'a', servings: 1, macros: { calories: 100, protein: 10, carbs: 10, fat: 1 } },
      { date: TODAY, name: 'b', servings: 1, macros: { calories: 200, protein: 5, carbs: 30, fat: 4 } },
      { date: '2026-09-23', name: 'c', servings: 1, macros: { calories: 999, protein: 99, carbs: 99, fat: 99 } },
    ];
    expect(totalsForDay(logs, TODAY)).toEqual({ calories: 300, protein: 15, carbs: 40, fat: 5 });
    expect(caloriesFromMacros({ protein: 10, carbs: 20, fat: 10 })).toBe(210);
  });

  it('recipe macros are roughly consistent with 4/4/9', () => {
    for (const r of RECIPES) {
      const derived = caloriesFromMacros(r.macrosPerServing);
      expect(Math.abs(derived - r.macrosPerServing.calories) / r.macrosPerServing.calories, r.id).toBeLessThan(0.12);
    }
  });
});

describe('kroger deals', () => {
  const product = (regular: number, promo: number, description = 'Thing') => ({
    productId: description,
    description,
    items: [{ size: '1 lb', price: { regular, promo } }],
    images: [],
  });

  it('treats promo 0 as no promotion', () => {
    expect(normalizeProduct(product(4, 0)).promo).toBeNull();
    expect(dealInfo(normalizeProduct(product(4, 0)))).toBeNull();
  });

  it('requires a meaningful discount', () => {
    expect(dealInfo(normalizeProduct(product(4, 3.9)))).toBeNull();
    expect(dealInfo(normalizeProduct(product(4, 3)))).toEqual({ savings: 1, pct: 25 });
  });

  it('picks the biggest percentage off', () => {
    const best = bestDeal([product(4, 3, 'A'), product(10, 5, 'B'), product(2, 0, 'C')]);
    expect(best).toMatchObject({ description: 'B', pct: 50, promo: 5, regular: 10 });
    expect(bestDeal([product(2, 0)])).toBeNull();
  });
});
