import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';

export function LLMConfig() {
  const { t } = useTranslation();
  const llm = useAppStore((s) => s.llm);
  const setLLM = useAppStore((s) => s.setLLM);
  const mode = useAppStore((s) => s.mode);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = () => {
    setLLM({ ...llm });
    setSavedAt(Date.now());
  };

  useEffect(() => {
    if (savedAt) {
      const timer = setTimeout(() => setSavedAt(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [savedAt]);

  return (
    <div style={{marginTop: 12}}>
      <div className="row" style={{justifyContent:'space-between'}}>
        <div className="label">{t('llmConfig')}</div>
        {savedAt && <span className="badge">{t('saved')}</span>}
      </div>
      <div className="grid" style={{gridTemplateColumns:'1fr 1fr 1fr 1fr', gap: 8}}>
        <select
          value={llm.provider}
          onChange={(e) => setLLM({ provider: e.target.value as any })}
        >
          <option value="openai">{t('provider_openai')}</option>
          <option value="gemini">{t('provider_gemini')}</option>
          <option value="claude">{t('provider_claude')}</option>
        </select>
        <input
          placeholder={t('apiKey')}
          type="password"
          value={llm.apiKey}
          onChange={(e) => setLLM({ apiKey: e.target.value })}
        />
        <input
          placeholder={t('model')}
          value={llm.model}
          onChange={(e) => setLLM({ model: e.target.value })}
        />
        <input
          placeholder={t('baseUrl')}
          value={llm.baseUrl}
          onChange={(e) => setLLM({ baseUrl: e.target.value })}
        />
      </div>
      <div className="row" style={{marginTop: 8, justifyContent:'space-between'}}>
        <button onClick={save}>{t('save')}</button>
        {mode === 'agent' && (
          <span className="small" style={{opacity:0.8}}>{t('agentBanner')}</span>
        )}
      </div>
    </div>
  );
}
