import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { lookupHomeChefMeal } from '../api';
import { db, getSettings, saveSettings } from '../db';
import { daysBetween, todayISO } from '../lib/dates';
import { scale } from '../lib/macros';
import { estimateCookBy, homeChefUrl, kitPrice, kitsByUrgency, parseHomeChefEmail } from '../lib/mealKits';
import type { Macros, MealKit } from '../lib/types';

type Draft = {
  name: string;
  include: boolean;
  servings: number;
  cookBy: string;
  macros: Partial<Macros>;
  url: string;
  lookup: 'pending' | 'found' | 'missing';
};

const MACRO_KEYS: Array<[keyof Macros, string]> = [
  ['calories', 'kcal'],
  ['protein', 'P g'],
  ['carbs', 'C g'],
  ['fat', 'F g'],
];

function complete(m: Partial<Macros>): Macros | undefined {
  return MACRO_KEYS.every(([k]) => typeof m[k] === 'number' && !Number.isNaN(m[k])) ? (m as Macros) : undefined;
}

function cookByLabel(kit: MealKit, today: string): { text: string; cls: string } {
  const d = daysBetween(today, kit.cookBy);
  if (d < 0) return { text: `cook-by passed ${-d}d ago`, cls: 'expired' };
  if (d === 0) return { text: 'cook today', cls: 'urgent' };
  if (d === 1) return { text: 'cook by tomorrow', cls: 'urgent' };
  return { text: `cook within ${d} days`, cls: d <= 3 ? 'soon' : 'fresh' };
}

function ImportBox({ onDone }: { onDone: () => void }) {
  const today = todayISO();
  const [text, setText] = useState('');
  const settings = useLiveQuery(getSettings, []);
  const [price, setPrice] = useState<string | null>(null);
  const [unit, setUnit] = useState<'serving' | 'kit' | null>(null);
  // Default to the last price used; the user said $9.99 per kit.
  const priceValue = price ?? String(settings?.kitPrice ?? 9.99);
  const unitValue = unit ?? settings?.kitPriceUnit ?? 'kit';
  const [deliveredOn, setDeliveredOn] = useState(today);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState('');

  async function read() {
    const parsed = parseHomeChefEmail(text, today);
    if (parsed.meals.length === 0) {
      setError('No meal names found. Paste the whole email, including the list of meals.');
      return;
    }
    setError('');
    setDeliveredOn(parsed.deliveredOn);
    const initial: Draft[] = parsed.meals.map((name) => ({
      name,
      include: true,
      servings: 2,
      cookBy: estimateCookBy(name, parsed.deliveredOn),
      macros: {},
      url: homeChefUrl(name),
      lookup: 'pending',
    }));
    setDrafts(initial);
    // Fill in nutrition from homechef.com where the page can be read.
    const results = await Promise.all(parsed.meals.map((n) => lookupHomeChefMeal(n)));
    setDrafts((cur) =>
      (cur ?? initial).map((d, i) => {
        const r = results[i];
        if (!r.found || !r.macros) return { ...d, lookup: 'missing', url: r.url ?? d.url };
        return { ...d, lookup: 'found', macros: r.macros, servings: r.servings ?? d.servings, url: r.url ?? d.url };
      }),
    );
  }

  const update = (i: number, patch: Partial<Draft>) => setDrafts((cur) => cur!.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const chosen = drafts?.filter((d) => d.include && d.name.trim()) ?? [];

  const boxTotal = chosen.reduce((sum, d) => sum + kitPrice(Number(priceValue) || 0, unitValue, d.servings), 0);

  async function save() {
    await saveSettings({ kitPrice: Number(priceValue) || 0, kitPriceUnit: unitValue });
    await db.kits.bulkAdd(
      chosen.map((d) => ({
        name: d.name.trim(),
        provider: 'Home Chef' as const,
        deliveredOn,
        cookBy: d.cookBy,
        servings: d.servings || 2,
        macros: complete(d.macros),
        price: kitPrice(Number(priceValue) || 0, unitValue, d.servings || 2),
        url: d.url,
        status: 'active' as const,
      })),
    );
    onDone();
  }

  return (
    <div className="card">
      {!drafts ? (
        <div className="form">
          <label className="wide">
            Paste your Home Chef shipping or order email
            <textarea
              id="kit-email"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Your Home Chef order is on its way…\n\nButtery Herb Chicken\nHot Honey Chicken Tacos'}
            />
          </label>
          {error && <p className="error small wide">{error}</p>}
          <div className="form-actions wide">
            <button className="primary" onClick={read} disabled={!text.trim()}>Read email</button>
            <button onClick={onDone}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="section-head">
            <h3>Check your box</h3>
            <label className="inline small">
              Delivered
              <input id="kit-delivered" type="date" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />
            </label>
          </div>
          <p className="muted small">
            Cook-by dates are estimates: seafood 2 days, meat 4, vegetarian 5. Use the date on the recipe card if it differs.
          </p>
          <ul className="list receipt-rows">
            {drafts.map((d, i) => (
              <li key={i} className={`receipt-row${d.include ? '' : ' faded'}`}>
                <input type="checkbox" aria-label={`Include ${d.name}`} checked={d.include} onChange={(e) => update(i, { include: e.target.checked })} />
                <div className="receipt-fields">
                  <input aria-label="Meal" value={d.name} onChange={(e) => update(i, { name: e.target.value })} />
                  <span className="muted small">
                    {d.lookup === 'pending' && 'Looking up nutrition…'}
                    {d.lookup === 'found' && (
                      <>Nutrition from <a href={d.url} target="_blank" rel="noreferrer">homechef.com</a></>
                    )}
                    {d.lookup === 'missing' && (
                      <>Enter per-serving nutrition from the recipe card or <a href={d.url} target="_blank" rel="noreferrer">its page</a> (optional)</>
                    )}
                  </span>
                  <div className="kit-meta">
                    <label className="small">Cook by<input type="date" value={d.cookBy} onChange={(e) => update(i, { cookBy: e.target.value })} /></label>
                    <label className="small">Servings<input type="number" min="1" value={d.servings} onChange={(e) => update(i, { servings: Number(e.target.value) })} /></label>
                    {MACRO_KEYS.map(([k, label]) => (
                      <label key={k} className="small">
                        {label}
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={d.macros[k] ?? ''}
                          onChange={(e) => update(i, { macros: { ...d.macros, [k]: e.target.value === '' ? undefined : Number(e.target.value) } })}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="inline small kit-price">
            <label htmlFor="kit-price">Price $</label>
            <input id="kit-price" type="number" min="0" step="0.01" inputMode="decimal" value={priceValue} onChange={(e) => setPrice(e.target.value)} />
            <select id="kit-price-unit" aria-label="Price is per" value={unitValue} onChange={(e) => setUnit(e.target.value as 'serving' | 'kit')}>
              <option value="kit">per meal kit</option>
              <option value="serving">per serving</option>
            </select>
          </div>
          <p className="small">
            Box total <strong className="num">${boxTotal.toFixed(2)}</strong>
            <span className="muted"> for {chosen.length} kits. Check it against what Home Chef charged you; the app remembers this price for next time.</span>
          </p>
          <div className="form-actions">
            <button className="primary" onClick={save} disabled={chosen.length === 0}>Add {chosen.length} meal kits</button>
            <button onClick={() => setDrafts(null)}>Back</button>
            <button onClick={onDone}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

export function KitCard({ kit }: { kit: MealKit }) {
  const today = todayISO();
  const [cooking, setCooking] = useState(false);
  const [servings, setServings] = useState('1');
  const [macros, setMacros] = useState<Partial<Macros>>(kit.macros ?? {});
  const label = cookByLabel(kit, today);

  async function cook() {
    const n = Number(servings) || 1;
    const m = complete(macros);
    await db.transaction('rw', db.kits, db.meals, async () => {
      if (m) {
        await db.meals.add({ date: today, name: kit.name, servings: n, macros: scale(m, n) });
      }
      await db.kits.update(kit.id!, { status: 'cooked', closedOn: today, macros: m ?? kit.macros });
    });
  }

  return (
    <article className="card recipe kit">
      <header>
        <span className="kit-tag">{kit.provider}</span>
        <h3>{kit.name}</h3>
        <span className={`chip ${label.cls}`}>{label.text}</span>
      </header>
      <p className="macros small">
        {kit.macros ? (
          <>
            {kit.macros.calories} kcal · {kit.macros.protein}g P · {kit.macros.carbs}g C · {kit.macros.fat}g F <span className="muted">/ serving</span>
          </>
        ) : (
          <span className="muted">No nutrition yet. Add it when you cook to track macros.</span>
        )}
      </p>
      {!cooking ? (
        <div className="form-actions">
          <button className="primary" onClick={() => setCooking(true)}>Cook this</button>
          {kit.url && <a className="button" href={kit.url} target="_blank" rel="noreferrer">Recipe</a>}
          <button className="danger" onClick={() => db.kits.update(kit.id!, { status: 'wasted', closedOn: today })}>Tossed</button>
        </div>
      ) : (
        <div className="cook">
          {!kit.macros && (
            <div className="kit-meta">
              {MACRO_KEYS.map(([k, l]) => (
                <label key={k} className="small">
                  {l} / serving
                  <input type="number" min="0" value={macros[k] ?? ''} onChange={(e) => setMacros({ ...macros, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </label>
              ))}
            </div>
          )}
          <label className="inline">
            Servings you ate
            <input type="number" min="0" step="0.5" value={servings} onChange={(e) => setServings(e.target.value)} />
          </label>
          <div className="form-actions">
            <button className="primary" onClick={cook}>{complete(macros) ? 'Log meal' : 'Mark cooked'}</button>
            <button onClick={() => setCooking(false)}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  );
}

export function MealKits() {
  const [importing, setImporting] = useState(false);
  const kits = kitsByUrgency(useLiveQuery(() => db.kits.where('status').equals('active').toArray(), []) ?? []);
  return (
    <section>
      <header className="section-head">
        <h2>Meal kits</h2>
        {!importing && <button onClick={() => setImporting(true)}>+ Add Home Chef box</button>}
      </header>
      {importing && <ImportBox onDone={() => setImporting(false)} />}
      {kits.length === 0 && !importing ? (
        <p className="empty">No meal kits waiting. Paste a Home Chef email to add your box.</p>
      ) : (
        <div className="grid">{kits.map((k) => <KitCard key={k.id} kit={k} />)}</div>
      )}
    </section>
  );
}
