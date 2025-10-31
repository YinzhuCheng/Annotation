import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { chatStream } from '../lib/llmAdapter';
import { useAppStore } from '../state/store';
import type { AgentId, LLMAgentSettings } from '../state/store';

const PROVIDERS: Array<{ value: LLMAgentSettings['config']['provider']; labelKey: string }> = [
  { value: 'openai', labelKey: 'provider_openai' },
  { value: 'gemini', labelKey: 'provider_gemini' },
  { value: 'claude', labelKey: 'provider_claude' }
];

function cloneAgentsState(source: Record<AgentId, LLMAgentSettings>): Record<AgentId, LLMAgentSettings> {
  return {
    ocr: { config: { ...source.ocr.config }, prompt: source.ocr.prompt },
    latex: { config: { ...source.latex.config }, prompt: source.latex.prompt },
    generator: { config: { ...source.generator.config }, prompt: source.generator.prompt },
    translator: { config: { ...source.translator.config }, prompt: source.translator.prompt }
  };
}

type PromptEditorState = { id: AgentId; value: string } | null;
type AgentDefinition = { id: AgentId; title: string; description: string };

export function LLMConfig() {
  const { t } = useTranslation();
  const agents = useAppStore((s) => s.llmAgents);
  const saveAgentSettings = useAppStore((s) => s.saveAgentSettings);

  const [drafts, setDrafts] = useState<Record<AgentId, LLMAgentSettings>>(() => cloneAgentsState(agents));
  const [savedAt, setSavedAt] = useState<Record<AgentId, number | null>>({ ocr: null, latex: null, generator: null, translator: null });
  const [overallSavedAt, setOverallSavedAt] = useState<number | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<PromptEditorState>(null);
  const [testMsg, setTestMsg] = useState('');
  const [testAgentId, setTestAgentId] = useState<AgentId>('generator');
  const [reply, setReply] = useState('');
  const [err, setErr] = useState('');
  const [status, setStatus] = useState<'idle'|'waiting_response'|'thinking'|'responding'|'done'>('idle');
  const [dots, setDots] = useState(1);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    setDrafts(cloneAgentsState(agents));
  }, [agents]);

  useEffect(() => {
    if (status === 'idle' || status === 'done') return;
    const timer = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const timers = (Object.entries(savedAt) as Array<[AgentId, number | null]>)
      .filter(([, ts]) => ts)
      .map(([id]) => setTimeout(() => {
        setSavedAt((prev) => ({ ...prev, [id]: null }));
      }, 1500));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [savedAt]);

  useEffect(() => {
    if (!overallSavedAt) return;
    const timer = setTimeout(() => setOverallSavedAt(null), 1500);
    return () => clearTimeout(timer);
  }, [overallSavedAt]);

  useEffect(() => {
    if (!showDetail) setEditingPrompt(null);
  }, [showDetail]);

  const agentDefs = useMemo<AgentDefinition[]>(() => ([
    { id: 'ocr', title: t('agentOcr'), description: t('agentOcrDesc') },
    { id: 'latex', title: t('agentLatex'), description: t('agentLatexDesc') },
    { id: 'generator', title: t('agentGenerator'), description: t('agentGeneratorDesc') },
    { id: 'translator', title: t('agentTranslator'), description: t('agentTranslatorDesc') }
  ]), [t]);

  const agentTitles = useMemo<Record<AgentId, string>>(() => (
    agentDefs.reduce((acc, def) => {
      acc[def.id] = def.title;
      return acc;
    }, {} as Record<AgentId, string>)
  ), [agentDefs]);

  const agentIds = useMemo<AgentId[]>(() => agentDefs.map((def) => def.id), [agentDefs]);

  const overallConfig = useMemo(() => {
    const ids = agentIds.length > 0 ? agentIds : (['generator'] as AgentId[]);
    const firstId = ids[0];
    const base: LLMAgentSettings['config'] = drafts[firstId]?.config ?? { provider: 'openai', apiKey: '', model: '', baseUrl: '' };
    const result: LLMAgentSettings['config'] = { ...base };
    const fields: Array<keyof LLMAgentSettings['config']> = ['provider', 'apiKey', 'model', 'baseUrl'];
    let unified = true;
    for (const field of fields) {
      const firstValue = drafts[firstId]?.config[field] ?? base[field];
      const same = ids.every((id) => drafts[id]?.config[field] === firstValue);
      if (!same) unified = false;
      result[field] = firstValue as LLMAgentSettings['config'][keyof LLMAgentSettings['config']];
    }
    return { config: result, unified };
  }, [agentIds, drafts]);

  const handleConfigChange = (id: AgentId, field: keyof LLMAgentSettings['config'], value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        config: { ...prev[id].config, [field]: value }
      }
    }));
  };

  const handleOverallChange = <K extends keyof LLMAgentSettings['config']>(field: K, value: LLMAgentSettings['config'][K]) => {
    setDrafts((prev) => {
      const next = { ...prev } as Record<AgentId, LLMAgentSettings>;
      agentIds.forEach((id) => {
        next[id] = {
          ...next[id],
          config: { ...next[id].config, [field]: value }
        };
      });
      return next;
    });
  };

  const handlePromptSave = () => {
    if (!editingPrompt) return;
    setDrafts((prev) => ({
      ...prev,
      [editingPrompt.id]: { ...prev[editingPrompt.id], prompt: editingPrompt.value }
    }));
    setEditingPrompt(null);
  };

  const handleCopy = (target: AgentId, source: AgentId) => {
    if (target === source) return;
    setDrafts((prev) => ({
      ...prev,
      [target]: {
        ...prev[target],
        config: { ...prev[source].config }
      }
    }));
  };

  const handleSave = (id: AgentId) => {
    saveAgentSettings(id, drafts[id]);
    setSavedAt((prev) => ({ ...prev, [id]: Date.now() }));
  };

  const handleSaveOverall = () => {
    const now = Date.now();
    agentIds.forEach((id) => saveAgentSettings(id, drafts[id]));
    setSavedAt((prev) => {
      const next = { ...prev };
      agentIds.forEach((id) => { next[id] = now; });
      return next;
    });
    setOverallSavedAt(now);
  };

  const ensureConfig = (id: AgentId): boolean => {
    const cfg = drafts[id]?.config;
    if (!cfg?.apiKey?.trim() || !cfg?.model?.trim() || !cfg?.baseUrl?.trim()) {
      setErr(t('llmAgentMissingBody', { agent: agentTitles[id] }));
      setStatus('done');
      return false;
    }
    return true;
  };

  const handleTest = async () => {
    setErr('');
    setReply('');
    setStatus('idle');
    if (!ensureConfig(testAgentId)) return;
    try {
      await chatStream([{ role: 'user', content: testMsg }], drafts[testAgentId].config, undefined, {
        onStatus: (s) => setStatus(s),
        onToken: (tok) => setReply((prevTok) => prevTok + tok)
      });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setStatus('done');
    }
  };

  return (
    <div style={{ marginTop: 12 }} data-llm-config-section="true">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="label">{t('llmConfig')}</div>
          <div className="small">{t('llmConfigHint')}</div>
        </div>
        <button type="button" onClick={() => setShowDetail((prev) => !prev)}>
          {showDetail ? t('llmHideDetails') : t('llmShowDetails')}
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="label">{t('llmGlobalSettings')}</div>
            <div className="small">{t('llmGlobalSettingsHint')}</div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {overallSavedAt && <span className="badge">{t('saved')}</span>}
            <button type="button" className="primary" onClick={handleSaveOverall}>{t('save')}</button>
          </div>
        </div>

        {!overallConfig.unified && (
          <div className="small" style={{ marginTop: 8, color: '#f97316' }}>{t('llmGlobalMixedWarning')}</div>
        )}

        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
          <select
            value={overallConfig.config.provider}
            onChange={(e) => handleOverallChange('provider', e.target.value as LLMAgentSettings['config']['provider'])}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{t(p.labelKey)}</option>
            ))}
          </select>
          <input
            placeholder={t('apiKey')}
            type="password"
            value={overallConfig.config.apiKey}
            onChange={(e) => handleOverallChange('apiKey', e.target.value)}
          />
          <input
            placeholder={t('model')}
            value={overallConfig.config.model}
            onChange={(e) => handleOverallChange('model', e.target.value)}
          />
          <input
            placeholder={t('baseUrl')}
            value={overallConfig.config.baseUrl}
            onChange={(e) => handleOverallChange('baseUrl', e.target.value)}
          />
        </div>
      </div>

      {showDetail && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <div>
            <div className="label">{t('llmDetailSettingsTitle')}</div>
            <div className="small">{t('llmDetailSettingsHint')}</div>
          </div>
          {agentDefs.map((def) => {
            const draft = drafts[def.id];
            const saved = savedAt[def.id];
            return (
              <div key={def.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="label">{def.title}</div>
                    <div className="small">{def.description}</div>
                  </div>
                  {saved && <span className="badge">{t('saved')}</span>}
                </div>

                <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
                  <select
                    value={draft.config.provider}
                    onChange={(e) => handleConfigChange(def.id, 'provider', e.target.value)}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{t(p.labelKey)}</option>
                    ))}
                  </select>
                  <input
                    placeholder={t('apiKey')}
                    type="password"
                    value={draft.config.apiKey}
                    onChange={(e) => handleConfigChange(def.id, 'apiKey', e.target.value)}
                  />
                  <input
                    placeholder={t('model')}
                    value={draft.config.model}
                    onChange={(e) => handleConfigChange(def.id, 'model', e.target.value)}
                  />
                  <input
                    placeholder={t('baseUrl')}
                    value={draft.config.baseUrl}
                    onChange={(e) => handleConfigChange(def.id, 'baseUrl', e.target.value)}
                  />
                </div>

                <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" onClick={() => handleSave(def.id)}>{t('save')}</button>
                    <button type="button" onClick={() => setEditingPrompt({ id: def.id, value: draft.prompt })}>{t('agentEditPrompt')}</button>
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      const value = e.target.value as AgentId | '';
                      if (value) {
                        handleCopy(def.id, value);
                        (e.target as HTMLSelectElement).value = '';
                      }
                    }}
                  >
                    <option value="">{t('agentCopyPlaceholder')}</option>
                    {agentDefs.filter((other) => other.id !== def.id).map((other) => (
                      <option key={other.id} value={other.id}>{other.title}</option>
                    ))}
                  </select>
                </div>

                <div className="small" style={{ marginTop: 12, whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'hidden' }}>
                  {draft.prompt}
                </div>

                {editingPrompt?.id === def.id && (
                  <div className="card" style={{ marginTop: 12, background: 'var(--surface-alt)' }}>
                    <div className="label">{t('agentPromptEditorTitle', { agent: def.title })}</div>
                    <textarea
                      rows={6}
                      value={editingPrompt.value}
                      onChange={(e) => setEditingPrompt({ id: def.id, value: e.target.value })}
                    />
                    <div className="row" style={{ marginTop: 8, gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => setEditingPrompt(null)}>{t('cancel')}</button>
                      <button type="button" className="primary" onClick={handlePromptSave}>{t('confirm')}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <hr className="div" />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(140px, 220px) 1fr auto', gap: 8 }}>
        <select value={testAgentId} onChange={(e) => setTestAgentId(e.target.value as AgentId)}>
          {agentDefs.map((def) => (
            <option key={def.id} value={def.id}>{def.title}</option>
          ))}
        </select>
        <input placeholder={t('yourMessage')} value={testMsg} onChange={(e)=> setTestMsg(e.target.value)} />
        <button type="button" onClick={handleTest}>{t('testLLM')}</button>
      </div>
      {(reply || err || (status !== 'idle' && status !== 'done')) && (
        <div className="card" style={{marginTop:8}}>
          {(status !== 'idle' && status !== 'done') && (
            <div className="small" style={{marginBottom:8}}>
              {status === 'waiting_response' ? t('waitingLLMResponse') : t('waitingLLMThinking')}{'.'.repeat(dots)}
            </div>
          )}
          {reply && (
            <>
              <div className="label">{t('llmReply')}</div>
              <div>{reply}</div>
            </>
          )}
          {err && (
            <>
              <div className="label">{t('llmError')}</div>
              <div style={{color:'#f87171'}}>{err}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
