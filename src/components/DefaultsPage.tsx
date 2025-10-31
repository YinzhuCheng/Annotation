import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';

export function DefaultsPage(props: { onBack: () => void }) {
  const { t } = useTranslation();
  const defaults = useAppStore((s) => s.defaults);
  const setDefaults = useAppStore((s) => s.setDefaults);
  const applyOptionsCountToExisting = useAppStore((s) => s.applyOptionsCountToExisting);
  const [authorized, setAuthorized] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('defaults-admin-authed') === '1';
    } catch {
      return false;
    }
  });
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [subfields, setSubfields] = useState<string[]>(() => [...defaults.subfieldOptions]);
  const [sources, setSources] = useState<string[]>(() => [...defaults.sourceOptions]);
  const [academicLevels, setAcademicLevels] = useState<string[]>(() => [...defaults.academicLevels]);
  const [difficulties, setDifficulties] = useState<string[]>(() => [...defaults.difficultyOptions]);
  const [difficultyPrompt, setDifficultyPrompt] = useState<string>(defaults.difficultyPrompt);
  const [optionsCount, setOptionsCount] = useState<number>(defaults.optionsCount || 5);

  const [newSubfield, setNewSubfield] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newAcademic, setNewAcademic] = useState('');
  const [newDifficulty, setNewDifficulty] = useState('');

  useEffect(() => {
    setSubfields([...defaults.subfieldOptions]);
    setSources([...defaults.sourceOptions]);
    setAcademicLevels([...defaults.academicLevels]);
    setDifficulties([...defaults.difficultyOptions]);
    setDifficultyPrompt(defaults.difficultyPrompt);
    setOptionsCount(defaults.optionsCount || 5);
  }, [defaults]);

  const ensureAdd = (items: string[], nextItem: string, setter: (items: string[]) => void) => {
    const value = nextItem.trim();
    if (!value) return;
    if (items.includes(value)) return;
    setter([...items, value]);
  };

  const removeItem = (items: string[], target: string, setter: (items: string[]) => void) => {
    setter(items.filter((item) => item !== target));
  };

  const handleAuth = (e: FormEvent) => {
    e.preventDefault();
    if (password === '111111') {
      setAuthorized(true);
      setPassword('');
      setPasswordError(null);
      try { sessionStorage.setItem('defaults-admin-authed', '1'); } catch {}
    } else {
      setPasswordError(t('defaultsAdminError'));
    }
  };

  const onConfirm = () => {
    const nextOptionsCount = Math.max(2, Math.min(10, Math.floor(Number(optionsCount) || defaults.optionsCount || 5)));
    const payload = {
      subfieldOptions: subfields,
      sourceOptions: sources,
      academicLevels,
      difficultyOptions: difficulties,
      difficultyPrompt,
      optionsCount: nextOptionsCount
    };
    setDefaults(payload);
    applyOptionsCountToExisting(nextOptionsCount);
    props.onBack();
  };

  const listHint = useMemo(() => t('defaultsListHint'), [t]);

  const renderListEditor = (
    label: string,
    items: string[],
    newValue: string,
    setNewValue: (v: string) => void,
    onAdd: () => void,
    onRemove: (value: string) => void,
    hint?: string
  ) => (
    <div>
      <div className="label">{label}</div>
      {hint && <div className="small" style={{ marginBottom: 6 }}>{hint}</div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={t('defaultsAddPlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAdd();
            }
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="button" onClick={(e) => { e.preventDefault(); onAdd(); }}>{t('defaultsAddButton')}</button>
      </div>
      {items.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {items.map((item) => (
            <span key={item} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                style={{ padding: '0 6px' }}
                aria-label={t('defaultsRemoveItem', { item })}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="label">{t('defaultValues')}</div>
        <button onClick={props.onBack}>{t('back')}</button>
      </div>

      {!authorized ? (
        <form onSubmit={handleAuth} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="label">{t('defaultsAdminPrompt')}</div>
            <div className="small">{t('defaultsAdminHint')}</div>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPasswordError(null); }}
            placeholder={t('defaultsAdminPasswordPlaceholder')}
          />
          {passwordError && (
            <div className="small" style={{ color: '#f87171' }}>{passwordError}</div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={props.onBack}>{t('cancel')}</button>
            <button className="primary" type="submit">{t('defaultsAdminSubmit')}</button>
          </div>
        </form>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
          {renderListEditor(t('subfield'), subfields, newSubfield, setNewSubfield, () => {
            ensureAdd(subfields, newSubfield, setSubfields);
            setNewSubfield('');
          }, (value) => removeItem(subfields, value, setSubfields), listHint)}

          {renderListEditor(t('source'), sources, newSource, setNewSource, () => {
            ensureAdd(sources, newSource, setSources);
            setNewSource('');
          }, (value) => removeItem(sources, value, setSources), listHint)}

          {renderListEditor(t('academic'), academicLevels, newAcademic, setNewAcademic, () => {
            ensureAdd(academicLevels, newAcademic, setAcademicLevels);
            setNewAcademic('');
          }, (value) => removeItem(academicLevels, value, setAcademicLevels), t('defaultsAcademicHint'))}

          <div>
            {renderListEditor(t('difficulty'), difficulties, newDifficulty, setNewDifficulty, () => {
              ensureAdd(difficulties, newDifficulty, setDifficulties);
              setNewDifficulty('');
            }, (value) => removeItem(difficulties, value, setDifficulties), t('defaultsDifficultyHint'))}
            <div style={{ marginTop: 12 }}>
              <div className="label">{t('defaultsDifficultyPromptLabel')}</div>
              <input
                value={difficultyPrompt}
                onChange={(e) => setDifficultyPrompt(e.target.value)}
                placeholder="Difficulty (1=easy, 3=hard)"
              />
            </div>
          </div>

          <div>
            <div className="label">{t('defaultOptionsCount')}</div>
            <div className="small" style={{ marginBottom: 6 }}>{t('defaultsOptionsCountHint')}</div>
            <input
              type="number"
              min={2}
              max={10}
              value={optionsCount}
              onChange={(e) => setOptionsCount(Number(e.target.value) || 0)}
            />
          </div>
        </div>
      )}

      {authorized && (
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={props.onBack}>{t('cancel')}</button>
          <button className="primary" onClick={onConfirm}>{t('confirm')}</button>
        </div>
      )}
    </div>
  );
}
