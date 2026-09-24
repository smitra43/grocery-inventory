import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_TARGETS } from './lib/macros';
import type { Alias } from './lib/receiptParser';
import type { InventoryItem, MealKit, MealLog, Settings } from './lib/types';

/**
 * Local-first storage in IndexedDB. Data lives on this device only;
 * use Settings → Export/Import to move it between devices.
 */
export const db = new Dexie('grocery-inventory') as Dexie & {
  items: EntityTable<InventoryItem, 'id'>;
  meals: EntityTable<MealLog, 'id'>;
  settings: EntityTable<Settings, 'id'>;
  /** Receipt-line corrections the user has confirmed, so the next scan gets them right. */
  aliases: EntityTable<Alias, 'key'>;
  kits: EntityTable<MealKit, 'id'>;
};

db.version(1).stores({
  items: '++id, status, expiresOn, purchasedOn, category, name',
  meals: '++id, date',
  settings: 'id',
});

db.version(2).stores({
  aliases: 'key',
});

db.version(3).stores({
  kits: '++id, status, cookBy, deliveredOn',
});

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('settings')) ?? { id: 'settings', macroTargets: DEFAULT_TARGETS };
}

export async function saveSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  await db.settings.put({ ...(await getSettings()), ...patch });
}

export interface Backup {
  version: 1;
  exportedAt: string;
  items: InventoryItem[];
  meals: MealLog[];
  settings: Settings | undefined;
  aliases?: Alias[];
  kits?: MealKit[];
}

export async function exportAll(): Promise<Backup> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    items: await db.items.toArray(),
    meals: await db.meals.toArray(),
    settings: await db.settings.get('settings'),
    aliases: await db.aliases.toArray(),
    kits: await db.kits.toArray(),
  };
}

/** Replaces all local data with the backup. */
export async function importAll(backup: Backup): Promise<void> {
  if (backup.version !== 1 || !Array.isArray(backup.items) || !Array.isArray(backup.meals)) {
    throw new Error('Not a grocery-inventory backup file');
  }
  await db.transaction('rw', [db.items, db.meals, db.settings, db.aliases, db.kits], async () => {
    await Promise.all([db.items.clear(), db.meals.clear(), db.settings.clear(), db.aliases.clear(), db.kits.clear()]);
    if (backup.aliases) await db.aliases.bulkPut(backup.aliases);
    if (backup.kits) await db.kits.bulkAdd(backup.kits);
    await db.items.bulkAdd(backup.items);
    await db.meals.bulkAdd(backup.meals);
    if (backup.settings) await db.settings.put(backup.settings);
  });
}
