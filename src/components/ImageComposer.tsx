import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import { saveImageBlob } from '../lib/db';
import { openViewerWindow } from '../lib/viewer';

type Block =
  | { id: string; type: 'single'; files: (File | Blob)[] }
  | { id: string; type: 'options'; files: (File | Blob)[] } // up to 5 in A..E order
  | { id: string; type: 'custom'; files: (File | Blob)[]; count: number; labelScheme: 'letters' | 'numbers' };

function readImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function ImageComposer() {
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
  const [composedPath, setComposedPath] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);

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

  const setFile = (blockId: string, idx: number, file: File | Blob) => {
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

  const onDropToOptions = (e: React.DragEvent, blockId: string) => {
    e.preventDefault();
    collectDroppedFiles(e.dataTransfer.items).then((all) => {
      const files = all.filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      files.sort((a, b) => a.name.localeCompare(b.name));
      setBlocks(prev => prev.map(b => {
        if (b.id !== blockId) return b;
        const next = [...b.files];
        for (const f of files) {
          if (next.length >= 5) break;
          next.push(f);
        }
        return { ...b, files: next } as Block;
      }));
    });
  };

  const onDropToSingle = (e: React.DragEvent, blockId: string) => {
    e.preventDefault();
    collectDroppedFiles(e.dataTransfer.items).then((all) => {
      const files = all.filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      files.sort((a, b) => a.name.localeCompare(b.name));
      setBlocks(prev => prev.map(b => {
        if (b.id !== blockId) return b;
        const next = [...b.files];
        next[0] = files[0];
        return { ...b, files: next } as Block;
      }));
    });
  };

  const onDropToCustom = (e: React.DragEvent, blockId: string) => {
    e.preventDefault();
    collectDroppedFiles(e.dataTransfer.items).then((all) => {
      const files = all.filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      files.sort((a, b) => a.name.localeCompare(b.name));
      setBlocks(prev => prev.map(b => {
        if (b.id !== blockId) return b;
        if ((b as any).type !== 'custom') return b;
        const limit = (b as any).count as number;
        const next = [...b.files];
        for (const f of files) {
          if (next.length >= limit) break;
          next.push(f);
        }
        return { ...(b as any), files: next } as Block;
      }));
    });
  };

  // Utilities to collect dropped files including directories
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

  const compose = async () => {
    setIsComposing(true);
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
          const file = b.files[0];
          if (!file) continue;
          const url = URL.createObjectURL(file);
          const img = await readImage(url);
          const scale = (targetWidth - padding * 2) / img.width;
          // include row label height
          totalHeight += img.height * scale + rowLabelLineHeight + gap;
          URL.revokeObjectURL(url);
        } else if (b.type === 'options' || b.type === 'custom') {
          const present = b.files.filter(Boolean);
          if (!present.length) continue;
          // Determine grouped layout
          const baseGroups = computeOptionGroups(present.length);
          const groups = enforceMinArea(baseGroups);

          let optIdx = 0;
          for (const g of groups) {
            let rowHeight = 0;
            if (g <= 1) {
              // single option full width
              const u = URL.createObjectURL(present[optIdx] as Blob);
              const img = await readImage(u);
              const scale = drawWidthFull / img.width;
              rowHeight = Math.max(rowHeight, img.height * scale + rowLabelLineHeight + colLabelLineHeight);
              URL.revokeObjectURL(u);
              optIdx += 1;
            } else {
              // multiple options in one row
              const colWidth = (drawWidthFull - optionGap * (g - 1)) / g;
              for (let i = 0; i < g; i++) {
                const u = URL.createObjectURL(present[optIdx + i] as Blob);
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
      ctx.fillStyle = '#000000';
      ctx.font = `${rowLabelFontSize}px sans-serif`;
      let y = padding;
      const separatorColor = '#3b82f6'; // blue separators
      const separatorWidth = 2;
      let rowIndex = 1; // for <Image N>

      for (let bi=0;bi<blocks.length;bi++){
        const b = blocks[bi];
        if (b.type === 'single') {
          const file = b.files[0];
          if (!file) continue;
          const url = URL.createObjectURL(file);
          const img = await readImage(url);
          const drawWidth = targetWidth - padding * 2;
          const scale = drawWidth / img.width;
          const h = img.height * scale;
          // Row label: <Image N>
          ctx.fillStyle = '#000000';
          ctx.font = `${rowLabelFontSize}px sans-serif`;
          ctx.fillText(`<Image ${rowIndex}>`, padding, y + Math.round(rowLabelFontSize * 0.8));
          // Draw image below the row label line
          ctx.drawImage(img, padding, y + rowLabelLineHeight, drawWidth, h);
          y += h + rowLabelLineHeight + gap;
          rowIndex += 1;
          URL.revokeObjectURL(url);
        } else if (b.type === 'options' || b.type === 'custom') {
          const present = b.files.filter(Boolean);
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
              ctx.fillStyle = '#000000';
              ctx.font = `${rowLabelFontSize}px sans-serif`;
              ctx.fillText(`<Image ${rowIndex}>`, padding, y + Math.round(rowLabelFontSize * 0.8));
              drawnRowLabelForThisBlock = true;
            }

            if (g <= 1) {
              const file = present[optIdx] as Blob;
              const url = URL.createObjectURL(file);
              const img = await readImage(url);
              const scale = drawWidth / img.width;
              const h = img.height * scale;
              const x = padding;
              // label under the row label
              const { text: label, wrapParen } = makeLabel(b, optIdx);
              ctx.fillStyle = '#000000';
              ctx.font = `${colLabelFontSize}px sans-serif`;
              ctx.fillText(wrapParen ? `(${label})` : `${label}`, x, y + rowLabelLineHeight + Math.round(colLabelFontSize * 0.8));
              ctx.drawImage(img, x, y + rowLabelLineHeight + colLabelLineHeight, drawWidth, h);
              rowH = Math.max(rowH, h + rowLabelLineHeight + colLabelLineHeight);
              URL.revokeObjectURL(url);
              optIdx += 1;
            } else {
              const colWidth = (drawWidth - optionGap * (g - 1)) / g;
              for (let i = 0; i < g; i++) {
                const file = present[optIdx + i] as Blob;
                const url = URL.createObjectURL(file);
                const img = await readImage(url);
                const scale = colWidth / img.width;
                const h = img.height * scale;
                const x = padding + i * (colWidth + optionGap);
                const { text: label, wrapParen } = makeLabel(b, optIdx + i);
                ctx.fillStyle = '#000000';
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
      const path = await saveImageBlob(blob);
      setComposedPath(path);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } finally {
      setIsComposing(false);
    }
  };

  return (
    <div>
      <div className="label">{t('imageBlock')}</div>
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
              <button onClick={() => removeBlock(b.id)}>✕</button>
            </div>
            {b.type === 'single' ? (
              <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={(e)=> onDropToSingle(e, b.id)}>
                <div className="row" style={{gap:8, alignItems:'center', justifyContent:'center'}}>
                  {/* Hide native file input to avoid OS-language labels */}
                  <input type="file" accept="image/*" style={{display:'none'}} onChange={(e)=>{
                    const f = e.target.files?.[0];
                    if (f) setFile(b.id, 0, f);
                  }} />
                  <button onClick={(e)=>{ const el = (e.currentTarget.previousSibling as HTMLInputElement); (el as HTMLInputElement)?.click(); }}>{t('browse')}</button>
                  {b.files[0] && (<span className="small">{t('selectedFile')} {(b.files[0] as File).name || t('imageAttached')}</span>)}
                  <span className="small">{t('dragDropOrChooseImage')}</span>
                </div>
              </div>
            ) : b.type === 'options' ? (
              <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={(e)=> onDropToOptions(e, b.id)}>
                <div className="grid" style={{gridTemplateColumns:'repeat(5, 1fr)', gap:8}}>
                  {[0,1,2,3,4].map(i => (
                    <div key={i}>
                      <div className="small">({String.fromCharCode(65 + i)})</div>
                      <input type="file" accept="image/*" style={{display:'none'}} onChange={(e)=>{
                        const f = e.target.files?.[0];
                        if (f) setFile(b.id, i, f);
                      }} />
                      <button onClick={(e)=>{ const el = (e.currentTarget.previousSibling as HTMLInputElement); (el as HTMLInputElement)?.click(); }}>{t('browse')}</button>
                      {b.files[i] && (<div className="small" style={{marginTop:4}}>{(b.files[i] as File).name}</div>)}
                    </div>
                  ))}
                </div>
                <div className="row" style={{justifyContent:'center', marginTop:8}}>
                  <span className="small">{t('dragDropMultiple')}</span>
                </div>
              </div>
            ) : (
              <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={(e)=> onDropToCustom(e, b.id)}>
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
                          <input type="file" accept="image/*" style={{display:'none'}} onChange={(e)=>{
                            const f = e.target.files?.[0];
                            if (f) setFile(b.id, i, f);
                          }} />
                          <button onClick={(e)=>{ const el = (e.currentTarget.previousSibling as HTMLInputElement); (el as HTMLInputElement)?.click(); }}>{t('browse')}</button>
                          {b.files[i] && (<div className="small" style={{marginTop:4}}>{(b.files[i] as File).name}</div>)}
                        </div>
                      ))}
                    </div>
                    <div className="row" style={{justifyContent:'center', marginTop:8}}>
                      <span className="small">{t('dragDropMultipleCustom')}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

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
            <button onClick={()=> setPreviewUrl('')}>{t('regenerate')}</button>
            <button className="primary" disabled={!composedPath} onClick={()=> { update({ id: problem.id, image: composedPath }); }}>{t('confirmImage')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
