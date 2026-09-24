export function slugify(name: string): string;
export function parseRecipePage(html: string): {
  title: string;
  servings: number;
  macros: { calories: number; protein: number; carbs: number; fat: number } | null;
  ingredients: string[];
  facts: Array<{ label: string; value: string }>;
} | null;
export function lookupMeal(name: string): Promise<Record<string, unknown>>;
