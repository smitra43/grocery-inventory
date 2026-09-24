import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { findLocations, type KrogerLocation } from '../api';
import { exportAll, getSettings, importAll, saveSettings } from '../db';
import { DEFAULT_TARGETS } from '../lib/macros';
import type { Macros } from '../lib/types';

export function Settings() {
  const settings = useLiveQuery(getSettings, []);
  const [targets, setTargets] = useState<Macros>(DEFAULT_TARGETS);
  const [budget, setBudget] = useState('');
  const [zip, setZip] = useState('');
  const [stores, setStores] = useState<KrogerLocation[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!settings) return;
    setTargets(settings.macroTargets);
    setBudget(settings.monthlyBudget ? String(settings.monthlyBudget) : '');
  }, [settings]);

  async function saveGoals(e: FormEvent) {
    e.preventDefault();
    await saveSettings({ macroTargets: targets, monthlyBudget: Number(budget) || undefined });
    setMsg('Saved.');
  }

  async function searchStores(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      setStores(await findLocations(zip));
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function download() {
    const blob = new Blob([JSON.stringify(await exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `groceries-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Replace all data on this device with this backup?')) return;
    try {
      await importAll(JSON.parse(await file.text()));
      setMsg('Imported.');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <section>
      <header className="section-head"><h2>Settings</h2></header>
      {msg && <p className="card">{msg}</p>}

      <form className="card form" onSubmit={saveGoals}>
        <h3 className="wide">Daily macro targets</h3>
        {(['calories', 'protein', 'carbs', 'fat'] as const).map((k) => (
          <label key={k}>
            {k}
            <input type="number" min="0" value={targets[k]} onChange={(e) => setTargets({ ...targets, [k]: Number(e.target.value) })} />
          </label>
        ))}
        <label className="wide">Monthly grocery budget ($)<input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
        <div className="form-actions wide"><button className="primary" type="submit">Save</button></div>
      </form>

      <div className="card">
        <h3>Kroger store</h3>
        {settings?.krogerLocationName && <p className="small">Current: <strong>{settings.krogerLocationName}</strong></p>}
        <form className="inline" onSubmit={searchStores}>
          <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP code" inputMode="numeric" pattern="\d{5}" required />
          <button type="submit">Find stores</button>
        </form>
        <ul className="list">
          {stores.map((s) => (
            <li key={s.locationId} className="item">
              <div className="item-main"><strong>{s.name}</strong><span className="muted">{s.address}</span></div>
              <button onClick={() => saveSettings({ krogerLocationId: s.locationId, krogerLocationName: `${s.name} — ${s.address}` }).then(() => setStores([]))}>
                Use
              </button>
            </li>
          ))}
        </ul>
        {'Notification' in window && Notification.permission === 'default' && (
          <button onClick={() => Notification.requestPermission()}>Allow deal notifications</button>
        )}
      </div>

      <div className="card">
        <h3>Backup &amp; move devices</h3>
        <p className="muted small">Data is stored on this device. Export here, then import on your phone or computer.</p>
        <div className="form-actions">
          <button onClick={download}>Export</button>
          <label className="button">Import<input type="file" accept="application/json" hidden onChange={upload} /></label>
        </div>
      </div>
    </section>
  );
}
