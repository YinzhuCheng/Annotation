import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, ProblemRecord } from '../state/store';
import { latexCorrection, ocrWithLLM } from '../lib/llmAdapter';
import { getImageBlob } from '../lib/db';
import { generateProblemFromText } from '../lib/generator';

const SUBFIELDS = [
  'Others',
  'Point-Set Topology','Algebraic Topology','Homotopy Theory','Homology Theory','Knot Theory','Low-Dimensional Topology','Geometric Topology','Differential Topology','Foliation Theory','Degree Theory'
];

const SOURCES = [
  'Others',
  'MATH-Vision Dataset','Original Question','Math Kangaroo Contest','Caribou Contests','Lecture Notes on Basic Topology: You Cheng Ye','Armstrong Topology','Hatcher AT','Munkres Topology','SimplicialTopology','3-Manifold Topology','Introduction to 3-Manifolds'
];

export function ProblemEditor() {
  const { t } = useTranslation();
  const store = useAppStore();
  const llm = useAppStore((s)=> s.llm);
  const current = useMemo(() => store.problems.find(p => p.id === store.currentId)!, [store.problems, store.currentId]);
  const currentIndex = useMemo(() => store.problems.findIndex(p => p.id === store.currentId), [store.problems, store.currentId]);
  const hasPrev = currentIndex >= 0 && currentIndex < store.problems.length - 1;
  const hasNext = currentIndex > 0;
  const goPrev = () => { if (hasPrev) store.upsertProblem({ id: store.problems[currentIndex + 1].id }); };
  const goNext = () => { if (hasNext) store.upsertProblem({ id: store.problems[currentIndex - 1].id }); };
  const [ocrText, setOcrText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const customSubfieldInputRef = useRef<HTMLInputElement>(null);
  const customSourceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!current) return;
  }, [current]);

  const update = (patch: Partial<ProblemRecord>) => store.upsertProblem({ id: current.id, ...patch });

  const onAddImage = async (file: File) => {
    // For MVP we just create a local object URL and remember it in image field
    const url = URL.createObjectURL(file);
    update({ image: url });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) await onAddImage(file);
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) await onAddImage(file);
    }
  };

  const runOCR = async () => {
    if (!current?.image) return;
    if (!ensureLLM()) return;
    let blob: Blob | undefined;
    try {
      if (current.image.startsWith('images/')) {
        blob = await getImageBlob(current.image) as Blob | undefined;
      } else {
        const r = await fetch(current.image);
        blob = await r.blob();
      }
    } catch {}
    if (!blob) {
      alert('Image not available for OCR.');
      return;
    }
    const text = await ocrWithLLM(blob, llm);
    setOcrText(text);
  };

  const applyOcrText = () => {
    if (!ocrText.trim()) return;
    update({ question: ocrText });
  };

  const ensureLLM = (): boolean => {
    if (!llm.apiKey?.trim() || !llm.model?.trim() || !llm.baseUrl?.trim()) {
      alert(`${t('llmMissingTitle')}: ${t('llmMissingBody')}`);
      // Scroll to config area
      document.querySelector('.label')?.scrollIntoView({ behavior: 'smooth' });
      return false;
    }
    return true;
  };

  const fixLatex = async (field: 'question' | 'answer') => {
    const text = (current as any)[field] as string;
    if (!text?.trim()) return;
    if (!ensureLLM()) return;
    const corrected = await latexCorrection(text, llm);
    update({ [field]: corrected } as any);
  };

  const generate = async () => {
    const input = current.question?.trim() || ocrText.trim();
    if (!input) return;
    if (!ensureLLM()) return;
    const patch = await generateProblemFromText(input, current.questionType, llm);
    update(patch);
  };

  const ensureOptionsForMC = () => {
    if (current.questionType === 'Multiple Choice') {
      if (!current.options || current.options.length !== 5) {
        update({ options: ['A','B','C','D','E'] });
      }
    }
  };

  useEffect(() => { ensureOptionsForMC(); }, [current.questionType]);

  // ----- Subfield helpers -----
  const selectedSubfields = useMemo(() => (current.subfield ? current.subfield.split(';').filter(Boolean) : []), [current.subfield]);
  const [showCustomSubfield, setShowCustomSubfield] = useState(false);
  const [customSubfield, setCustomSubfield] = useState('');

  const addSubfield = (value: string) => {
    const v = value.trim();
    if (!v) return;
    const set = new Set(selectedSubfields);
    set.add(v);
    update({ subfield: Array.from(set).join(';') });
  };
  const removeSubfield = (value: string) => {
    const next = selectedSubfields.filter(s => s !== value);
    update({ subfield: next.join(';') });
  };
  const onSelectSubfield = (v: string) => {
    if (!v) return;
    if (v === 'Others') {
      setShowCustomSubfield(true);
      setTimeout(() => customSubfieldInputRef.current?.focus(), 0);
      return;
    }
    addSubfield(v);
  };
  const confirmCustomSubfield = () => {
    if (!customSubfield.trim()) return;
    addSubfield(customSubfield);
    setCustomSubfield('');
    setShowCustomSubfield(false);
  };

  return (
    <div>
      <div className="row" style={{justifyContent:'space-between'}}>
        <div className="row" style={{gap:8}}>
          <button className="primary" onClick={() => store.newProblem()}>{t('newProblem')}</button>
          <button onClick={() => store.upsertProblem({})}>{t('saveProblem')}</button>
        </div>
        <div className="row" style={{gap:8}}>
          <button onClick={goPrev} disabled={!hasPrev}>{t('prev')}</button>
          <button onClick={goNext} disabled={!hasNext}>{t('next')}</button>
          <span className="small">ID: {current.id}</span>
        </div>
      </div>

      <hr className="div" />

      <div className="grid grid-2">
        <div>
          <div className="label">{t('problemText')}</div>
          <textarea value={current.question} onChange={(e)=> update({ question: e.target.value })} onPaste={onPaste} />
          <div className="row" style={{justifyContent:'space-between'}}>
            <button onClick={() => fixLatex('question')}>{t('latexFix')}</button>
            <span className="small">{t('latexFixHint')}</span>
          </div>

          <div className="label" style={{marginTop:12}}>{t('targetType')}</div>
          <select value={current.questionType} onChange={(e)=> update({ questionType: e.target.value as any })}>
            <option>Multiple Choice</option>
            <option>Fill-in-the-blank</option>
            <option>Proof</option>
          </select>
          <div className="small" style={{marginTop:6}}>{t('type_hint')}</div>

          <div className="row" style={{marginTop:8}}>
            <button className="primary" onClick={generate}>{t('generate')}</button>
          </div>

          {current.questionType === 'Multiple Choice' && (
            <div style={{marginTop:12}}>
              <div className="label">{t('options')}</div>
              <div className="options-grid">
                {['A','B','C','D','E'].map((k, idx) => (
                  <input key={k} value={current.options[idx] || ''} onChange={(e)=>{
                    const next = [...(current.options||[])];
                    next[idx] = e.target.value;
                    update({ options: next });
                  }} placeholder={k} />
                ))}
              </div>
            </div>
          )}

          <div style={{marginTop:12}}>
            <div className="label">{t('answer')}</div>
            <textarea value={current.answer} onChange={(e)=> update({ answer: e.target.value })} />
            <div className="row" style={{justifyContent:'space-between'}}>
              <button onClick={() => fixLatex('answer')}>{t('latexFix')}</button>
              <span className="small">{t('latexFixHint')}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="label">{t('uploadImage')}</div>
          <div className="dropzone" onDrop={onDrop} onDragOver={(e)=> e.preventDefault()} onPaste={onPaste}>
            <div className="row" style={{justifyContent:'center', gap:8}}>
              <input type="file" accept="image/*" style={{display:'none'}} ref={fileInputRef} onChange={(e)=>{
                const f = e.target.files?.[0];
                if (f) onAddImage(f);
              }} />
              <button onClick={()=> fileInputRef.current?.click()}>Browse</button>
              <span className="small">Drag & drop or paste screenshot</span>
            </div>
          </div>
          {current.image && (
            <div style={{marginTop:8}}>
              <img className="preview" src={current.image} />
            </div>
          )}

          <div className="row" style={{marginTop:8, gap:8}}>
            <button onClick={runOCR}>{t('ocrExtract')}</button>
            <button onClick={applyOcrText}>{t('confirmText')}</button>
          </div>
          {ocrText && (
            <textarea style={{marginTop:8}} value={ocrText} onChange={(e)=> setOcrText(e.target.value)} />
          )}

          <div className="card" style={{marginTop:12}}>
            <div className="label">{t('subfield')}</div>
            <div className="row" style={{gap:8, flexWrap:'wrap'}}>
              <select onChange={(e)=>{ onSelectSubfield(e.target.value); (e.target as HTMLSelectElement).value=''; }} defaultValue="">
                <option value="" disabled>—</option>
                {SUBFIELDS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {showCustomSubfield && (
                <div className="row" style={{gap:8}}>
                  <input ref={customSubfieldInputRef} value={customSubfield} placeholder={t('subfield_others')} onChange={(e)=> setCustomSubfield(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') confirmCustomSubfield(); }} />
                  <button onClick={confirmCustomSubfield}>{t('confirmText')}</button>
                </div>
              )}
              {selectedSubfields.length > 0 && (
                <div className="row" style={{gap:6, flexWrap:'wrap'}}>
                  {selectedSubfields.map(s => (
                    <span key={s} className="badge" style={{display:'inline-flex', alignItems:'center', gap:6}}>
                      {s}
                      <button onClick={()=> removeSubfield(s)} style={{padding:'0 6px'}}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              {/* Display the final joined result */}
              <div className="row" style={{gap:8, width:'100%'}}>
                <span className="small">Result:</span>
                <input style={{flex:1, minWidth:0}} value={current.subfield} readOnly />
              </div>
              <span className="small">{t('selectSubfieldHint')}</span>
            </div>
          </div>

          <div style={{marginTop:12}}>
            <div className="label">{t('source')}</div>
            <div className="row" style={{gap:8, flexWrap:'wrap'}}>
              <select
                value={SOURCES.includes(current.source) ? current.source : ''}
                onChange={(e)=>{
                  const v = e.target.value;
                  if (v === 'Others') {
                    update({ source: '' });
                    setTimeout(()=> customSourceInputRef.current?.focus(), 0);
                  } else {
                    update({ source: v });
                  }
                }}
              >
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input
                ref={customSourceInputRef}
                placeholder={'Others (custom)'}
                value={current.source}
                onChange={(e)=> update({ source: e.target.value })}
                style={{flex:1, minWidth:0}}
              />
            </div>
          </div>

          <div className="grid" style={{gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginTop:12}}>
            <div>
              <div className="label">{t('academic')}</div>
              <select value={current.academicLevel} onChange={(e)=> update({ academicLevel: e.target.value as any })}>
                <option value="K12">{t('k12')}</option>
                <option value="Professional">{t('professional')}</option>
              </select>
            </div>
            <div>
              <div className="label">{t('difficulty')}</div>
              <select value={current.difficulty} onChange={(e)=> update({ difficulty: Number(e.target.value) as any })}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
