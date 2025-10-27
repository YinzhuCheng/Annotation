import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';

export function Header({ onHelp, onToggleLang }: { onHelp: () => void; onToggleLang: () => void }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'dark';
    const cur = document.documentElement.getAttribute('data-theme');
    return (cur === 'light' || cur === 'dark') ? (cur as any) : 'dark';
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const cur = document.documentElement.getAttribute('data-theme');
    if (cur === 'light' || cur === 'dark') setTheme(cur);
  }, []);
  return (
    <header>
      <div className="row">
        <span className="badge">{t('localFirst')}</span>
        <strong>{t('title')}</strong>
      </div>
      <div className="row">
        <button onClick={() => {
          const cur = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = cur === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          try { localStorage.setItem('theme', next); } catch {}
          setTheme(next as any);
        }}>{theme === 'dark' ? '🌙' : '☀️'}</button>
        <button onClick={onToggleLang}>{t('language')}</button>
        <button onClick={onHelp}>{t('help')}</button>
      </div>
    </header>
  );
}
