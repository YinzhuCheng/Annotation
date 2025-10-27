import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';

export function ModeSwitch() {
  const { t } = useTranslation();
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const llm = useAppStore((s) => s.llm);

  return (
    <div>
      <div className="label">{t('mode')}</div>
      <div className="row">
        <button
          className={mode === 'manual' ? 'primary' : ''}
          onClick={() => setMode('manual')}
        >
          {t('manualMode')}
        </button>
        <button
          className={mode === 'agent' ? 'primary' : ''}
          onClick={() => {
            if (!llm.apiKey?.trim() || !llm.model?.trim() || !llm.baseUrl?.trim()) {
              alert(`${t('llmMissingTitle')}: ${t('llmMissingBody')}`);
            }
            setMode('agent');
          }}
        >
          {t('agentMode')}
        </button>
      </div>
    </div>
  );
}
