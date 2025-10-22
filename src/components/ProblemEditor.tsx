import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, ProblemRecord } from '../state/store';
import { latexCorrection } from '../lib/llmAdapter';
import Tesseract from 'tesseract.js';
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
  const [ocrText, setOcrText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const result = await Tesseract.recognize(current.image, 'eng');
    setOcrText(result.data.text || '');
  };

  const applyOcrText = () => {
    if (!ocrText.trim()) return;
    update({ question: ocrText });
  };

  const ensureLLM = (): boolean => {
    if (!llm.apiKey?.trim() || !llm.model?.trim()) {
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

  return (
    <div>
      <div className="row" style={{justifyContent:'space-between'}}>
        <div className="row" style={{gap:8}}>
          <button className="primary" onClick={() => store.newProblem()}>{t('newProblem')}</button>
          <button onClick={() => store.upsertProblem({})}>{t('saveProblem')}</button>
        </div>
        <span className="small">ID: {current.id}</span>
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
              <div className="grid" style={{gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr', gap: 8}}>
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

          <div style={{marginTop:12}}>
            <div className="label">{t('subfield')}</div>
            <div className="row" style={{gap:8, flexWrap:'wrap'}}>
              <select onChange={(e)=>{
                const v = e.target.value;
                const parts = (current.subfield? current.subfield.split(';'): []).filter(Boolean);
                parts.push(v);
                update({ subfield: Array.from(new Set(parts)).join(';') });
              }} value="">
                <option value="" disabled>—</option>
                {SUBFIELDS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input placeholder={t('subfield_others')} onKeyDown={(e)=>{
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (v) {
                    const parts = (current.subfield? current.subfield.split(';'): []).filter(Boolean);
                    parts.push(v);
                    update({ subfield: Array.from(new Set(parts)).join(';') });
                    (e.target as HTMLInputElement).value='';
                  }
                }
              }} />
              <span className="small">{t('selectSubfieldHint')}</span>
            </div>
          </div>

          <div style={{marginTop:12}}>
            <div className="label">{t('source')}</div>
            <select value={current.source} onChange={(e)=> update({ source: e.target.value })}>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
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
