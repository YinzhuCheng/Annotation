import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Header } from './components/Header';
// import { ModeSwitch } from './components/ModeSwitch';
import { LLMConfig } from './components/LLMConfig';
import { ProblemEditor } from './components/ProblemEditor';
import { ImportExport } from './components/ImportExport';
import { ImageComposer } from './components/ImageComposer';
import { useAppStore } from './state/store';
import { estimateStorage } from './lib/storage';

export default function App() {
  const { t, i18n } = useTranslation();
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
      <Header onHelp={() => { window.location.href = '/help.html'; }} onToggleLang={onToggleLang} />
      <div className="container">
        <div className="row" style={{justifyContent:'space-between', marginBottom: 8}}>
          <h2 style={{display:'flex', alignItems:'center', gap:8}}>
            <img src="/logo.svg" alt="Logo" style={{height:32, width:32, borderRadius:6}} />
            {t('title')}
          </h2>
          <div className="row small">
            <span>{t('storage')}:</span>
            {storageInfo ? (
              <>
                <span className="badge">{t('usage')}: {(storageInfo.usage / (1024*1024)).toFixed(1)} MB</span>
                <span className="badge">{t('quota')}: {(storageInfo.quota / (1024*1024)).toFixed(0)} MB</span>
              </>
            ) : (
              <span className="badge">{t('notAvailable')}</span>
            )}
          </div>
        </div>

        <div className="card">
          <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
            <div className="label">{t('settingsBlock')}</div>
          </div>
          <LLMConfig />
          <hr className="div" />
          <ImportExport />
        </div>

        <div className="card" style={{marginTop:16}}>
          <div className="label">{t('problemsBlock')}</div>
          <ProblemEditor />
        </div>

        <div className="card" style={{marginTop: 16}}>
          <ImageComposer />
        </div>
      </div>

      {/* Help moved to standalone page at /help.html */}
    </>
  );
}
