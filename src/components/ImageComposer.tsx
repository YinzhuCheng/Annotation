import { useEffect, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import { saveImageBlobAtPath } from '../lib/db';
import { openViewerWindow } from '../lib/viewer';
import { buildDisplayName, collectFilesFromItems, extractFilesFromClipboardData, formatTimestamp, inferExtension, readClipboardFiles } from '../lib/fileHelpers';

type BlockFile = { blob: File | Blob; displayName: string };

type Block =
  | { id: string; type: 'single'; files: BlockFile[] }
  | { id: string; type: 'options'; files: BlockFile[] } // up to 5 in A..E order
  | { id: string; type: 'custom'; files: BlockFile[]; count: number; labelScheme: 'letters' | 'numbers' };

const ACCEPTED_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'];

function readImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function ImageComposer({ showHeader = true }: { showHeader?: boolean } = {}) {
  const { t } = useTranslation();
  const problem = useAppStore((s) => s.problems.find(p => p.id === s.currentId)!);
  const update = useAppStore((s) => s.upsertProblem);

  const [blocks, setBlocks] = useState<Block[]>(() => {
    const raw = localStorage.getItem(`image-blocks-${problem.id}`);
    if (raw) {
      try {
        const arr = JSON.parse(raw) as Array<{ id: string; type: 'single' | 'options' | 'custom'; count?: number; labelScheme?: 'letters' | 'numbers' }>;
        return arr.map((b) => {
          if ((b as any).type === 'custom') {
            return { id: b.id, type: 'custom', files: [], count: b.count ?? 3, labelScheme: b.labelScheme ?? 'letters' } as Block;
          }
          return { id: b.id, type: (b as any).type, files: [] } as Block;
        });
      } catch {}
    }
    return [];
  });
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [composedBlob, setComposedBlob] = useState<Blob | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ blockId: string; target: 'single' | 'options' | 'custom'; x: number; y: number } | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

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

  const isImageFile = (file: File) => {
    const ext = inferExtension(file, '').toLowerCase();
    const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
    if (ACCEPTED_IMAGE_EXT.includes(normalizedExt)) return true;
    return file.type.startsWith('image/');
  };

  const normalizeImageFiles = (files: File[]): File[] => {
    return files
      .filter(isImageFile)
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const makeBlockFiles = (files: File[], base?: string): BlockFile[] => {
    const timestamp = base ?? formatTimestamp();
    const total = files.length;
    return files.map((file, index) => {
      const ext = inferExtension(file, 'png').toLowerCase();
      const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
      return {
        blob: file,
        displayName: buildDisplayName(normalizedExt, { base: timestamp, index, total })
      };
    });
  };

  const applyFilesToBlock = (blockId: string, files: File[]) => {
    const normalized = normalizeImageFiles(files);
    if (!normalized.length) return;
    const base = formatTimestamp();
    const built = makeBlockFiles(normalized, base);
    setBlocks((prev) => prev.map((b) => {
      if (b.id !== blockId) return b;
      if (b.type === 'single') {
        return { ...b, files: [built[0]] } as Block;
      }
      if (b.type === 'options') {
        const next = [...b.files];
        let pointer = 0;
        for (let i = 0; i < 5 && pointer < built.length; i++) {
          if (!next[i]) {
            next[i] = built[pointer++];
          }
        }
        for (let i = 0; i < 5 && pointer < built.length; i++) {
          next[i] = built[pointer++];
        }
        return { ...b, files: next.slice(0, 5) } as Block;
      }
      const limit = (b as any).count as number;
      const next = [...b.files];
      let pointer = 0;
      for (let i = 0; i < limit && pointer < built.length; i++) {
        if (!next[i]) {
          next[i] = built[pointer++];
        }
      }
      for (let i = 0; i < limit && pointer < built.length; i++) {
        next[i] = built[pointer++];
      }
      return { ...(b as any), files: next.slice(0, limit) } as Block;
    }));
  };

  const handleDropOnBlock = async (e: ReactDragEvent<HTMLDivElement>, blockId: string) => {
    e.preventDefault();
    setContextMenu(null);
    const items = e.dataTransfer?.items ?? null;
    let files: File[] = [];
    if (items && items.length) {
      files = await collectFilesFromItems(items, (file) => isImageFile(file));
    }
    if (!files.length) {
      files = Array.from(e.dataTransfer.files || []).filter(isImageFile);
    }
    if (!files.length) return;
    applyFilesToBlock(blockId, files);
  };

  const handlePasteOnBlock = async (e: ReactClipboardEvent<Element>, blockId: string) => {
    const files = extractFilesFromClipboardData(e.clipboardData, (file) => isImageFile(file));
    if (!files.length) return;
    e.preventDefault();
    applyFilesToBlock(blockId, files);
  };

  const handleContextPaste = async (blockId: string) => {
    try {
      const files = await readClipboardFiles((mime) => mime.startsWith('image/'));
      const normalized = normalizeImageFiles(files);
      if (!normalized.length) {
        alert(t('noFilesFromClipboard'));
      } else {
        applyFilesToBlock(blockId, normalized);
      }
    } catch (error) {
      handleClipboardError(error);
    } finally {
      setContextMenu(null);
    }
  };

  useEffect(() => {
    if (!activeBlockId) return;
    const handlePasteEvent = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      const files = extractFilesFromClipboardData(data, isImageFile);
      if (!files.length) return;
      const normalized = normalizeImageFiles(files);
      if (!normalized.length) return;
      event.preventDefault();
      applyFilesToBlock(activeBlockId, normalized);
    };
    window.addEventListener('paste', handlePasteEvent);
    return () => window.removeEventListener('paste', handlePasteEvent);
  }, [activeBlockId, applyFilesToBlock, isImageFile, normalizeImageFiles]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const lite = blocks.map((b) => (b.type === 'custom' ? { id: b.id, type: b.type, count: b.count, labelScheme: b.labelScheme } : { id: b.id, type: b.type }));
    localStorage.setItem(`image-blocks-${problem.id}`, JSON.stringify(lite));
  }, [blocks, problem.id]);

  const addBlock = (type: 'single' | 'options' | 'custom') => {
    if (type === 'custom') {
      setBlocks((b) => [...b, { id: `${Date.now()}-${Math.random()}`, type: 'custom', files: [], count: 3, labelScheme: 'letters' } as Block]);
    } else {
      setBlocks((b) => [...b, { id: `${Date.now()}-${Math.random()}`, type, files: [] } as Block]);
    }
  };

  const setFile = (blockId: string, idx: number, file: BlockFile) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b;
      const nextFiles = [...b.files];
      nextFiles[idx] = file;
      return { ...b, files: nextFiles } as Block;
    }));
  };

  const removeBlock = (blockId: string) => {
    setBlocks(prev => prev.filter(b => b.id !== blockId));
  };

  const onDropToOptions = (e: ReactDragEvent<HTMLDivElement>, blockId: string) => {
    handleDropOnBlock(e, blockId);
  };

  const onDropToSingle = (e: ReactDragEvent<HTMLDivElement>, blockId: string) => {
    handleDropOnBlock(e, blockId);
  };

  const onDropToCustom = (e: ReactDragEvent<HTMLDivElement>, blockId: string) => {
    handleDropOnBlock(e, blockId);
  };

  const compose = async () => {
    setIsComposing(true);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
    setComposedBlob(null);
    try {
      const targetWidth = 1000;
      const padding = 24;
      const gap = 16;
      const optionGap = 12;
      // Increased font sizes for better readability
      const rowLabelFontSize = 28; // for "<Image N>" label
      const colLabelFontSize = 22; // for per-option (A..E) labels
      const rowLabelLineHeight = 34;
      const colLabelLineHeight = 28;
      const minAreaRatioVsSingle = 0.6; // ensure options are not too small
      const drawWidthFull = targetWidth - padding * 2;
      const rowLabelColor = '#2563eb';
      const defaultTextColor = '#000000';

      const makeLabel = (block: Block, optionIndex: number): { text: string; wrapParen: boolean } => {
        if (block.type === 'options') {
          return { text: String.fromCharCode(65 + optionIndex), wrapParen: true };
        }
        if (block.type === 'custom') {
          if (block.labelScheme === 'numbers') {
            return { text: String(optionIndex + 1), wrapParen: true };
          }
          return { text: String.fromCharCode(97 + optionIndex), wrapParen: false };
        }
        return { text: String(optionIndex + 1), wrapParen: true };
      };

      // Determine groups for options/custom block layout.
      // Preserve legacy for <=4; for >=5, use [1, 2, 2, ...] and a trailing 1 if needed.
      const computeOptionGroups = (count: number): number[] => {
        if (count <= 0) return [];
        if (count === 1) return [1];
        if (count === 2) return [2];
        if (count === 3) return [1, 2];
        if (count === 4) return [1, 2, 1];
        const groups: number[] = [1];
        let remaining = count - 1;
        while (remaining > 0) {
          if (remaining >= 2) { groups.push(2); remaining -= 2; }
          else { groups.push(1); remaining -= 1; }
        }
        return groups;
      };
      const enforceMinArea = (groups: number[]): number[] => {
        const finalGroups: number[] = [];
        for (const g of groups) {
          if (g <= 1) { finalGroups.push(1); continue; }
          const colWidth = (drawWidthFull - optionGap * (g - 1)) / g;
          const areaRatio = (colWidth / drawWidthFull) ** 2;
          if (areaRatio >= minAreaRatioVsSingle) {
            finalGroups.push(g);
          } else {
            // Fall back to stacking singles to guarantee size
            for (let i = 0; i < g; i++) finalGroups.push(1);
          }
        }
        return finalGroups;
      };
      let totalHeight = padding; // start padding

      // First pass: measure heights
      for (const b of blocks) {
        if (b.type === 'single') {
          const fileEntry = b.files[0];
          const blob = fileEntry?.blob;
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          const img = await readImage(url);
          const scale = (targetWidth - padding * 2) / img.width;
          // include row label height
          totalHeight += img.height * scale + rowLabelLineHeight + gap;
          URL.revokeObjectURL(url);
        } else if (b.type === 'options' || b.type === 'custom') {
          const present = b.files.filter((entry) => !!entry?.blob);
          if (!present.length) continue;
          // Determine grouped layout
          const baseGroups = computeOptionGroups(present.length);
          const groups = enforceMinArea(baseGroups);

          let optIdx = 0;
          for (const g of groups) {
            let rowHeight = 0;
            if (g <= 1) {
              // single option full width
              const source = present[optIdx]?.blob;
              if (!source) {
                optIdx += 1;
                continue;
              }
              const u = URL.createObjectURL(source);
              const img = await readImage(u);
              const scale = drawWidthFull / img.width;
              rowHeight = Math.max(rowHeight, img.height * scale + rowLabelLineHeight + colLabelLineHeight);
              URL.revokeObjectURL(u);
              optIdx += 1;
            } else {
              // multiple options in one row
              const colWidth = (drawWidthFull - optionGap * (g - 1)) / g;
              for (let i = 0; i < g; i++) {
                const source = present[optIdx + i]?.blob;
                if (!source) continue;
                const u = URL.createObjectURL(source);
                const img = await readImage(u);
                const scale = colWidth / img.width;
                rowHeight = Math.max(rowHeight, img.height * scale + rowLabelLineHeight + colLabelLineHeight);
                URL.revokeObjectURL(u);
              }
              optIdx += g;
            }
            totalHeight += rowHeight + gap;
          }
        }
      }
      totalHeight += padding; // bottom padding

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = Math.max(1, Math.round(totalHeight));
      const ctx = canvas.getContext('2d')!;

      // white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,canvas.width, canvas.height);

      // draw
      ctx.fillStyle = defaultTextColor;
      ctx.font = `${rowLabelFontSize}px sans-serif`;
      let y = padding;
      const separatorColor = '#3b82f6'; // blue separators
      const separatorWidth = 2;
      let rowIndex = 1; // for <Image N>

      for (let bi=0;bi<blocks.length;bi++){
        const b = blocks[bi];
        if (b.type === 'single') {
          const fileEntry = b.files[0];
          const blob = fileEntry?.blob;
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          const img = await readImage(url);
          const drawWidth = targetWidth - padding * 2;
          const scale = drawWidth / img.width;
          const h = img.height * scale;
          // Row label: <Image N>
          ctx.fillStyle = rowLabelColor;
          ctx.font = `${rowLabelFontSize}px sans-serif`;
          ctx.fillText(`<Image ${rowIndex}>`, padding, y + Math.round(rowLabelFontSize * 0.8));
          ctx.fillStyle = defaultTextColor;
          // Draw image below the row label line
          ctx.drawImage(img, padding, y + rowLabelLineHeight, drawWidth, h);
          y += h + rowLabelLineHeight + gap;
          rowIndex += 1;
          URL.revokeObjectURL(url);
        } else if (b.type === 'options' || b.type === 'custom') {
          const present = b.files.filter((entry) => !!entry?.blob);
          if (!present.length) continue;
          const baseGroups = computeOptionGroups(present.length);
          const groups = enforceMinArea(baseGroups);

          let optIdx = 0;
          let drawnRowLabelForThisBlock = false; // only draw "Image N" for first row
          for (const g of groups) {
            const drawWidth = targetWidth - padding * 2;
            let rowH = 0;
            // Draw row label only once for the first row in this options block
            if (!drawnRowLabelForThisBlock) {
              ctx.fillStyle = rowLabelColor;
              ctx.font = `${rowLabelFontSize}px sans-serif`;
              ctx.fillText(`<Image ${rowIndex}>`, padding, y + Math.round(rowLabelFontSize * 0.8));
              drawnRowLabelForThisBlock = true;
              ctx.fillStyle = defaultTextColor;
            }

            if (g <= 1) {
              const source = present[optIdx]?.blob;
              if (!source) {
                optIdx += 1;
                continue;
              }
              const url = URL.createObjectURL(source);
              const img = await readImage(url);
              const scale = drawWidth / img.width;
              const h = img.height * scale;
              const x = padding;
              // label under the row label
              const { text: label, wrapParen } = makeLabel(b, optIdx);
              ctx.fillStyle = defaultTextColor;
              ctx.font = `${colLabelFontSize}px sans-serif`;
              ctx.fillText(wrapParen ? `(${label})` : `${label}`, x, y + rowLabelLineHeight + Math.round(colLabelFontSize * 0.8));
              ctx.drawImage(img, x, y + rowLabelLineHeight + colLabelLineHeight, drawWidth, h);
              rowH = Math.max(rowH, h + rowLabelLineHeight + colLabelLineHeight);
              URL.revokeObjectURL(url);
              optIdx += 1;
            } else {
              const colWidth = (drawWidth - optionGap * (g - 1)) / g;
              for (let i = 0; i < g; i++) {
                const source = present[optIdx + i]?.blob;
                if (!source) continue;
                const url = URL.createObjectURL(source);
                const img = await readImage(url);
                const scale = colWidth / img.width;
                const h = img.height * scale;
                const x = padding + i * (colWidth + optionGap);
                const { text: label, wrapParen } = makeLabel(b, optIdx + i);
                ctx.fillStyle = defaultTextColor;
                ctx.font = `${colLabelFontSize}px sans-serif`;
                ctx.fillText(wrapParen ? `(${label})` : `${label}`, x, y + rowLabelLineHeight + Math.round(colLabelFontSize * 0.8));
                ctx.drawImage(img, x, y + rowLabelLineHeight + colLabelLineHeight, colWidth, h);
                rowH = Math.max(rowH, h + rowLabelLineHeight + colLabelLineHeight);
                URL.revokeObjectURL(url);
              }
              optIdx += g;
            }

            y += rowH + gap;
            rowIndex += 1;

            // separator line except after last group within block is handled below via bi check
          }
        }
        // separator line except after last
        if (bi < blocks.length - 1) {
          ctx.strokeStyle = separatorColor;
          ctx.lineWidth = separatorWidth;
          ctx.beginPath();
          ctx.moveTo(padding, y - gap/2);
          ctx.lineTo(targetWidth - padding, y - gap/2);
          ctx.stroke();
          ctx.lineWidth = 1; // reset
        }
      }

      const blob = await new Promise<Blob>((resolve) => canvas.toBlob(b => resolve(b || new Blob()), 'image/jpeg', 0.92));
      setComposedBlob(blob);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } finally {
      setIsComposing(false);
    }
  };

  return (
    <div>
      {showHeader && (
        <div className="label">{t('imageBlock')}</div>
      )}
      <div className="row" style={{gap:8}}>
        <button onClick={() => addBlock('single')}>{t('singleBlock')}</button>
        <button onClick={() => addBlock('options')}>{t('optionBlock')}</button>
        <button onClick={() => addBlock('custom')}>{t('customBlock')}</button>
        <button className="primary" onClick={compose} disabled={!blocks.length || isComposing}>{t('compose')}</button>
      </div>

      <div className="grid" style={{gap:12, gridTemplateColumns:'1fr'}}>
        {blocks.map((b, idx) => (
          <div key={b.id} className="card">
            <div className="row" style={{justifyContent:'space-between', marginBottom:8}}>
              <strong>{b.type === 'single' ? t('singleBlock') : b.type === 'options' ? t('optionBlock') : t('customBlock')}</strong>
              <button onClick={() => removeBlock(b.id)}>?</button>
            </div>
            {b.type === 'single' ? (
              <div
                className="dropzone"
                tabIndex={0}
                role="button"
                onDragOver={(e)=> { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e)=> onDropToSingle(e, b.id)}
                onPaste={(e)=> handlePasteOnBlock(e, b.id)}
                onContextMenu={(e)=> { e.preventDefault(); e.stopPropagation(); setActiveBlockId(b.id); setContextMenu({ blockId: b.id, target: 'single', x: e.clientX, y: e.clientY }); }}
                onMouseEnter={() => setActiveBlockId(b.id)}
                onMouseLeave={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
                onFocus={() => setActiveBlockId(b.id)}
                onBlur={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
                onFocusCapture={() => setActiveBlockId(b.id)}
                onBlurCapture={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
              >
                <div className="row" style={{gap:8, alignItems:'center', justifyContent:'center', flexWrap:'wrap'}}>
                  <input
                    type="file"
                    accept="image/*"
                    style={{display:'none'}}
                    onChange={async (e)=>{
                      const f = e.target.files?.[0];
                      if (f) {
                        applyFilesToBlock(b.id, [f]);
                      }
                      e.target.value = '';
                    }}
                  />
                  <button onClick={(e)=>{ const el = (e.currentTarget.previousSibling as HTMLInputElement); (el as HTMLInputElement)?.click(); }}>{t('browse')}</button>
                  {b.files[0] && (<span className="small">{t('generatedNameLabel')}: {b.files[0].displayName}</span>)}
                  <span className="small">{t('dragDropOrChooseImage')}</span>
                  <span className="small">{t('rightClickForPaste')}</span>
                </div>
              </div>
            ) : b.type === 'options' ? (
              <div
                className="dropzone"
                tabIndex={0}
                role="button"
                onDragOver={(e)=> { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e)=> onDropToOptions(e, b.id)}
                onPaste={(e)=> handlePasteOnBlock(e, b.id)}
                onContextMenu={(e)=> { e.preventDefault(); e.stopPropagation(); setActiveBlockId(b.id); setContextMenu({ blockId: b.id, target: 'options', x: e.clientX, y: e.clientY }); }}
                onMouseEnter={() => setActiveBlockId(b.id)}
                onMouseLeave={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
                onFocus={() => setActiveBlockId(b.id)}
                onBlur={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
                onFocusCapture={() => setActiveBlockId(b.id)}
                onBlurCapture={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
              >
                <div className="grid" style={{gridTemplateColumns:'repeat(5, 1fr)', gap:8}}>
                  {[0,1,2,3,4].map(i => (
                    <div key={i}>
                      <div className="small">({String.fromCharCode(65 + i)})</div>
                      <input
                        type="file"
                        accept="image/*"
                        style={{display:'none'}}
                        onChange={(e)=>{
                          const f = e.target.files?.[0];
                          if (f) {
                            const [blockFile] = makeBlockFiles([f]);
                            setFile(b.id, i, blockFile);
                          }
                          e.target.value = '';
                        }}
                      />
                      <button onClick={(e)=>{ const el = (e.currentTarget.previousSibling as HTMLInputElement); (el as HTMLInputElement)?.click(); }}>{t('browse')}</button>
                      {b.files[i] && (<div className="small" style={{marginTop:4}}>{b.files[i].displayName}</div>)}
                    </div>
                  ))}
                </div>
                <div className="row" style={{justifyContent:'center', marginTop:8, gap:8, flexWrap:'wrap'}}>
                  <span className="small">{t('dragDropMultiple')}</span>
                  <span className="small">{t('rightClickForPaste')}</span>
                </div>
              </div>
            ) : (
              <div
                className="dropzone"
                tabIndex={0}
                role="button"
                onDragOver={(e)=> { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e)=> onDropToCustom(e, b.id)}
                onPaste={(e)=> handlePasteOnBlock(e, b.id)}
                onContextMenu={(e)=> { e.preventDefault(); e.stopPropagation(); setActiveBlockId(b.id); setContextMenu({ blockId: b.id, target: 'custom', x: e.clientX, y: e.clientY }); }}
                onMouseEnter={() => setActiveBlockId(b.id)}
                onMouseLeave={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
                onFocus={() => setActiveBlockId(b.id)}
                onBlur={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
                onFocusCapture={() => setActiveBlockId(b.id)}
                onBlurCapture={() => setActiveBlockId((prev) => (prev === b.id ? null : prev))}
              >
                {b.type === 'custom' && (
                  <>
                    <div className="row" style={{gap:12, justifyContent:'center', alignItems:'center', marginBottom:8}}>
                      <label className="small">{t('count')} <input type="number" min={1} max={26} value={b.count} onChange={(e)=>{
                        const val = Math.max(1, Math.min(26, parseInt(e.target.value || '1', 10)));
                        setBlocks(prev => prev.map(bb => bb.id === b.id && (bb as any).type === 'custom' ? ({ ...(bb as any), count: val } as Block) : bb));
                      }} style={{width:72, marginLeft:6}} /></label>
                      <div className="row" style={{gap:8, alignItems:'center'}}>
                        <label className="small"><input type="radio" name={"label-"+b.id} checked={(b as any).labelScheme==='letters'} onChange={()=> setBlocks(prev => prev.map(bb => bb.id === b.id && (bb as any).type === 'custom' ? ({ ...(bb as any), labelScheme: 'letters' } as Block) : bb))} /> {t('lettersLower')}</label>
                        <label className="small"><input type="radio" name={"label-"+b.id} checked={(b as any).labelScheme==='numbers'} onChange={()=> setBlocks(prev => prev.map(bb => bb.id === b.id && (bb as any).type === 'custom' ? ({ ...(bb as any), labelScheme: 'numbers' } as Block) : bb))} /> {t('numbersParen')}</label>
                      </div>
                    </div>
                    <div className="grid" style={{gridTemplateColumns:`repeat(${Math.min((b as any).count, 5)}, 1fr)`, gap:8}}>
                      {Array.from({ length: (b as any).count }).map((_, i) => (
                        <div key={i}>
                          <div className="small">{(b as any).labelScheme === 'numbers' ? `(${i+1})` : String.fromCharCode(97 + i)}</div>
                          <input
                            type="file"
                            accept="image/*"
                            style={{display:'none'}}
                            onChange={(e)=>{
                              const f = e.target.files?.[0];
                              if (f) {
                                const [blockFile] = makeBlockFiles([f]);
                                setFile(b.id, i, blockFile);
                              }
                              e.target.value = '';
                            }}
                          />
                          <button onClick={(e)=>{ const el = (e.currentTarget.previousSibling as HTMLInputElement); (el as HTMLInputElement)?.click(); }}>{t('browse')}</button>
                          {b.files[i] && (<div className="small" style={{marginTop:4}}>{b.files[i].displayName}</div>)}
                        </div>
                      ))}
                    </div>
                    <div className="row" style={{justifyContent:'center', marginTop:8}}>
                      <span className="small">{t('dragDropMultipleCustom')}</span>
                      <span className="small">{t('rightClickForPaste')}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
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
            onClick={(event) => {
              event.stopPropagation();
              handleContextPaste(contextMenu.blockId);
            }}
          >
            {t('pasteFromClipboard')}
          </button>
        </div>
      )}

      {previewUrl && (
        <div style={{marginTop:12}}>
          <div className="row" style={{gap:8}}>
            <span className="badge">{t('preview')}</span>
          </div>
          <div className="row" style={{justifyContent:'flex-end', margin:'6px 0'}}>
            <button onClick={()=> openViewerWindow(previewUrl, { title: t('viewLarge'), back: t('back') })}>{t('viewLarge')}</button>
          </div>
          <img className="preview" src={previewUrl} />
          <div className="row" style={{gap:8, marginTop:8}}>
            <button onClick={()=> {
              if (previewUrl) URL.revokeObjectURL(previewUrl);
              setPreviewUrl('');
              setComposedBlob(null);
            }}>{t('regenerate')}</button>
            <button
              className="primary"
              disabled={!composedBlob}
              onClick={async () => {
                if (!composedBlob) return;
                const targetPath = `images/${problem.id}.jpg`;
                await saveImageBlobAtPath(targetPath, composedBlob);
                update({ id: problem.id, image: targetPath });
                setComposedBlob(null);
              }}
            >
              {t('confirmImage')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
