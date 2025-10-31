import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { initI18n } from './i18n';

initI18n();

function Boot() {
  useEffect(() => {
    // Apply saved theme
    try {
      const saved = localStorage.getItem('theme');
      const next = saved === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
    } catch {}
  }, []);
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>
);
