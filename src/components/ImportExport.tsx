import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import * as XLSX from 'xlsx';
import { downloadBlob } from '../lib/storage';
import JSZip from 'jszip';
import { getImageBlob } from '../lib/db';

const HEADER = [
  'id','Question','Question_type','Options','Answer','Subfield','Source','Image','Image_dependency','Academic_Level','Difficulty'
];

export function ImportExport() {
  const { t } = useTranslation();
  const { problems, upsertProblem } = useAppStore();

  const exportXlsx = async () => {
    // Build rows; Image column should contain the intended exported filename (<id>.jpg) when present
    const rows = problems.map(p => ([
      p.id,
      p.question,
      p.questionType,
      (p.questionType === 'Multiple Choice') ? (JSON.stringify(
        (p.options?.length===5 ? p.options : ['', '', '', '', '']).map((opt, i) => {
          const label = String.fromCharCode(65 + i);
          const trimmed = String(opt || '').trim();
          if (!trimmed) return '';
          const hasPrefix = new RegExp(`^${label}\\s*:`).test(trimmed);
          return hasPrefix ? trimmed : `${label}: ${trimmed}`;
        })
      )) : '',
      p.answer,
      p.subfield,
      p.source,
      p.image ? `${p.id}.jpg` : '',
      p.image ? 1 : 0,
      p.academicLevel,
      p.difficulty,
    ]));
    const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    // Add hyperlink for Image column pointing to images/<id>.jpg
    const imageColIndex = HEADER.indexOf('Image'); // 0-based
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      if (!p.image) continue;
      const cellAddr = XLSX.utils.encode_cell({ r: i + 1, c: imageColIndex }); // +1 for header row
      const v = `${p.id}.jpg`;
      (ws as any)[cellAddr] = { t: 's', v, l: { Target: `images/${v}`, Tooltip: v } };
    }
    const xlsxArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    // Package XLSX and images together into a single zip
    const zip = new JSZip();
    zip.file('dataset.xlsx', xlsxArrayBuffer as ArrayBuffer);

    // Add images as images/<id>.jpg when available
    for (const p of problems) {
      if (!p.image) continue;
      try {
        let blob: Blob | undefined;
        if (p.image.startsWith('images/')) {
          blob = await getImageBlob(p.image) as Blob | undefined;
        } else {
          const r = await fetch(p.image);
          blob = await r.blob();
        }
        if (blob) {
          zip.file(`images/${p.id}.jpg`, blob);
        }
      } catch {
        // ignore missing blobs
      }
    }

    const outZip = await zip.generateAsync({ type: 'blob' });
    downloadBlob(outZip, `dataset-${Date.now()}.zip`);
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
      if (questionType === 'Multiple Choice') {
        // Normalize to 5 items
        if (options.length !== 5) options = ['', '', '', '', ''];
        // Strip leading "A:", "B:", etc. if present
        options = options.map((opt, i) => {
          const label = String.fromCharCode(65 + i);
          const s = String(opt || '');
          return s.replace(new RegExp(`^${label}\\s*:\\s*`), '');
        });
      } else {
        options = [];
      }
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

  // Collect dropped files, supporting folders via webkit entries
  const collectDroppedFiles = async (items: DataTransferItemList): Promise<File[]> => {
    const filePromises: Promise<File[]>[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = (item as any).webkitGetAsEntry?.();
      if (entry) {
        filePromises.push(traverseEntry(entry));
      } else {
        const file = item.getAsFile();
        if (file) filePromises.push(Promise.resolve([file]));
      }
    }
    const nested = await Promise.all(filePromises);
    return nested.flat();
  };

  const traverseEntry = async (entry: any): Promise<File[]> => {
    if (!entry) return [];
    if (entry.isFile) {
      return new Promise<File[]>((resolve) => {
        entry.file((file: File) => resolve([file]));
      });
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      return new Promise<File[]>((resolve) => {
        const all: File[] = [];
        const readBatch = () => {
          reader.readEntries(async (entries: any[]) => {
            if (!entries.length) return resolve(all);
            for (const e of entries) {
              const files = await traverseEntry(e);
              all.push(...files);
            }
            readBatch();
          });
        };
        readBatch();
      });
    }
    return [];
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = await collectDroppedFiles(e.dataTransfer.items);
    const files = dropped.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    for (const f of files) await importXlsx(f);
  };

  const folderInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  return (
    <div className="row" style={{gap:8}}>
      <button onClick={exportXlsx}>{t('exportXlsx')}</button>
      <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={onDrop} style={{padding:'8px 12px'}}>
        <div className="row" style={{gap:8, alignItems:'center', justifyContent:'center'}}>
          <label className="row" style={{gap:8, alignItems:'center'}}>
            <input type="file" accept=".xlsx" style={{display:'none'}} onChange={(e)=> {
              const f = e.target.files?.[0];
              if (f) importXlsx(f);
            }} />
            <button>{t('importXlsx')}</button>
          </label>
          <label className="row" style={{gap:8, alignItems:'center'}}>
            <input ref={folderInputRef} type="file" accept=".xlsx" style={{display:'none'}} multiple onChange={(e)=>{
              const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.xlsx'));
              files.forEach(f => importXlsx(f));
            }} />
            <button>{t('importXlsxFolder')}</button>
          </label>
        </div>
        <span className="small">Drag & drop .xlsx files or folders to import</span>
      </div>
    </div>
  );
}
