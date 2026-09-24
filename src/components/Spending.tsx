import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '../db';
import { kitPurchases, spendByMonth } from '../lib/spending';

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export function Spending() {
  const items = useLiveQuery(() => db.items.toArray(), []) ?? [];
  const kits = useLiveQuery(() => db.kits.toArray(), []) ?? [];
  const settings = useLiveQuery(getSettings, []);
  const months = spendByMonth([...items, ...kitPurchases(kits)]);
  const budget = settings?.monthlyBudget;

  return (
    <section>
      <header className="section-head"><h2>Spending</h2></header>
      {months.length === 0 && <p className="empty">Add groceries with prices to see spending.</p>}
      {months.map((m) => {
        const cats = Object.entries(m.byCategory).sort((a, b) => b[1] - a[1]);
        const max = cats[0]?.[1] ?? 1;
        return (
          <article key={m.month} className="card">
            <header className="section-head">
              <h3>{monthLabel(m.month)}</h3>
              <strong className="big">${m.total.toFixed(2)}</strong>
            </header>
            {budget ? (
              <div className="meter" title={`Budget $${budget}`}>
                <div className={m.total > budget ? 'over' : ''} style={{ width: `${Math.min(100, (m.total / budget) * 100)}%` }} />
                <span className="small muted">{Math.round((m.total / budget) * 100)}% of ${budget} budget</span>
              </div>
            ) : null}
            {m.wasted > 0 && <p className="warn small">${m.wasted.toFixed(2)} of this was thrown away.</p>}
            <ul className="bars">
              {cats.map(([cat, amt]) => (
                <li key={cat}>
                  <span>{cat}</span>
                  <div className="bar"><div style={{ width: `${(amt / max) * 100}%` }} /></div>
                  <span className="num">${amt.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
