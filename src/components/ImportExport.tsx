import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import * as XLSX from 'xlsx';
import { downloadBlob } from '../lib/storage';
import { getImageBlob, saveImageBlobAtPath } from '../lib/db';
import JSZip from 'jszip';
import {
  buildBatchLabel,
  collectFilesFromItems,
  extractFilesFromClipboardData,
  readClipboardFiles,
  inferExtension,
  formatTimestamp,
  resolveImageFileName
} from '../lib/fileHelpers';

const HEADER = [
  'id','Question','Question_Type','Options','Answer','Subfield','Source','Image','Image_Dependency','Academic_Level','Difficulty'
];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ACCEPTED_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'];

type ImportedRowPreview = {
  id: string;
  question: string;
  questionType: string;
  answer: string;
};

export function ImportExport() {
  const { t } = useTranslation();
  const { problems, upsertProblem, patchProblem } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageDirInputRef = useRef<HTMLInputElement>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importedImagesCount, setImportedImagesCount] = useState<number | null>(null);
  const [xlsxDisplayName, setXlsxDisplayName] = useState('');
  const [imagesDisplayName, setImagesDisplayName] = useState('');
  const [xlsxFirstRowPreview, setXlsxFirstRowPreview] = useState<ImportedRowPreview | null>(null);
  const [xlsxContextMenu, setXlsxContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [imagesContextMenu, setImagesContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [activePasteTarget, setActivePasteTarget] = useState<'xlsx' | 'images' | null>(null);

  useEffect(() => {
    const closeMenus = () => {
      setXlsxContextMenu(null);
      setImagesContextMenu(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenus();
      }
    };
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', closeMenus);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    const el = imageDirInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

  const buildRows = () => problems
    .filter((p) => (p.question ?? '').trim().length > 0)
    .map(p => {
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
      const imageName = resolveImageFileName(p.image);
      const imageDependency = imageName ? 1 : 0;
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
      const fileName = resolveImageFileName(p.image, `${p.id}.jpg`);
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
        if (blob) {
          const fileName = resolveImageFileName(p.image, `${p.id}.jpg`);
          zip.file(`images/${fileName}`, blob);
        }
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
          const fileName = resolveImageFileName(p.image, `${p.id}.jpg`);
          zip.file(fileName, blob);
        }
      } catch {
        // ignore missing blobs
      }
    }
    const out = await zip.generateAsync({ type: 'blob' });
    downloadBlob(out, `images-${Date.now()}.zip`);
  };

  type ImportXlsxResult = { count: number; firstRow?: ImportedRowPreview };

  const importXlsx = async (file: File): Promise<ImportXlsxResult> => {
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
    let firstRow: ImportedRowPreview | undefined;
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
      if (!firstRow) {
        firstRow = { id, question, questionType, answer };
      }
    }
    return { count, firstRow };
  };

  // Import images from dropped files/folders; filenames must be <id>.<ext>
  const importImagesFromFiles = async (files: File[]): Promise<number> => {
    let count = 0;
    const setById = new Set(problems.map(p => p.id));
    for (const f of files) {
      const baseName = (f.name || '').trim();
      if (!baseName) continue;
      const extRaw = inferExtension(f, '').toLowerCase();
      if (!extRaw) continue;
      const normalizedExt = extRaw === 'jpeg' ? 'jpg' : extRaw;
      if (!ACCEPTED_IMAGE_EXT.includes(normalizedExt)) continue;
      const dotIndex = baseName.lastIndexOf('.');
      const id = dotIndex === -1 ? baseName : baseName.slice(0, dotIndex);
      if (!id || !setById.has(id)) continue; // only update existing problems
      const path = `images/${id}.${normalizedExt}`;
      await saveImageBlobAtPath(path, f);
      patchProblem(id, { image: path });
      count++;
    }
    return count;
  };

  const isXlsxFile = (file: File) => {
    if (!file) return false;
    if (file.name?.toLowerCase().endsWith('.xlsx')) return true;
    return file.type === XLSX_MIME;
  };

  const isImageFile = (file: File) => {
    if (!file) return false;
    const ext = inferExtension(file, '').toLowerCase();
    const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
    return ACCEPTED_IMAGE_EXT.includes(normalizedExt);
  };

  const handleClipboardError = (error: unknown) => {
    if (error instanceof Error) {
      if (error.message === 'clipboard_permission_denied') {
        alert(t('clipboardReadDenied'));
        return;
      }
      if (error.message === 'clipboard_not_supported') {
        alert(t('clipboardReadUnsupported'));
        return;
      }
      alert(error.message);
      return;
    }
    alert(String(error));
  };

  const handleXlsxFiles = async (files: File[]) => {
    const eligible = files.filter(isXlsxFile);
    if (!eligible.length) {
      setXlsxDisplayName('');
      setXlsxFirstRowPreview(null);
      return;
    }
    const base = formatTimestamp();
    const label = buildBatchLabel('xlsx', eligible.length, base);
    let total = 0;
    let preview: ImportedRowPreview | null = null;
    for (const f of eligible) {
      const { count, firstRow } = await importXlsx(f);
      total += count;
      if (!preview && firstRow) {
        preview = firstRow;
      }
    }
    if (total > 0) {
      setImportedCount(total);
    } else {
      setImportedCount(null);
    }
    setXlsxDisplayName(label);
    setXlsxFirstRowPreview(preview);
    if (preview?.id) {
      upsertProblem({ id: preview.id });
    }
  };

  const handleImagesFiles = async (files: File[]) => {
    const eligible = files.filter(isImageFile);
    if (!eligible.length) {
      setImagesDisplayName('');
      return;
    }
    const base = formatTimestamp();
    const label = buildBatchLabel('imgset', eligible.length, base);
    const imported = await importImagesFromFiles(eligible);
    if (imported > 0) {
      setImportedImagesCount(imported);
    } else {
      setImportedImagesCount(null);
    }
    setImagesDisplayName(label);
  };

  const ellipsize = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}...` : value);

  const hasDirectoryEntry = (items: DataTransferItemList | null): boolean => {
    if (!items) return false;
    for (let i = 0; i < items.length; i++) {
      const entry = (items[i] as any).webkitGetAsEntry?.();
      if (entry?.isDirectory) return true;
    }
    return false;
  };

  const onPasteXlsx = async (e: ReactClipboardEvent<HTMLDivElement>) => {
    const files = extractFilesFromClipboardData(e.clipboardData, isXlsxFile);
    if (!files.length) return;
    e.preventDefault();
    await handleXlsxFiles(files);
  };

  const onPasteImages = async (e: ReactClipboardEvent<HTMLDivElement>) => {
    const files = extractFilesFromClipboardData(e.clipboardData, isImageFile);
    if (!files.length) return;
    e.preventDefault();
    await handleImagesFiles(files);
  };

  const onDropXlsx = async (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setXlsxContextMenu(null);
    const items = e.dataTransfer?.items ?? null;
    if (hasDirectoryEntry(items)) {
      return;
    }
    let files = Array.from(e.dataTransfer.files || []).filter(isXlsxFile);
    if (!files.length && items) {
      files = await collectFilesFromItems(items, isXlsxFile);
    }
    if (!files.length) return;
    await handleXlsxFiles(files);
  };

  const onDropImages = async (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setImagesContextMenu(null);
    const items = e.dataTransfer?.items ?? null;
    if (!items) return;
    const files = await collectFilesFromItems(items, isImageFile, { requireDirectory: true });
    if (!files.length) return;
    await handleImagesFiles(files);
  };

  useEffect(() => {
    if (!activePasteTarget) return;
    const handlePasteEvent = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      if (activePasteTarget === 'xlsx') {
        const files = extractFilesFromClipboardData(data, isXlsxFile);
        if (!files.length) return;
        event.preventDefault();
        void handleXlsxFiles(files).catch(() => {});
      } else {
        const files = extractFilesFromClipboardData(data, isImageFile);
        if (!files.length) return;
        event.preventDefault();
        void handleImagesFiles(files).catch(() => {});
      }
    };
    window.addEventListener('paste', handlePasteEvent);
    return () => window.removeEventListener('paste', handlePasteEvent);
  }, [activePasteTarget, handleImagesFiles, handleXlsxFiles, isImageFile, isXlsxFile]);

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
        role="button"
        onDragOver={(e)=> { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={onDropXlsx}
        onPaste={onPasteXlsx}
        onContextMenu={(e)=> { e.preventDefault(); e.stopPropagation(); setActivePasteTarget('xlsx'); setXlsxContextMenu({ x: e.clientX, y: e.clientY }); }}
        onMouseEnter={() => setActivePasteTarget('xlsx')}
        onMouseLeave={() => setActivePasteTarget((prev) => (prev === 'xlsx' ? null : prev))}
        onFocus={() => setActivePasteTarget('xlsx')}
        onFocusCapture={() => setActivePasteTarget('xlsx')}
        onBlur={() => setActivePasteTarget((prev) => (prev === 'xlsx' ? null : prev))}
        onBlurCapture={() => setActivePasteTarget((prev) => (prev === 'xlsx' ? null : prev))}
        style={{padding:'8px 12px'}}
      >
        <div className="row" style={{justifyContent:'center', gap:8, alignItems:'center', flexWrap:'wrap'}}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            style={{display:'none'}}
            onChange={async (e)=>{
              const files = Array.from(e.target.files || []);
              if (files.length) {
                await handleXlsxFiles(files);
                e.target.value = '';
              }
            }}
          />
          <button onClick={()=> fileInputRef.current?.click()}>{t('importXlsx')}</button>
        </div>
        <div className="row" style={{justifyContent:'center', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:8}}>
          <span className="small">{t('importXlsxHint')}</span>
          {xlsxDisplayName && (
            <span className="small">{t('generatedNameLabel')}: {xlsxDisplayName}</span>
          )}
          {importedCount !== null && (
            <span className="small">{t('importSuccess', { count: importedCount })}</span>
          )}
          {xlsxFirstRowPreview && (
            <span className="small">
              {t('importFirstRowPreviewLabel')}:{" "}
              {xlsxFirstRowPreview.question
                ? `"${ellipsize(xlsxFirstRowPreview.question, 80)}"`
                : t('importFirstRowPreviewEmpty')}
              {xlsxFirstRowPreview.answer
                ? ` | ${t('answer')}: ${ellipsize(xlsxFirstRowPreview.answer, 60)}`
                : ''}
            </span>
          )}
        </div>
      </div>

      <div
        className="dropzone"
        tabIndex={0}
        role="button"
        onDragOver={(e)=> { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={onDropImages}
        onPaste={onPasteImages}
        onContextMenu={(e)=> { e.preventDefault(); e.stopPropagation(); setActivePasteTarget('images'); setImagesContextMenu({ x: e.clientX, y: e.clientY }); }}
        onMouseEnter={() => setActivePasteTarget('images')}
        onMouseLeave={() => setActivePasteTarget((prev) => (prev === 'images' ? null : prev))}
        onFocus={() => setActivePasteTarget('images')}
        onFocusCapture={() => setActivePasteTarget('images')}
        onBlur={() => setActivePasteTarget((prev) => (prev === 'images' ? null : prev))}
        onBlurCapture={() => setActivePasteTarget((prev) => (prev === 'images' ? null : prev))}
        style={{padding:'8px 12px'}}
      >
        <div className="row" style={{justifyContent:'center', gap:8, alignItems:'center', flexWrap:'wrap'}}>
          <input
            type="file"
            style={{display:'none'}}
            multiple
            ref={imageDirInputRef}
            accept="image/*"
            onChange={async (e)=>{
              const files = Array.from(e.target.files || []);
              if (files.length) {
                await handleImagesFiles(files);
                e.target.value = '';
              }
            }}
          />
          <button onClick={()=> imageDirInputRef.current?.click()}>{t('importImages')}</button>
        </div>
        <div className="row" style={{justifyContent:'center', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:8}}>
          <span className="small">{t('importImagesHint')}</span>
          {imagesDisplayName && (
            <span className="small">{t('generatedNameLabel')}: {imagesDisplayName}</span>
          )}
          {importedImagesCount !== null && (
            <span className="small">{t('importImagesSuccess', { count: importedImagesCount })}</span>
          )}
        </div>
      </div>

      {xlsxContextMenu && (
        <div
          style={{
            position: 'fixed',
            top: xlsxContextMenu.y,
            left: xlsxContextMenu.x,
            zIndex: 9999,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.18)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
          onClick={(event)=> event.stopPropagation()}
        >
          <button
            onClick={async (event) => {
              event.stopPropagation();
              try {
                const files = await readClipboardFiles((mime) => mime === XLSX_MIME);
                if (!files.length) {
                  alert(t('noFilesFromClipboard'));
                } else {
                  await handleXlsxFiles(files);
                }
              } catch (error) {
                handleClipboardError(error);
              } finally {
                setXlsxContextMenu(null);
              }
            }}
          >
            {t('pasteFromClipboard')}
          </button>
        </div>
      )}

      {imagesContextMenu && (
        <div
          style={{
            position: 'fixed',
            top: imagesContextMenu.y,
            left: imagesContextMenu.x,
            zIndex: 9999,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.18)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
          onClick={(event)=> event.stopPropagation()}
        >
          <button
            onClick={async (event) => {
              event.stopPropagation();
              try {
                const files = await readClipboardFiles((mime) => mime.startsWith('image/'));
                if (!files.length) {
                  alert(t('noFilesFromClipboard'));
                } else {
                  await handleImagesFiles(files);
                }
              } catch (error) {
                handleClipboardError(error);
              } finally {
                setImagesContextMenu(null);
              }
            }}
          >
            {t('pasteFromClipboard')}
          </button>
        </div>
      )}
    </div>
  );
}
