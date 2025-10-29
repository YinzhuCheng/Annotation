import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';

export function DefaultsPage(props: { onBack: () => void }) {
  const { t } = useTranslation();
  const defaults = useAppStore((s) => s.defaults);
  const setDefaults = useAppStore((s) => s.setDefaults);
  const applyOptionsCountToExisting = useAppStore((s) => s.applyOptionsCountToExisting);

  const [subfield, setSubfield] = useState(defaults.subfield);
  const [source, setSource] = useState(defaults.source);
  const [academicLevel, setAcademicLevel] = useState<'K12' | 'Professional'>(defaults.academicLevel);
  const [difficulty, setDifficulty] = useState<1|2|3>(defaults.difficulty);
  const [optionsCount, setOptionsCount] = useState<number>(defaults.optionsCount || 5);

  const onConfirm = () => {
    const next = { subfield, source, academicLevel, difficulty, optionsCount: Math.max(2, Math.min(10, Math.floor(optionsCount))) };
    setDefaults(next);
    // Always apply option count to existing Multiple Choice problems
    applyOptionsCountToExisting(next.optionsCount);
    props.onBack();
  };

  return (
    <div className="card" style={{marginTop:16}}>
      <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
        <div className="label">{t('defaultValues')}</div>
        <button onClick={props.onBack}>{t('back')}</button>
      </div>
      <div className="grid" style={{gridTemplateColumns:'1fr 1fr', gap:12}}>
        <div>
          <div className="label">{t('subfield')}</div>
          <input value={subfield} onChange={(e)=> setSubfield(e.target.value)} placeholder={t('subfield_others')} />
        </div>
        <div>
          <div className="label">{t('source')}</div>
          <input value={source} onChange={(e)=> setSource(e.target.value)} placeholder={t('subfield_others')} />
        </div>
        <div>
          <div className="label">{t('academic')}</div>
          <select value={academicLevel} onChange={(e)=> setAcademicLevel(e.target.value as any)}>
            <option value="K12">{t('k12')}</option>
            <option value="Professional">{t('professional')}</option>
          </select>
        </div>
        <div>
          <div className="label">{t('difficulty')}</div>
          <select value={difficulty} onChange={(e)=> setDifficulty(Number(e.target.value) as any)}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </div>
        <div>
          <div className="label">{t('defaultOptionsCount')}</div>
          <input type="number" min={2} max={10} value={optionsCount} onChange={(e)=> setOptionsCount(Number(e.target.value))} />
        </div>
      </div>
      <div className="row" style={{marginTop:12, justifyContent:'flex-end', gap:8}}>
        <button onClick={props.onBack}>{t('cancel')}</button>
        <button className="primary" onClick={onConfirm}>{t('confirm')}</button>
      </div>
    </div>
  );
}
