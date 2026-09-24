import { useEffect, useRef, useState } from 'react';
import { receiptStatus, scanReceipt, type ScannedItem } from '../api';
import { db } from '../db';
import { todayISO } from '../lib/dates';
import { estimateExpiry } from '../lib/expiry';
import { prepareReceiptImages } from '../lib/image';
import type { Category, Location, Unit } from '../lib/types';
import { CATEGORIES } from './Inventory';

const LOCATIONS: Location[] = ['fridge', 'freezer', 'pantry'];
const UNITS: Unit[] = ['count', 'package', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup'];

type Row = ScannedItem & { include: boolean };

export function ReceiptScan({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<'idle' | 'reading' | 'review'>('idle');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState(todayISO());
  const [store, setStore] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    receiptStatus().then(setConfigured);
  }, []);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    setStatus('reading');
    try {
      const images = await prepareReceiptImages([...files]);
      if (images.length > 8) throw new Error('Too many photos. Scan at most 8 sections of the receipt.');
      const r = await scanReceipt(images);
      setRows(r.items.map((i) => ({ ...i, include: i.isFood })));
      if (r.date) setDate(r.date);
      setStore(r.store);
      setTotal(r.total);
      setStatus('review');
    } catch (e) {
      setError((e as Error).message);
      setStatus('idle');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    const chosen = rows.filter((r) => r.include && r.name.trim());
    await db.items.bulkAdd(
      chosen.map((r) => ({
        name: r.name.trim(),
        category: r.category,
        location: r.location,
        quantity: r.quantity,
        unit: r.unit,
        price: r.price,
        purchasedOn: date,
        expiresOn: estimateExpiry(r.name, r.category, r.location, date),
        expiryEstimated: true,
        status: 'active' as const,
      })),
    );
    onDone();
  }

  if (configured === false) {
    return (
      <p className="card">
        Receipt scanning needs <code>ANTHROPIC_API_KEY</code> in the server's <code>.env</code>. See the README.
      </p>
    );
  }

  const included = rows.filter((r) => r.include);
  const sum = included.reduce((s, r) => s + r.price, 0);

  return (
    <div className="card">
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {status === 'idle' && (
        <>
          <p className="small">
            Lay the receipt flat in good light. For a long receipt, take several photos top to bottom that overlap a little.
          </p>
          <div className="form-actions">
            <button className="primary" onClick={() => input.current?.click()} disabled={!configured}>
              Take or choose photos
            </button>
            <button onClick={onDone}>Cancel</button>
          </div>
        </>
      )}
      {status === 'reading' && <p className="small">Reading receipt… this takes 10–30 seconds.</p>}
      {error && <p className="error small">{error}</p>}
      {status === 'review' && (
        <>
          <div className="section-head">
            <h3>{store || 'Receipt'}: check before saving</h3>
            <label className="inline small">
              Bought
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <p className="muted small">
            Unticked lines are skipped. Non-food items are unticked by default. Expiry dates are estimated; edit them later
            in the pantry.
          </p>
          <ul className="list receipt-rows">
            {rows.map((r, i) => (
              <li key={i} className={`receipt-row${r.include ? '' : ' faded'}`}>
                <input type="checkbox" aria-label={`Include ${r.name}`} checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
                <div className="receipt-fields">
                  <input aria-label="Name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                  <span className="muted small receipt-text">{r.receiptText}</span>
                  <div className="receipt-meta">
                    <select aria-label="Category" value={r.category} onChange={(e) => update(i, { category: e.target.value as Category })}>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <select aria-label="Stored in" value={r.location} onChange={(e) => update(i, { location: e.target.value as Location })}>
                      {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                    </select>
                    <input aria-label="Quantity" type="number" min="0" step="any" value={r.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} />
                    <select aria-label="Unit" value={r.unit} onChange={(e) => update(i, { unit: e.target.value as Unit })}>
                      {UNITS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                    <span className="money">
                      <input aria-label="Price" type="number" min="0" step="0.01" inputMode="decimal" value={r.price} onChange={(e) => update(i, { price: Number(e.target.value) })} />
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="small">
            {included.length} items · ${sum.toFixed(2)}
            {total > 0 && Math.abs(total - rows.reduce((s, r) => s + r.price, 0)) > 0.5 && (
              <span className="warn"> · receipt total ${total.toFixed(2)} (the gap is usually tax, or a missed line)</span>
            )}
          </p>
          <div className="form-actions">
            <button className="primary" onClick={save} disabled={included.length === 0}>Add {included.length} items</button>
            <button onClick={() => input.current?.click()}>Rescan</button>
            <button onClick={onDone}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
