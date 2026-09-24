import { useState } from 'react';
import { Deals } from './components/Deals';
import { Home } from './components/Home';
import { Inventory } from './components/Inventory';
import { Macros } from './components/Macros';
import { Recipes } from './components/Recipes';
import { Settings } from './components/Settings';
import { Spending } from './components/Spending';

const TABS = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'inventory', label: 'Pantry', icon: '▤' },
  { id: 'recipes', label: 'Recipes', icon: '✎' },
  { id: 'macros', label: 'Macros', icon: '◔' },
  { id: 'spending', label: 'Spending', icon: '$' },
  { id: 'deals', label: 'Deals', icon: '%' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || 'home');
  const go = (t: string) => {
    setTab(t as Tab);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo(0, 0);
  };

  return (
    <div className="app">
      <nav className="nav">
        <span className="brand">Larder</span>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)} aria-current={tab === t.id}>
            <span className="icon" aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <main>
        {tab === 'home' && <Home go={go} />}
        {tab === 'inventory' && <Inventory />}
        {tab === 'recipes' && <Recipes />}
        {tab === 'macros' && <Macros />}
        {tab === 'spending' && <Spending />}
        {tab === 'deals' && <Deals />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
