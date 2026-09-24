import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db';
import { todayISO } from '../lib/dates';
import { scale } from '../lib/macros';
import { RECIPES } from '../lib/recipes';
import { suggestRecipes, type RecipeMatch } from '../lib/suggest';

function CookPanel({ match, onClose }: { match: RecipeMatch; onClose: () => void }) {
  const today = todayISO();
  const [servings, setServings] = useState('1');
  const [useUp, setUseUp] = useState<Set<number>>(
    () => new Set(match.have.filter((h) => !h.ingredient.optional).map((h) => h.item.id!)),
  );

  async function cook() {
    const n = Number(servings) || 1;
    await db.transaction('rw', db.items, db.meals, async () => {
      await db.meals.add({
        date: today,
        name: match.recipe.name,
        servings: n,
        macros: scale(match.recipe.macrosPerServing, n),
        recipeId: match.recipe.id,
      });
      for (const id of useUp) await db.items.update(id, { status: 'used', closedOn: today });
    });
    onClose();
  }

  const toggle = (id: number) => {
    const next = new Set(useUp);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setUseUp(next);
  };

  return (
    <div className="cook">
      <p className="small">Mark these as used up:</p>
      {match.have.map((h) => (
        <label key={h.item.id} className="check">
          <input type="checkbox" checked={useUp.has(h.item.id!)} onChange={() => toggle(h.item.id!)} />
          {h.item.name}
        </label>
      ))}
      <label className="inline">
        Servings you ate
        <input type="number" min="0" step="0.5" value={servings} onChange={(e) => setServings(e.target.value)} />
      </label>
      <div className="form-actions">
        <button className="primary" onClick={cook}>Log meal</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export function RecipeCard({ match, compact = false }: { match: RecipeMatch; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [cooking, setCooking] = useState(false);
  const { recipe, have, missing, rescues } = match;
  const m = recipe.macrosPerServing;
  return (
    <article className="card recipe">
      <header>
        <h3>{recipe.name}</h3>
        <span className="muted small">{recipe.minutes} min · serves {recipe.servings}</span>
      </header>
      {rescues.length > 0 && (
        <p className="rescue">Uses up: {rescues.map((r) => r.name).join(', ')}</p>
      )}
      <p className="small">
        <span className="ok">Have {have.length}</span>
        {missing.length > 0 && <span className="warn"> · Need {missing.map((i) => i.label).join(', ')}</span>}
      </p>
      <p className="macros small">
        {m.calories} kcal · {m.protein}g P · {m.carbs}g C · {m.fat}g F <span className="muted">/ serving</span>
      </p>
      {!compact && (
        <div className="form-actions">
          <button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} recipe</button>
          <button className="primary" onClick={() => setCooking(true)}>Cook this</button>
        </div>
      )}
      {open && (
        <div className="recipe-body">
          <ul>
            {recipe.ingredients.map((i) => (
              <li key={i.label} className={have.some((h) => h.ingredient === i) ? 'ok' : 'muted'}>
                {i.label}
                {i.optional ? ' (optional)' : ''}
              </li>
            ))}
          </ul>
          <ol>{recipe.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
      )}
      {cooking && <CookPanel match={match} onClose={() => setCooking(false)} />}
    </article>
  );
}

export function Recipes() {
  const today = todayISO();
  const [maxMissing, setMaxMissing] = useState(1);
  const items = useLiveQuery(() => db.items.where('status').equals('active').toArray(), []) ?? [];
  const matches = suggestRecipes(RECIPES, items, today, { maxMissing });

  return (
    <section>
      <header className="section-head">
        <h2>Recipes</h2>
        <label className="inline small">
          Missing up to
          <select value={maxMissing} onChange={(e) => setMaxMissing(Number(e.target.value))}>
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          ingredients
        </label>
      </header>
      <p className="muted small">Ranked by how much food that's about to expire each one uses up.</p>
      {matches.length === 0 ? (
        <p className="empty">No matches. Add groceries or allow more missing ingredients.</p>
      ) : (
        <div className="grid">{matches.map((m) => <RecipeCard key={m.recipe.id} match={m} />)}</div>
      )}
    </section>
  );
}
