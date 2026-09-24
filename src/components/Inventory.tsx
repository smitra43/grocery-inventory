import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type FormEvent } from 'react';
import { db } from '../db';
import { todayISO } from '../lib/dates';
import { daysLeft, estimateExpiry, freshness } from '../lib/expiry';
import type { Category, InventoryItem, Location, Unit } from '../lib/types';

export const CATEGORIES: Category[] = ['produce', 'meat', 'seafood', 'dairy', 'eggs', 'bakery', 'pantry', 'frozen', 'beverages', 'other'];
const LOCATIONS: Location[] = ['fridge', 'freezer', 'pantry'];
const UNITS: Unit[] = ['count', 'package', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup'];

/** Pick a sensible default storage spot so fewer fields need touching. */
function defaultLocation(c: Category): Location {
  if (c === 'frozen') return 'freezer';
  if (c === 'pantry' || c === 'bakery' || c === 'beverages') return 'pantry';
  return 'fridge';
}

export function expiryLabel(item: InventoryItem, today: string): string {
  const d = daysLeft(item, today);
  if (d < 0) return `expired ${-d}d ago`;
  if (d === 0) return 'expires today';
  if (d === 1) return 'expires tomorrow';
  return `${d} days left`;
}

export function ItemRow({ item, today, actions = true }: { item: InventoryItem; today: string; actions?: boolean }) {
  const close = (status: 'used' | 'wasted') => db.items.update(item.id!, { status, closedOn: today });
  const useOne = () =>
    item.quantity > 1 ? db.items.update(item.id!, { quantity: item.quantity - 1 }) : close('used');
  return (
    <li className="item">
      <span className={`dot ${freshness(item, today)}`} aria-hidden />
      <div className="item-main">
        <strong>{item.name}</strong>
        <span className="muted">
          {item.quantity} {item.unit} · {item.location} · ${item.price.toFixed(2)}
        </span>
      </div>
      <span className={`chip ${freshness(item, today)}`} title={item.expiryEstimated ? 'Estimated from category' : 'Printed date'}>
        {expiryLabel(item, today)}
        {item.expiryEstimated ? '*' : ''}
      </span>
      {actions && (
        <div className="item-actions">
          <button onClick={useOne} title="Use one">−1</button>
          <button onClick={() => close('used')}>Used</button>
          <button className="danger" onClick={() => close('wasted')}>Tossed</button>
        </div>
      )}
    </li>
  );
}

function AddItemForm({ onDone }: { onDone: () => void }) {
  const today = todayISO();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('produce');
  const [location, setLocation] = useState<Location>('fridge');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<Unit>('count');
  const [price, setPrice] = useState('');
  const [purchasedOn, setPurchasedOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const estimate = name ? estimateExpiry(name, category, location, purchasedOn) : '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const item: InventoryItem = {
      name: name.trim(),
      category,
      location,
      quantity: Number(quantity) || 1,
      unit,
      price: Number(price) || 0,
      purchasedOn,
      expiresOn: expiresOn || estimate,
      expiryEstimated: !expiresOn,
      status: 'active',
    };
    // Reset before the async write so anything typed meanwhile isn't wiped.
    // Keep date/category so entering a whole receipt is fast.
    setName('');
    setPrice('');
    setQuantity('1');
    setExpiresOn('');
    nameRef.current?.focus();
    await db.items.add(item);
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label className="wide">
        Item
        <input ref={nameRef} required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken breast" autoFocus />
      </label>
      <label>
        Category
        <select
          value={category}
          onChange={(e) => {
            const c = e.target.value as Category;
            setCategory(c);
            setLocation(defaultLocation(c));
          }}
        >
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>
        Stored in
        <select value={location} onChange={(e) => setLocation(e.target.value as Location)}>
          {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
        </select>
      </label>
      <label>
        Qty
        <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <label>
        Unit
        <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNITS.map((u) => <option key={u}>{u}</option>)}
        </select>
      </label>
      <label>
        Price paid ($)
        <input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label>
        Bought
        <input type="date" value={purchasedOn} onChange={(e) => setPurchasedOn(e.target.value)} />
      </label>
      <label>
        Expires
        <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        {!expiresOn && estimate && <small className="muted">blank → est. {estimate}</small>}
      </label>
      <div className="form-actions wide">
        <button type="submit" className="primary">Add</button>
        <button type="button" onClick={onDone}>Done</button>
      </div>
    </form>
  );
}

export function Inventory() {
  const today = todayISO();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<'all' | Location>('all');
  const [showClosed, setShowClosed] = useState(false);
  const items = useLiveQuery(() => db.items.orderBy('expiresOn').toArray(), []) ?? [];

  const active = items.filter((i) => i.status === 'active' && (filter === 'all' || i.location === filter));
  const closed = items.filter((i) => i.status !== 'active').slice(-30).reverse();

  return (
    <section>
      <header className="section-head">
        <h2>Inventory</h2>
        {!adding && <button className="primary" onClick={() => setAdding(true)}>+ Add groceries</button>}
      </header>
      {adding && <AddItemForm onDone={() => setAdding(false)} />}
      <div className="tabs-inline" role="tablist">
        {(['all', ...LOCATIONS] as const).map((l) => (
          <button key={l} role="tab" aria-selected={filter === l} className={filter === l ? 'on' : ''} onClick={() => setFilter(l)}>
            {l}
          </button>
        ))}
      </div>
      {active.length === 0 ? (
        <p className="empty">Nothing here yet. Add what you bought.</p>
      ) : (
        <ul className="list">{active.map((i) => <ItemRow key={i.id} item={i} today={today} />)}</ul>
      )}
      <p className="muted small">* expiry estimated from category. Enter the printed date for better suggestions.</p>
      <button className="link" onClick={() => setShowClosed(!showClosed)}>
        {showClosed ? 'Hide' : 'Show'} recently used / tossed
      </button>
      {showClosed && (
        <ul className="list faded">
          {closed.map((i) => (
            <li key={i.id} className="item">
              <div className="item-main">
                <strong>{i.name}</strong>
                <span className="muted">{i.status} {i.closedOn} · ${i.price.toFixed(2)}</span>
              </div>
              <button onClick={() => db.items.update(i.id!, { status: 'active', closedOn: undefined })}>Undo</button>
              <button className="danger" onClick={() => db.items.delete(i.id!)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
