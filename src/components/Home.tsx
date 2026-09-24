import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '../db';
import { todayISO } from '../lib/dates';
import { daysLeft } from '../lib/expiry';
import { DEFAULT_TARGETS, totalsForDay } from '../lib/macros';
import { RECIPES } from '../lib/recipes';
import { kitPurchases, spendByMonth, valueAtRisk } from '../lib/spending';
import { suggestRecipes } from '../lib/suggest';
import { kitsByUrgency } from '../lib/mealKits';
import { KitCard } from './MealKits';
import { ItemRow } from './Inventory';
import { MacroMeters } from './Macros';
import { RecipeCard } from './Recipes';

export function Home({ go }: { go: (tab: string) => void }) {
  const today = todayISO();
  const items = useLiveQuery(() => db.items.toArray(), []) ?? [];
  const kits = useLiveQuery(() => db.kits.toArray(), []) ?? [];
  const meals = useLiveQuery(() => db.meals.where('date').equals(today).toArray(), [today]) ?? [];
  const settings = useLiveQuery(getSettings, []);

  const active = items.filter((i) => i.status === 'active');
  const expiring = active.filter((i) => daysLeft(i, today) <= 3).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const dueKits = kitsByUrgency(kits).slice(0, 3);
  const top = suggestRecipes(RECIPES, active, today, { maxMissing: 1 }).slice(0, Math.max(1, 3 - dueKits.length));
  const thisMonth = spendByMonth([...items, ...kitPurchases(kits)]).find((m) => m.month === today.slice(0, 7));

  return (
    <section>
      <div className="stats">
        <button className="stat" onClick={() => go('inventory')}><span className="num big">{active.length}</span><span>items on hand</span></button>
        <button className="stat" onClick={() => go('inventory')}><span className="num big warn">${valueAtRisk(items, today).toFixed(2)}</span><span>expiring in 3 days</span></button>
        <button className="stat" onClick={() => go('spending')}><span className="num big">${(thisMonth?.total ?? 0).toFixed(2)}</span><span>spent this month</span></button>
      </div>

      <h2>Use these first</h2>
      {expiring.length === 0 ? (
        <p className="empty">Nothing expiring in the next 3 days.</p>
      ) : (
        <ul className="list">{expiring.map((i) => <ItemRow key={i.id} item={i} today={today} />)}</ul>
      )}

      <h2>Cook next</h2>
      {top.length === 0 && dueKits.length === 0 ? (
        <p className="empty">Add groceries to get recipe suggestions.</p>
      ) : (
        <div className="grid">
          {dueKits.map((k) => <KitCard key={k.id} kit={k} />)}
          {top.map((m) => <RecipeCard key={m.recipe.id} match={m} />)}
        </div>
      )}

      <h2>Today's macros</h2>
      <div className="card"><MacroMeters totals={totalsForDay(meals, today)} targets={settings?.macroTargets ?? DEFAULT_TARGETS} /></div>
    </section>
  );
}
