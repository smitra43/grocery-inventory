import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { db, getSettings } from '../db';
import { addDays, todayISO } from '../lib/dates';
import { caloriesFromMacros, DEFAULT_TARGETS, totalsForDay } from '../lib/macros';
import type { Macros as M } from '../lib/types';

const KEYS: Array<[keyof M, string, string]> = [
  ['calories', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
];

export function MacroMeters({ totals, targets }: { totals: M; targets: M }) {
  return (
    <div className="macro-meters">
      {KEYS.map(([k, label, unit]) => {
        const pct = targets[k] ? (totals[k] / targets[k]) * 100 : 0;
        return (
          <div key={k} className="meter">
            <div className="meter-label"><span>{label}</span><span className="num">{totals[k]} / {targets[k]} {unit}</span></div>
            <div className="bar"><div className={pct > 110 ? 'over' : ''} style={{ width: `${Math.min(100, pct)}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export function Macros() {
  const [date, setDate] = useState(todayISO());
  const logs = useLiveQuery(() => db.meals.where('date').equals(date).toArray(), [date]) ?? [];
  const settings = useLiveQuery(getSettings, []);
  const targets = settings?.macroTargets ?? DEFAULT_TARGETS;
  const totals = totalsForDay(logs, date);

  const [name, setName] = useState('');
  const [p, setP] = useState('');
  const [c, setC] = useState('');
  const [f, setF] = useState('');
  const [kcal, setKcal] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    const protein = Number(p) || 0, carbs = Number(c) || 0, fat = Number(f) || 0;
    await db.meals.add({
      date,
      name: name.trim() || 'Snack',
      servings: 1,
      macros: { protein, carbs, fat, calories: Number(kcal) || caloriesFromMacros({ protein, carbs, fat }) },
    });
    setName(''); setP(''); setC(''); setF(''); setKcal('');
  }

  return (
    <section>
      <header className="section-head">
        <h2>Macros</h2>
        <div className="inline">
          <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
        </div>
      </header>
      <div className="card"><MacroMeters totals={totals} targets={targets} /></div>
      <ul className="list">
        {logs.map((l) => (
          <li key={l.id} className="item">
            <div className="item-main">
              <strong>{l.name}{l.servings !== 1 ? ` ×${l.servings}` : ''}</strong>
              <span className="muted">{l.macros.calories} kcal · {l.macros.protein}P {l.macros.carbs}C {l.macros.fat}F</span>
            </div>
            <button className="danger" onClick={() => db.meals.delete(l.id!)}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="card form" onSubmit={add}>
        <label className="wide">Quick add<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Protein bar" /></label>
        <label>Protein g<input type="number" min="0" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} /></label>
        <label>Carbs g<input type="number" min="0" inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} /></label>
        <label>Fat g<input type="number" min="0" inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} /></label>
        <label>kcal<input type="number" min="0" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="auto" /></label>
        <div className="form-actions wide"><button className="primary" type="submit">Log</button></div>
      </form>
      <p className="muted small">Cooking a recipe from the Recipes tab logs its macros automatically.</p>
    </section>
  );
}
