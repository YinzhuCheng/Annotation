import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Header } from './components/Header';
import { HelpModal } from './components/HelpModal';
// import { ModeSwitch } from './components/ModeSwitch';
import { LLMConfig } from './components/LLMConfig';
import { ProblemEditor } from './components/ProblemEditor';
import { ImportExport } from './components/ImportExport';
import { ImageComposer } from './components/ImageComposer';
import { useAppStore } from './state/store';
import { estimateStorage } from './lib/storage';

export default function App() {
  const { t, i18n } = useTranslation();
  const [showHelp, setShowHelp] = useState(false);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null);
  const { mode } = useAppStore();

  useEffect(() => {
    estimateStorage().then(setStorageInfo).catch(() => setStorageInfo(null));
  }, []);

  const onToggleLang = () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(next);
    localStorage.setItem('lang', next);
  };

  return (
    <>
      <Header onHelp={() => setShowHelp(true)} onToggleLang={onToggleLang} />
      <div className="container">
        <div className="row" style={{justifyContent:'space-between', marginBottom: 8}}>
          <h2>{t('title')}</h2>
          <div className="row small">
            <span>{t('storage')}:</span>
            {storageInfo ? (
              <>
                <span className="badge">{t('usage')}: {(storageInfo.usage / (1024*1024)).toFixed(1)} MB</span>
                <span className="badge">{t('quota')}: {(storageInfo.quota / (1024*1024)).toFixed(0)} MB</span>
              </>
            ) : (
              <span className="badge">N/A</span>
            )}
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            {/* ModeSwitch removed; default to agent mode */}
            <div className="badge" style={{display:'block', marginTop: 12}}>{t('agentBanner')}</div>
            <LLMConfig />
          </div>

          <div className="card">
            <ImportExport />
          </div>
        </div>

        <div className="card" style={{marginTop: 16}}>
          <ProblemEditor />
        </div>

        <div className="card" style={{marginTop: 16}}>
          <ImageComposer />
        </div>
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </>
  );
}
