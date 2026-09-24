import type { Macros, MealLog } from './types';

export const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

export function scale(m: Macros, factor: number): Macros {
  return {
    calories: Math.round(m.calories * factor),
    protein: Math.round(m.protein * factor),
    carbs: Math.round(m.carbs * factor),
    fat: Math.round(m.fat * factor),
  };
}

export function sum(list: Macros[]): Macros {
  return list.reduce(
    (a, m) => ({
      calories: a.calories + m.calories,
      protein: a.protein + m.protein,
      carbs: a.carbs + m.carbs,
      fat: a.fat + m.fat,
    }),
    ZERO,
  );
}

export function totalsForDay(logs: MealLog[], date: string): Macros {
  return sum(logs.filter((l) => l.date === date).map((l) => l.macros));
}

/** Calories implied by the macros (4/4/9). Useful for sanity-checking manual entries. */
export function caloriesFromMacros(m: Pick<Macros, 'protein' | 'carbs' | 'fat'>): number {
  return Math.round(m.protein * 4 + m.carbs * 4 + m.fat * 9);
}

export const DEFAULT_TARGETS: Macros = { calories: 2000, protein: 140, carbs: 200, fat: 70 };
