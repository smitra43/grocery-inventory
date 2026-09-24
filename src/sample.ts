import { db } from './db';
import { addDays, todayISO } from './lib/dates';
import type { InventoryItem } from './lib/types';

/** Example groceries for the preview build, so the first screen shows what the app does. */
export async function seedSampleData(): Promise<void> {
  if ((await db.items.count()) > 0) return;
  const today = todayISO();
  const item = (
    name: string,
    category: InventoryItem['category'],
    location: InventoryItem['location'],
    price: number,
    boughtDaysAgo: number,
    expiresIn: number,
    quantity = 1,
    unit: InventoryItem['unit'] = 'count',
  ): InventoryItem => ({
    name, category, location, price, quantity, unit,
    purchasedOn: addDays(today, -boughtDaysAgo),
    expiresOn: addDays(today, expiresIn),
    expiryEstimated: true,
    status: 'active',
  });
  await db.items.bulkAdd([
    item('Boneless chicken breast', 'meat', 'fridge', 6.46, 2, 1, 1.62, 'lb'),
    item('Broccoli crowns', 'produce', 'fridge', 2.19, 2, 2, 1.1, 'lb'),
    item('Strawberries', 'produce', 'fridge', 3.99, 3, 1, 1, 'package'),
    item('Greek yogurt', 'dairy', 'fridge', 5.49, 3, 4, 1, 'package'),
    item('Large eggs', 'eggs', 'fridge', 2.99, 3, 25, 12),
    item('Red bell pepper', 'produce', 'fridge', 1.29, 2, 5),
    item('Jasmine rice', 'pantry', 'pantry', 4.99, 20, 340, 2, 'lb'),
    item('Soy sauce', 'pantry', 'pantry', 3.49, 30, 330),
    item('Frozen peas', 'frozen', 'freezer', 1.25, 2, 178, 1, 'package'),
    item('Bananas', 'produce', 'pantry', 1.62, 3, 1, 6),
    { ...item('Baby spinach', 'produce', 'fridge', 3.49, 9, -2, 1, 'package'), status: 'wasted', closedOn: addDays(today, -1) },
  ]);
  await db.meals.bulkAdd([
    { date: today, name: 'Banana Oat Pancakes', servings: 1, macros: { calories: 330, protein: 13, carbs: 52, fat: 8 }, recipeId: 'banana-oat-pancakes' },
    { date: today, name: 'Greek yogurt', servings: 1, macros: { calories: 150, protein: 20, carbs: 8, fat: 4 } },
  ]);
}
