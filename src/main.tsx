import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { seedSampleData } from './sample';
import './styles.css';

if (import.meta.env.VITE_PREVIEW) seedSampleData().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_PREVIEW) {
  navigator.serviceWorker.register('/sw.js');
}
