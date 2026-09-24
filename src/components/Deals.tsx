import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { findDeals, krogerStatus, type KrogerDeal } from '../api';
import { db, getSettings } from '../db';
import { todayISO } from '../lib/dates';
import { RECIPES } from '../lib/recipes';
import { matchRecipe } from '../lib/suggest';
import type { RecipeIngredient } from '../lib/types';

/** The search term sent to Kroger for an ingredient: its first keyword. */
const termFor = (i: RecipeIngredient) => i.match.split('|')[0];

interface RecipeDeal {
  recipeName: string;
  have: number;
  total: number;
  deals: Array<{ ingredient: string; deal: KrogerDeal }>;
  savings: number;
}

export function Deals() {
  const today = todayISO();
  const settings = useLiveQuery(getSettings, []);
  const items = useLiveQuery(() => db.items.where('status').equals('active').toArray(), []) ?? [];
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<RecipeDeal[] | null>(null);

  useEffect(() => {
    krogerStatus().then(setConfigured);
  }, []);

  async function check() {
    if (!settings?.krogerLocationId) return;
    setLoading(true);
    setError('');
    try {
      // Only look up what you'd actually need to buy.
      const matches = RECIPES.map((r) => matchRecipe(r, items, today));
      const terms = matches.flatMap((m) => [...m.missing, ...m.missingOptional].map(termFor));
      const deals = await findDeals(settings.krogerLocationId, terms);
      const ranked = matches
        .map((m) => {
          const found = [...m.missing, ...m.missingOptional]
            .map((i) => ({ ingredient: i.label, deal: deals[termFor(i)] }))
            .filter((d): d is { ingredient: string; deal: KrogerDeal } => Boolean(d.deal));
          return {
            recipeName: m.recipe.name,
            have: m.have.length,
            total: m.recipe.ingredients.length,
            deals: found,
            savings: found.reduce((s, d) => s + d.deal.savings, 0),
          };
        })
        .filter((r) => r.deals.length > 0)
        .sort((a, b) => b.have / b.total - a.have / a.total || b.savings - a.savings);
      setResults(ranked);
      if (ranked.length && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Grocery deals', { body: `${ranked[0].recipeName}: save $${ranked[0].savings.toFixed(2)} at Kroger` });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <header className="section-head">
        <h2>Kroger deals</h2>
        {settings?.krogerLocationId && configured && (
          <button className="primary" onClick={check} disabled={loading}>{loading ? 'Checking…' : 'Check deals'}</button>
        )}
      </header>
      {configured === false && (
        <p className="card">
          The Kroger server isn't configured. Add <code>KROGER_CLIENT_ID</code> and <code>KROGER_CLIENT_SECRET</code> to{' '}
          <code>.env</code> and run <code>npm run server</code>. See the README.
        </p>
      )}
      {configured && !settings?.krogerLocationId && <p className="card">Pick your Kroger store in Settings first.</p>}
      {settings?.krogerLocationName && <p className="muted small">Store: {settings.krogerLocationName}</p>}
      {error && <p className="card error">{error}</p>}
      {results && results.length === 0 && <p className="empty">No sales on ingredients you're missing right now.</p>}
      <div className="grid">
        {results?.map((r) => (
          <article key={r.recipeName} className="card">
            <h3>{r.recipeName}</h3>
            <p className="muted small">You have {r.have}/{r.total} ingredients · save ${r.savings.toFixed(2)}</p>
            <ul className="deals">
              {r.deals.map(({ ingredient, deal }) => (
                <li key={ingredient}>
                  <span>{ingredient}: {deal.description}{deal.size ? ` (${deal.size})` : ''}</span>
                  <span className="price">
                    <s>${deal.regular.toFixed(2)}</s> <strong>${deal.promo.toFixed(2)}</strong> <span className="ok">−{deal.pct}%</span>
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
