import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import { chatStream } from '../lib/llmAdapter';

export function LLMConfig() {
  const { t } = useTranslation();
  const llm = useAppStore((s) => s.llm);
  const setLLM = useAppStore((s) => s.setLLM);
  const mode = useAppStore((s) => s.mode);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { t: tr } = useTranslation();
  const [testMsg, setTestMsg] = useState('');
  const [reply, setReply] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const [status, setStatus] = useState<'idle'|'waiting_response'|'thinking'|'responding'|'done'>('idle');
  const [dots, setDots] = useState(1);

  useEffect(() => {
    if (status === 'idle' || status === 'done') return;
    const timer = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(timer);
  }, [status]);

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
      <div className="row" style={{marginTop: 8, justifyContent:'flex-start', gap:8}}>
        <button onClick={save}>{t('save')}</button>
      </div>

      <hr className="div" />
      <div className="grid" style={{gridTemplateColumns:'1fr auto', gap:8}}>
        <input placeholder={t('yourMessage')} value={testMsg} onChange={(e)=> setTestMsg(e.target.value)} />
        <button onClick={async ()=>{
          setErr(''); setReply(''); setStatus('idle');
          try {
            if (!llm.apiKey?.trim() || !llm.model?.trim() || !llm.baseUrl?.trim()) {
              throw new Error(t('llmMissingBody'));
            }
            await chatStream([{ role:'user', content: testMsg }], llm, undefined, {
              onStatus: (s) => setStatus(s),
              onToken: (tok) => setReply((r)=> r + tok)
            });
          } catch (e:any) {
            setErr(String(e?.message || e));
          } finally {
            setStatus('done');
          }
        }}>{t('testLLM')}</button>
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
