import { useTranslation } from 'react-i18next';

export function Header({ onHelp, onToggleLang }: { onHelp: () => void; onToggleLang: () => void }) {
  const { t } = useTranslation();
  return (
    <header>
      <div className="row">
        <span className="badge">Local-First</span>
        <strong>{t('title')}</strong>
      </div>
      <div className="row">
        <button onClick={onToggleLang}>{t('language')}</button>
        <button onClick={onHelp}>{t('help')}</button>
      </div>
    </header>
  );
}
