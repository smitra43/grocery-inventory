export type Category =
  | 'produce'
  | 'meat'
  | 'seafood'
  | 'dairy'
  | 'eggs'
  | 'bakery'
  | 'pantry'
  | 'frozen'
  | 'beverages'
  | 'other';

export type Location = 'fridge' | 'freezer' | 'pantry';

export type Unit = 'count' | 'g' | 'kg' | 'oz' | 'lb' | 'ml' | 'l' | 'cup' | 'package';

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface InventoryItem {
  id?: number;
  name: string;
  category: Category;
  location: Location;
  quantity: number;
  unit: Unit;
  /** Total price paid for this purchase, in dollars. */
  price: number;
  /** ISO date (YYYY-MM-DD). */
  purchasedOn: string;
  /** ISO date (YYYY-MM-DD). Estimated from category when the user leaves it blank. */
  expiresOn: string;
  expiryEstimated: boolean;
  /** 'active' while in the kitchen; 'used' or 'wasted' once gone. */
  status: 'active' | 'used' | 'wasted';
  closedOn?: string;
}

export interface RecipeIngredient {
  /** Lowercase keyword matched against inventory item names, e.g. "chicken". */
  match: string;
  label: string;
  optional?: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  servings: number;
  minutes: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  macrosPerServing: Macros;
}

export interface MealLog {
  id?: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  name: string;
  servings: number;
  macros: Macros;
  recipeId?: string;
}

export interface Settings {
  id: 'settings';
  macroTargets: Macros;
  krogerLocationId?: string;
  krogerLocationName?: string;
  monthlyBudget?: number;
}
