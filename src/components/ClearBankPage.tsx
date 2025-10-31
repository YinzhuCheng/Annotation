import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';

export function ClearBankPage(props: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const clearAll = useAppStore((s) => s.clearAllProblems);
  const [input, setInput] = useState('');
  const [ok, setOk] = useState(false);

  const phrase = i18n.language === 'zh' ? t('clearConfirmPhrase_zh') : t('clearConfirmPhrase_en');

  useEffect(() => {
    setOk(input.trim() === phrase);
  }, [input, phrase]);

  const onConfirm = () => {
    if (!ok) return;
    clearAll();
    props.onBack();
  };

  return (
    <div className="card" style={{marginTop:16}}>
      <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
        <div className="label">{t('clearBankTitle')}</div>
        <button onClick={props.onBack}>{t('back')}</button>
      </div>
      <div style={{whiteSpace:'pre-wrap'}}>{t('clearBankInstruction')}</div>
      <div className="row" style={{marginTop:12}}>
        <input style={{flex:1}} placeholder={phrase} value={input} onChange={(e)=> setInput(e.target.value)} />
      </div>
      <div className="row" style={{marginTop:12, justifyContent:'flex-end', gap:8}}>
        <button onClick={props.onBack}>{t('cancel')}</button>
        <button className="primary" disabled={!ok} onClick={onConfirm}>{t('confirm')}</button>
      </div>
    </div>
  );
}
