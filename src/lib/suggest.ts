import { daysLeft } from './expiry';
import type { InventoryItem, Recipe, RecipeIngredient } from './types';

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * An ingredient's `match` is one or more `|`-separated keywords. Each must appear
 * as a whole word (plural "s"/"es" allowed), so "pea" matches "frozen peas" but not "peanut butter".
 */
export function ingredientMatches(ingredient: Pick<RecipeIngredient, 'match'>, itemName: string): boolean {
  const name = itemName.toLowerCase();
  return ingredient.match
    .toLowerCase()
    .split('|')
    .some((kw) => new RegExp(`\\b${escape(kw.trim())}(s|es)?\\b`).test(name));
}

/**
 * How much using this item now is worth, 0..1. Items expiring today score 1,
 * the value halves roughly every 3 days. Expired items score 0: we never
 * recommend cooking with them.
 */
export function urgency(days: number): number {
  if (days < 0) return 0;
  return Math.pow(0.5, days / 3);
}

export interface RecipeMatch {
  recipe: Recipe;
  score: number;
  /** Required + optional ingredients you have, paired with the inventory item that satisfies each. */
  have: Array<{ ingredient: RecipeIngredient; item: InventoryItem; daysLeft: number }>;
  missing: RecipeIngredient[];
  missingOptional: RecipeIngredient[];
  /** Items that expire within 3 days and this recipe would use up. */
  rescues: InventoryItem[];
}

export function matchRecipe(recipe: Recipe, inventory: InventoryItem[], today: string): RecipeMatch {
  const usable = inventory.filter((i) => i.status === 'active' && daysLeft(i, today) >= 0);
  const have: RecipeMatch['have'] = [];
  const missing: RecipeIngredient[] = [];
  const missingOptional: RecipeIngredient[] = [];

  for (const ingredient of recipe.ingredients) {
    // Prefer the soonest-expiring match so suggestions actually use up the at-risk item.
    const candidates = usable
      .filter((i) => ingredientMatches(ingredient, i.name))
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
    if (candidates.length) {
      have.push({ ingredient, item: candidates[0], daysLeft: daysLeft(candidates[0], today) });
    } else if (ingredient.optional) {
      missingOptional.push(ingredient);
    } else {
      missing.push(ingredient);
    }
  }

  const required = recipe.ingredients.filter((i) => !i.optional).length;
  const haveRequired = required - missing.length;
  const coverage = required ? haveRequired / required : 1;
  const urgencyScore = have.reduce((sum, h) => sum + urgency(h.daysLeft), 0);

  // Weighting: using up expiring food dominates; coverage breaks ties and keeps
  // recipes you can't really make from floating up just because they touch one item.
  const score = urgencyScore * 10 + coverage * 6 - missing.length * 2;

  const rescues = have.filter((h) => h.daysLeft <= 3).map((h) => h.item);
  return { recipe, score, have, missing, missingOptional, rescues };
}

export function suggestRecipes(
  recipes: Recipe[],
  inventory: InventoryItem[],
  today: string,
  opts: { maxMissing?: number } = {},
): RecipeMatch[] {
  const maxMissing = opts.maxMissing ?? 2;
  return recipes
    .map((r) => matchRecipe(r, inventory, today))
    .filter((m) => m.have.length > 0 && m.missing.length <= maxMissing)
    .sort((a, b) => b.score - a.score);
}
