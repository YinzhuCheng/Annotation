import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import * as XLSX from 'xlsx';
import { downloadBlob } from '../lib/storage';
import { getImageBlob, saveImageBlobAtPath } from '../lib/db';
import JSZip from 'jszip';

const HEADER = [
  'id','Question','Question_type','Options','Answer','Subfield','Source','Image','Image_dependency','Academic_Level','Difficulty'
];

export function ImportExport() {
  const { t } = useTranslation();
  const { problems, upsertProblem } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importedImagesCount, setImportedImagesCount] = useState<number | null>(null);

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
    const blob = new Blob([xlsxArrayBuffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `dataset-${Date.now()}.xlsx`);
  };

  // Export both XLSX and images into a single zip (Datasets)
  const exportDatasets = async () => {
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
    const imageColIndex = HEADER.indexOf('Image');
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      if (!p.image) continue;
      const cellAddr = XLSX.utils.encode_cell({ r: i + 1, c: imageColIndex });
      const v = `${p.id}.jpg`;
      (ws as any)[cellAddr] = { t: 's', v, l: { Target: `images/${v}`, Tooltip: v } };
    }
    const xlsxArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    const zip = new JSZip();
    zip.file('dataset.xlsx', xlsxArrayBuffer as ArrayBuffer);
    for (const p of problems) {
      if (!p.image) continue;
      try {
        let blob: Blob | undefined;
        if (p.image.startsWith('images/')) {
          blob = (await getImageBlob(p.image)) as Blob | undefined;
        } else {
          const r = await fetch(p.image);
          blob = await r.blob();
        }
        if (blob) zip.file(`images/${p.id}.jpg`, blob);
      } catch {
        // ignore
      }
    }
    const out = await zip.generateAsync({ type: 'blob' });
    downloadBlob(out, `datasets-${Date.now()}.zip`);
  };

  const exportImages = async () => {
    const zip = new JSZip();
    for (const p of problems) {
      if (!p.image) continue;
      try {
        let blob: Blob | undefined;
        if (p.image.startsWith('images/')) {
          blob = (await getImageBlob(p.image)) as Blob | undefined;
        } else {
          const r = await fetch(p.image);
          blob = await r.blob();
        }
        if (blob) {
          zip.file(`${p.id}.jpg`, blob);
        }
      } catch {
        // ignore missing blobs
      }
    }
    const out = await zip.generateAsync({ type: 'blob' });
    downloadBlob(out, `images-${Date.now()}.zip`);
  };

  const importXlsx = async (file: File): Promise<number> => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json<string[]> (ws, { header: 1 });
    const header = (arr[0] as string[]) || [];
    const idx = (name: string) => header.indexOf(name);
    let count = 0;
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
      count++;
    }
    return count;
  };

  // Import images from dropped files/folders; filenames must be <id>.jpg or .jpeg
  const importImagesFromFiles = async (files: File[]): Promise<number> => {
    let count = 0;
    const setById = new Set(problems.map(p => p.id));
    for (const f of files) {
      const name = f.name.toLowerCase();
      if (!(name.endsWith('.jpg') || name.endsWith('.jpeg'))) continue;
      const id = name.replace(/\.(jpg|jpeg)$/i, '');
      if (!setById.has(id)) continue; // only update existing problems
      const path = `images/${id}.jpg`;
      await saveImageBlobAtPath(path, f);
      // update problem to point to this image
      upsertProblem({ id, image: path });
      count++;
    }
    return count;
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

  const onDropXlsx = async (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = await collectDroppedFiles(e.dataTransfer.items);
    const files = dropped.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    let total = 0;
    for (const f of files) {
      total += await importXlsx(f);
    }
    if (total > 0) setImportedCount(total);
  };

  const onDropImages = async (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = await collectDroppedFiles(e.dataTransfer.items);
    const files = dropped.filter(f => /\.(jpg|jpeg)$/i.test(f.name));
    const c = await importImagesFromFiles(files);
    if (c > 0) setImportedImagesCount(c);
  };

  return (
    <div className="grid" style={{gap:12, gridTemplateColumns:'1fr'}}>
      <div className="row" style={{gap:8, flexWrap:'wrap'}}>
        <button onClick={exportXlsx}>{t('exportXlsx')}</button>
        <button onClick={exportImages}>{t('exportImages')}</button>
        <button onClick={exportDatasets}>{t('exportDatasets')}</button>
      </div>

      <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={onDropXlsx} style={{padding:'8px 12px'}}>
        <div className="row" style={{justifyContent:'center', gap:8, alignItems:'center'}}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            style={{display:'none'}}
            onChange={async (e)=>{
              const f = e.target.files?.[0];
              if (f) {
                const c = await importXlsx(f);
                if (c > 0) setImportedCount(c);
              }
            }}
          />
          <button onClick={()=> fileInputRef.current?.click()}>{t('importXlsx')}</button>
          <span className="small">{t('importXlsxHint')}</span>
          {importedCount !== null && (
            <span className="small" style={{ marginLeft: 8 }}>
              {t('importSuccess', { count: importedCount })}
            </span>
          )}
        </div>
      </div>

      <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={onDropImages} style={{padding:'8px 12px'}}>
        <div className="row" style={{justifyContent:'center', gap:8, alignItems:'center'}}>
          {(() => {
            let dirEl: HTMLInputElement | null = null;
            return (
              <>
                <input
                  type="file"
                  style={{display:'none'}}
                  multiple
                  ref={(el)=>{ if (el) { el.setAttribute('webkitdirectory',''); el.setAttribute('directory',''); dirEl = el; } }}
                  accept="image/jpeg,image/jpg"
                  onChange={async (e)=>{
                    const files = Array.from(e.target.files || []).filter(f => /\.(jpg|jpeg)$/i.test(f.name));
                    const c = await importImagesFromFiles(files);
                    if (c > 0) setImportedImagesCount(c);
                  }}
                />
                <button onClick={()=> dirEl?.click()}>{t('importImages')}</button>
                <span className="small">{t('importImagesHint')}</span>
                {importedImagesCount !== null && (
                  <span className="small" style={{ marginLeft: 8 }}>
                    {t('importImagesSuccess', { count: importedImagesCount })}
                  </span>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
