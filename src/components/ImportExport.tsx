import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import * as XLSX from 'xlsx';
import { downloadBlob } from '../lib/storage';

const HEADER = [
  'id','Question','Question_type','Options','Answer','Subfield','Source','Image','Image_dependency','Academic_Level','Difficulty'
];

export function ImportExport() {
  const { t } = useTranslation();
  const { problems, upsertProblem } = useAppStore();

  const exportXlsx = () => {
    const rows = problems.map(p => ([
      p.id,
      p.question,
      p.questionType,
      (p.questionType === 'Multiple Choice') ? (p.options?.length===5 ? JSON.stringify(p.options) : JSON.stringify(['A','B','C','D','E'])) : '',
      p.answer,
      p.subfield,
      p.source,
      p.image || '',
      p.image ? 1 : 0,
      p.academicLevel,
      p.difficulty,
    ]));
    const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `dataset-${Date.now()}.xlsx`);
  };

  const importXlsx = async (file: File) => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json<string[]> (ws, { header: 1 });
    const header = (arr[0] as string[]) || [];
    const idx = (name: string) => header.indexOf(name);
    for (let i=1;i<arr.length;i++){
      const row = arr[i] as any[];
      if (!row?.length) continue;
      const id = String(row[idx('id')] || `${Date.now()}`);
      const question = String(row[idx('Question')] || '');
      const questionType = String(row[idx('Question_type')] || 'Multiple Choice') as any;
      let options: string[] = [];
      const optionsRaw = row[idx('Options')];
      if (optionsRaw) {
        try { options = JSON.parse(optionsRaw); } catch {}
      }
      if (questionType === 'Multiple Choice' && options.length !== 5) options = ['A','B','C','D','E'];
      const answer = String(row[idx('Answer')] || '');
      const subfield = String(row[idx('Subfield')] || '');
      const source = String(row[idx('Source')] || '');
      const image = String(row[idx('Image')] || '');
      const imageDependency = image ? 1 : 0;
      const academicLevel = String(row[idx('Academic_Level')] || 'K12') as any;
      const difficulty = Number(row[idx('Difficulty')] || 1) as any;
      upsertProblem({ id, question, questionType, options, answer, subfield, source, image, imageDependency, academicLevel, difficulty });
    }
  };

  return (
    <div className="row" style={{gap:8}}>
      <button onClick={exportXlsx}>{t('exportXlsx')}</button>
      <label className="row" style={{gap:8, alignItems:'center'}}>
        <input type="file" accept=".xlsx" style={{display:'none'}} onChange={(e)=> {
          const f = e.target.files?.[0];
          if (f) importXlsx(f);
        }} />
        <button>{t('importXlsx')}</button>
      </label>
    </div>
  );
}
