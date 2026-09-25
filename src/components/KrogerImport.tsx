import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db';
import { todayISO } from '../lib/dates';
import { cleanKrogerName, isRecent, receiptToItems, type KrogerImportPayload } from '../lib/krogerImport';

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Review screen for purchases sent over from kroger.com. */
export function KrogerImport({ payload, onDone }: { payload: KrogerImportPayload; onDone: () => void }) {
  const today = todayISO();
  const imported = useLiveQuery(async () => new Set((await db.imports.toArray()).map((i) => i.key)), []);
  const receipts = [...payload.receipts].sort((a, b) => b.date.localeCompare(a.date));
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!imported) return null;
  const chosen = receipts.filter((r) => !imported.has(r.key) && !skip.has(r.key));
  const toggle = (key: string) => {
    const next = new Set(skip);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSkip(next);
  };

  async function save() {
    setSaving(true);
    await db.transaction('rw', db.items, db.imports, async () => {
      for (const r of chosen) {
        await db.items.bulkAdd(receiptToItems(r, today));
        await db.imports.put({ key: r.key, date: r.date, total: r.total });
      }
    });
    onDone();
  }

  const newCount = receipts.filter((r) => !imported.has(r.key)).length;
  const pantryItems = chosen.filter((r) => isRecent(r, today)).reduce((n, r) => n + r.items.length, 0);
  const spend = chosen.reduce((s, r) => s + r.total, 0);

  return (
    <div className="card">
      <div className="section-head">
        <h3>Kroger purchases</h3>
        <span className="muted small">{receipts.length} found · {newCount} new</span>
      </div>
      <p className="muted small">
        Receipts from the last 2 weeks go into your pantry. Older ones only count toward spending, since that food is likely
        gone. Receipts you imported before are skipped.
      </p>
      <ul className="list">
        {receipts.map((r) => {
          const done = imported.has(r.key);
          const on = !done && !skip.has(r.key);
          const itemsTotal = r.items.reduce((s, i) => s + i.price, 0);
          const matches = Math.abs(itemsTotal + r.tax - r.total) < 0.02;
          return (
            <li key={r.key} className={`item kroger-receipt${on ? '' : ' faded'}`}>
              <input type="checkbox" aria-label={`Import ${fmtDate(r.date)}`} checked={on} disabled={done} onChange={() => toggle(r.key)} />
              <div className="item-main">
                <strong>{fmtDate(r.date)} · ${r.total.toFixed(2)}</strong>
                <span className="muted">
                  {r.store || 'Kroger'} · {r.items.length} {r.items.length === 1 ? 'item' : 'items'}
                  {r.savings > 0 && ` · saved $${r.savings.toFixed(2)}`}
                  {!matches && ' · items don’t add up to the total'}
                </span>
              </div>
              <span className={`chip ${done ? 'fresh' : isRecent(r, today) ? 'soon' : 'fresh'}`}>
                {done ? 'imported' : isRecent(r, today) ? 'pantry' : 'spending only'}
              </span>
              <button className="link" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key}>
                {open === r.key ? 'Hide' : 'Items'}
              </button>
              {open === r.key && (
                <ul className="kroger-items">
                  {r.items.map((i, n) => (
                    <li key={n}>
                      <span>{cleanKrogerName(i.name)}{i.quantity > 1 && !i.weighted ? ` ×${i.quantity}` : ''}</span>
                      <span className="num">${i.price.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="small">
        {chosen.length} receipts · ${spend.toFixed(2)} · {pantryItems} items to the pantry
      </p>
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={!chosen.length || saving}>
          Import {chosen.length} receipts
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
