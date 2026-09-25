import { useRef, useState } from 'react';
import { db } from '../db';
import { todayISO } from '../lib/dates';
import { estimateExpiry } from '../lib/expiry';
import { readReceipt, readReceiptPdf } from '../lib/ocr';
import { normalizeKey, parseReceipt, type Alias, type ParsedItem } from '../lib/receiptParser';
import type { Category, Location, Unit } from '../lib/types';
import { CATEGORIES } from './Inventory';

const LOCATIONS: Location[] = ['fridge', 'freezer', 'pantry'];
const UNITS: Unit[] = ['count', 'package', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup'];

type Row = ParsedItem & { include: boolean };

const blankRow = (): Row => ({
  receiptText: '',
  name: '',
  category: 'produce',
  location: 'fridge',
  quantity: 1,
  unit: 'count',
  price: 0,
  isFood: true,
  known: true,
  include: true,
});

export function ReceiptScan({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'reading' | 'review' | 'paste'>('idle');
  const [pasted, setPasted] = useState('');
  const [progress, setProgress] = useState({ fraction: 0, label: '' });
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [total, setTotal] = useState(0);
  const [tax, setTax] = useState<number | undefined>(undefined);

  /** Parse receipt lines (from OCR, a PDF or pasted text) and open the review list. */
  async function review(lines: string[]) {
    const aliases = new Map((await db.aliases.toArray()).map((a) => [a.key, a]));
    const parsed = parseReceipt(lines, aliases);
    setRawLines(lines);
    if (parsed.items.length === 0) {
      throw new Error('No items found. Retake the photo flat, in good light, filling the frame with the receipt.');
    }
    setRows(parsed.items.map((i) => ({ ...i, include: i.isFood })));
    if (parsed.date) setDate(parsed.date);
    setTotal(parsed.total);
    setTax(parsed.tax);
    setStatus('review');
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    setStatus('reading');
    try {
      const all = [...files];
      const pdfs = all.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      const photos = all.filter((f) => !pdfs.includes(f));
      const lines: string[] = [];
      for (const pdf of pdfs) lines.push(...(await readReceiptPdf(pdf, (fraction, label) => setProgress({ fraction, label }))));
      if (photos.length) lines.push(...(await readReceipt(photos, (fraction, label) => setProgress({ fraction, label }))));
      await review(lines);
    } catch (e) {
      setError((e as Error).message);
      setStatus(rawLines.length ? 'review' : 'idle');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  async function onPaste() {
    setError('');
    try {
      await review(pasted.split(/\r?\n/));
    } catch (e) {
      setError((e as Error).message.replace('Retake the photo flat, in good light, filling the frame with the receipt.', 'Paste the whole receipt, including the item list.'));
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    const chosen = rows.filter((r) => r.include && r.name.trim());
    // Remember each confirmed line so the next receipt gets it right without editing.
    const aliases: Alias[] = chosen
      .filter((r) => r.receiptText)
      .map((r) => ({ key: normalizeKey(r.receiptText), name: r.name.trim(), category: r.category, location: r.location }))
      .filter((a) => a.key);
    await db.transaction('rw', db.items, db.aliases, async () => {
      await db.aliases.bulkPut(aliases);
      await db.items.bulkAdd(
        chosen.map((r) => ({
          name: r.name.trim(),
          category: r.category,
          location: r.location,
          quantity: r.quantity || 1,
          unit: r.unit,
          price: r.price,
          purchasedOn: date,
          expiresOn: estimateExpiry(r.name, r.category, r.location, date),
          expiryEstimated: true,
          status: 'active' as const,
        })),
      );
    });
    onDone();
  }

  const included = rows.filter((r) => r.include);
  const sum = included.reduce((s, r) => s + r.price, 0);
  const allSum = rows.reduce((s, r) => s + r.price, 0);
  const guesses = included.filter((r) => !r.known).length;

  return (
    <div className="card">
      <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {status === 'idle' && (
        <>
          <p className="small">
            <strong>Best:</strong> a receipt from kroger.com → Purchases, as a PDF, or paste its text. Names and prices come
            through exactly.
          </p>
          <p className="small muted">
            Paper receipt: lay it flat in good light and fill the frame. For a long one, take several overlapping photos top to
            bottom. Reading happens on your phone; nothing is uploaded.
          </p>
          <div className="form-actions">
            <button className="primary" onClick={() => input.current?.click()}>Photo or PDF</button>
            <button onClick={() => setStatus('paste')}>Paste receipt text</button>
            <button onClick={onDone}>Cancel</button>
          </div>
        </>
      )}
      {status === 'paste' && (
        <div className="form">
          <label className="wide">
            Open the receipt on kroger.com → Purchases, select all (Ctrl+A), copy, and paste here
            <textarea id="receipt-text" rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          </label>
          <div className="form-actions wide">
            <button className="primary" onClick={onPaste} disabled={!pasted.trim()}>Read text</button>
            <button onClick={() => setStatus('idle')}>Back</button>
          </div>
        </div>
      )}
      {status === 'reading' && (
        <div className="reading" role="status">
          <p className="small">{progress.label}</p>
          <div className="bar"><div style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
          <p className="muted small">The first scan downloads the text reader (about 7 MB). Later scans start right away.</p>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      {status === 'review' && (
        <>
          <div className="section-head">
            <h3>Check before saving</h3>
            <label className="inline small">
              Bought
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <p className="muted small">
            {guesses > 0
              ? `${guesses} names are guesses (marked). Fix them once and future receipts will use your names.`
              : 'All names come from your earlier corrections.'}{' '}
            Unticked lines are skipped.
          </p>
          <ul className="list receipt-rows">
            {rows.map((r, i) => (
              <li key={i} className={`receipt-row${r.include ? '' : ' faded'}`}>
                <input type="checkbox" aria-label={`Include ${r.name || 'line'}`} checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
                <div className="receipt-fields">
                  <div className="receipt-name">
                    <input aria-label="Name" value={r.name} placeholder="Item name" onChange={(e) => update(i, { name: e.target.value, known: true })} />
                    {!r.known && <span className="chip soon">guess</span>}
                  </div>
                  {r.receiptText && <span className="muted small receipt-text">{r.receiptText}</span>}
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
          <button className="link" onClick={() => setRows([...rows, blankRow()])}>+ Add a line the scanner missed</button>
          <p className="small">
            {included.length} items · ${sum.toFixed(2)}
            {total > 0 && tax !== undefined && Math.abs(allSum + tax - total) < 0.02 && (
              <span className="ok"> · matches the receipt: ${allSum.toFixed(2)} + ${tax.toFixed(2)} tax = ${total.toFixed(2)}</span>
            )}
            {total > 0 && !(tax !== undefined && Math.abs(allSum + tax - total) < 0.02) && Math.abs(total - allSum) > 0.5 && (
              <span className="warn"> · receipt total ${total.toFixed(2)}. The gap is tax, or a line that was missed or misread.</span>
            )}
          </p>
          <div className="form-actions">
            <button className="primary" onClick={save} disabled={included.length === 0}>Add {included.length} items</button>
            <button onClick={() => input.current?.click()}>Rescan</button>
            <button onClick={onDone}>Cancel</button>
          </div>
          <button className="link" onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'Hide' : 'Show'} what the scanner read</button>
          {showRaw && <pre className="raw-ocr">{rawLines.join('\n')}</pre>}
        </>
      )}
    </div>
  );
}
