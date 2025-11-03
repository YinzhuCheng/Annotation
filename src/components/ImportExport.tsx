import { useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import * as XLSX from 'xlsx';
import { downloadBlob } from '../lib/storage';
import { getImageBlob, saveImageBlobAtPath } from '../lib/db';
import JSZip from 'jszip';
import { formatTimestampName } from '../lib/fileNames';

const HEADER = [
  'id','Question','Question_Type','Options','Answer','Subfield','Source','Image','Image_Dependency','Academic_Level','Difficulty'
];

export function ImportExport() {
  const { t } = useTranslation();
  const { problems, upsertProblem } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesFolderInputRef = useRef<HTMLInputElement>(null);
  const xlsxPasteTargetRef = useRef<HTMLTextAreaElement>(null);
  const imagesPasteTargetRef = useRef<HTMLTextAreaElement>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importedImagesCount, setImportedImagesCount] = useState<number | null>(null);
  const [lastXlsxGeneratedName, setLastXlsxGeneratedName] = useState('');
  const [lastImagesGeneratedName, setLastImagesGeneratedName] = useState('');

  const focusHiddenPasteTarget = (ref: RefObject<HTMLTextAreaElement>) => {
    const target = ref.current;
    if (!target) return;
    target.value = '';
    target.focus({ preventScroll: true });
    target.select();
  };

  const buildRows = () => problems.map(p => {
    const question = String(p.question ?? '');
    const questionType = p.questionType;
    const optionsSerialized = questionType === 'Multiple Choice'
      ? JSON.stringify((p.options || []).map((opt, i) => {
          const label = String.fromCharCode(65 + i);
          const trimmed = String(opt || '').trim();
          if (!trimmed) return '';
          const hasPrefix = new RegExp(`^${label}\s*:`).test(trimmed);
          return hasPrefix ? trimmed : `${label}: ${trimmed}`;
        }))
      : '';
    const answer = String(p.answer ?? '');
    const subfield = String(p.subfield ?? '');
    const source = String(p.source ?? '');
    const imageName = p.image ? `${p.id}.jpg` : '';
    const imageDependency = p.image ? 1 : 0;
    const academicLevel = String(p.academicLevel ?? '');
    const difficulty = String(p.difficulty ?? '');
    return [
      p.id,
      question,
      questionType,
      optionsSerialized,
      answer,
      subfield,
      source,
      imageName,
      imageDependency,
      academicLevel,
      difficulty
    ];
  });

  const createWorksheet = (rows: (string | number)[][]) => {
    const data = [HEADER, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: data.length - 1, c: HEADER.length - 1 }
    });
    return ws;
  };

  const applyImageHyperlinks = (ws: XLSX.WorkSheet) => {
    const imageColIndex = HEADER.indexOf('Image');
    if (imageColIndex === -1) return;
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      if (!p.image) continue;
      const cellAddr = XLSX.utils.encode_cell({ r: i + 1, c: imageColIndex });
      const fileName = `${p.id}.jpg`;
      (ws as any)[cellAddr] = { t: 's', v: fileName, l: { Target: `images/${fileName}`, Tooltip: fileName } };
    }
  };

  const exportXlsx = async () => {
    const rows = buildRows();
    const ws = createWorksheet(rows);
    applyImageHyperlinks(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const xlsxArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([xlsxArrayBuffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `dataset-${Date.now()}.xlsx`);
  };

  // Export both XLSX and images into a single zip (Datasets)
  const exportDatasets = async () => {
    const rows = buildRows();
    const ws = createWorksheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    applyImageHyperlinks(ws);
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
    const findIndex = (...names: string[]) => {
      for (const name of names) {
        const index = header.indexOf(name);
        if (index !== -1) return index;
      }
      return -1;
    };
    let count = 0;
    for (let i=1;i<arr.length;i++){
      const row = arr[i] as any[];
      if (!row?.length) continue;
      const id = String(row[findIndex('id')] || `${Date.now()}`);
      const question = String(row[findIndex('Question')] || '');
      const questionType = String(row[findIndex('Question_Type', 'Question_type')] || 'Multiple Choice') as any;
      let options: string[] = [];
      const optionsIdx = findIndex('Options');
      const optionsRaw = optionsIdx !== -1 ? row[optionsIdx] : undefined;
      if (optionsRaw) {
        try { options = JSON.parse(optionsRaw); } catch {}
      }
      if (questionType === 'Multiple Choice') {
        // Strip leading label prefixes like "A:", "B:" if present
        options = (Array.isArray(options) ? options : []).map((opt, i) => {
          const label = String.fromCharCode(65 + i);
          const s = String(opt || '');
          return s.replace(new RegExp(`^${label}\\s*:\\s*`), '');
        });
      } else {
        options = [];
      }
      const answer = String(row[findIndex('Answer')] || '');
      const subfield = String(row[findIndex('Subfield')] || '');
      const source = String(row[findIndex('Source')] || '');
      const imageRaw = String(row[findIndex('Image')] || '').trim();
      let image = '';
      if (imageRaw) {
        if (imageRaw.includes('/') || imageRaw.includes('\\')) {
          image = imageRaw;
        } else {
          image = `images/${imageRaw}`;
        }
      }
      const imageDependency = image ? 1 : 0;
      const academicLevel = String(row[findIndex('Academic_Level')] || 'K12') as any;
      const difficulty = String(row[findIndex('Difficulty')] || '1') as any;
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

  const handleXlsxFiles = async (files: File[]) => {
    if (!files.length) return 0;
    let total = 0;
    for (const f of files) {
      total += await importXlsx(f);
    }
    if (total > 0) {
      setImportedCount(total);
      setLastXlsxGeneratedName(formatTimestampName({ prefix: 'xlsx', extension: 'xlsx' }));
    }
    return total;
  };

  const handleImageFiles = async (files: File[]) => {
    if (!files.length) return 0;
    const c = await importImagesFromFiles(files);
    if (c > 0) {
      setImportedImagesCount(c);
      setLastImagesGeneratedName(formatTimestampName({ prefix: 'images' }));
    }
    return c;
  };

  const extractFilesFromItems = (items: DataTransferItemList | undefined | null): File[] => {
    if (!items || !items.length) return [];
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile();
      if (file) files.push(file);
    }
    return files;
  };

  const collectDirectoryFiles = async (items: DataTransferItemList | undefined | null): Promise<{ files: File[]; hasDirectory: boolean }> => {
    if (!items || !items.length) return { files: [], hasDirectory: false };
    const tasks: Promise<File[]>[] = [];
    let hasDirectory = false;
    for (let i = 0; i < items.length; i++) {
      const entry = (items[i] as any).webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        hasDirectory = true;
        tasks.push(traverseDirectory(entry));
      }
    }
    if (!hasDirectory) return { files: [], hasDirectory: false };
    const nested = await Promise.all(tasks);
    return { files: nested.flat(), hasDirectory: true };
  };

  const traverseDirectory = async (entry: any): Promise<File[]> => {
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
              const files = await traverseDirectory(e);
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
    const droppedItems = extractFilesFromItems(e.dataTransfer.items);
    const files = (droppedItems.length ? droppedItems : Array.from(e.dataTransfer.files || [])).filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    await handleXlsxFiles(files);
  };

  const onDropImages = async (e: React.DragEvent) => {
    e.preventDefault();
    const { files: dropped, hasDirectory } = await collectDirectoryFiles(e.dataTransfer.items);
    if (!hasDirectory) return;
    const files = dropped.filter(f => /\.(jpg|jpeg)$/i.test(f.name));
    await handleImageFiles(files);
  };

  const onPasteXlsx = async (e: ReactClipboardEvent<Element>) => {
    const files = Array.from(e.clipboardData?.files || []).filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    if (!files.length) return;
    e.preventDefault();
    await handleXlsxFiles(files);
  };

  const onPasteImages = async (e: ReactClipboardEvent<Element>) => {
    const files = Array.from(e.clipboardData?.files || []).filter(f => /\.(jpg|jpeg)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    await handleImageFiles(files);
  };

  return (
    <div className="grid" style={{gap:12, gridTemplateColumns:'1fr'}}>
      <div className="row" style={{gap:8, flexWrap:'wrap'}}>
        <button onClick={exportXlsx}>{t('exportXlsx')}</button>
        <button onClick={exportImages}>{t('exportImages')}</button>
        <button onClick={exportDatasets}>{t('exportDatasets')}</button>
      </div>

      <div
        className="dropzone"
        tabIndex={0}
        onDragOver={(e)=> e.preventDefault()}
        onDrop={onDropXlsx}
        onPaste={onPasteXlsx}
        onContextMenu={() => focusHiddenPasteTarget(xlsxPasteTargetRef)}
        style={{padding:'8px 12px'}}
      >
        <div className="row" style={{justifyContent:'center', gap:8, alignItems:'center'}}>
          <textarea
            ref={xlsxPasteTargetRef}
            aria-hidden="true"
            onPaste={onPasteXlsx}
            style={{position:'absolute', left:'-9999px', top:0, width:1, height:1, opacity:0, border:0, padding:0}}
            tabIndex={-1}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            style={{display:'none'}}
            onChange={async (e)=>{
              const f = e.target.files?.[0];
              if (f) {
                await handleXlsxFiles([f]);
                e.target.value = '';
              }
            }}
          />
          <button onClick={()=> fileInputRef.current?.click()}>{t('importXlsx')}</button>
          <span className="small">{t('importXlsxHint')}</span>
          {lastXlsxGeneratedName && (
            <span className="small" style={{ marginLeft: 8 }}>
              {t('generatedFileName', { name: lastXlsxGeneratedName })}
            </span>
          )}
          {importedCount !== null && (
            <span className="small" style={{ marginLeft: 8 }}>
              {t('importSuccess', { count: importedCount })}
            </span>
          )}
        </div>
      </div>

      <div
        className="dropzone"
        tabIndex={0}
        onDragOver={(e)=> e.preventDefault()}
        onDrop={onDropImages}
        onPaste={onPasteImages}
        onContextMenu={() => focusHiddenPasteTarget(imagesPasteTargetRef)}
        style={{padding:'8px 12px'}}
      >
        <div className="row" style={{justifyContent:'center', gap:8, alignItems:'center'}}>
          <textarea
            ref={imagesPasteTargetRef}
            aria-hidden="true"
            onPaste={onPasteImages}
            style={{position:'absolute', left:'-9999px', top:0, width:1, height:1, opacity:0, border:0, padding:0}}
            tabIndex={-1}
          />
          <input
            type="file"
            style={{display:'none'}}
            ref={(el)=> {
              if (el) {
                el.setAttribute('webkitdirectory','');
                el.setAttribute('directory','');
              }
              imagesFolderInputRef.current = el;
            }}
            accept="image/jpeg,image/jpg"
            onChange={async (e)=>{
              const files = Array.from(e.target.files || []).filter(f => /\.(jpg|jpeg)$/i.test(f.name));
              if (files.length === 0) return;
              await handleImageFiles(files);
              e.target.value = '';
            }}
          />
          <button onClick={()=> imagesFolderInputRef.current?.click()}>{t('importImages')}</button>
          <span className="small">{t('importImagesHint')}</span>
          {lastImagesGeneratedName && (
            <span className="small" style={{ marginLeft: 8 }}>
              {t('generatedFileName', { name: lastImagesGeneratedName })}
            </span>
          )}
          {importedImagesCount !== null && (
            <span className="small" style={{ marginLeft: 8 }}>
              {t('importImagesSuccess', { count: importedImagesCount })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
