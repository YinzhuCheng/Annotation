import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import { saveImageBlob } from '../lib/db';

type Block =
  | { id: string; type: 'single'; files: (File | Blob)[] }
  | { id: string; type: 'options'; files: (File | Blob)[] }; // up to 5 in A..E order

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
      try { const arr = JSON.parse(raw) as { id: string; type: 'single' | 'options'; }[]; return arr.map(b => ({ ...b, files: [] } as any)); } catch {}
    }
    return [];
  });
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [composedPath, setComposedPath] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    const lite = blocks.map(b => ({ id: b.id, type: b.type }));
    localStorage.setItem(`image-blocks-${problem.id}`, JSON.stringify(lite));
  }, [blocks, problem.id]);

  const addBlock = (type: 'single' | 'options') => {
    setBlocks(b => [...b, { id: `${Date.now()}-${Math.random()}`, type, files: [] } as Block]);
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

      // Determine groups for options block: default to A / BC / DE for 5 options
      const computeOptionGroups = (count: number): number[] => {
        if (count <= 0) return [];
        if (count === 1) return [1];
        if (count === 2) return [2];
        if (count === 3) return [1, 2];
        if (count === 4) return [1, 2, 1];
        return [1, 2, 2]; // 5 or more (we cap at 5 elsewhere)
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
        } else {
          const present = b.files.filter(Boolean);
          if (!present.length) continue;
          // Determine grouped layout
          const baseGroups = computeOptionGroups(present.length);
          const groups = enforceMinArea(baseGroups);

          let optIdx = 0;
          let isFirstGroup = true;
          for (const g of groups) {
            let rowHeight = 0;
            const topOffset = (isFirstGroup ? rowLabelLineHeight : 0);
            if (g <= 1) {
              // single option full width
              const u = URL.createObjectURL(present[optIdx] as Blob);
              const img = await readImage(u);
              const scale = drawWidthFull / img.width;
              rowHeight = Math.max(rowHeight, img.height * scale + topOffset + colLabelLineHeight);
              URL.revokeObjectURL(u);
              optIdx += 1;
            } else {
              // multiple options in one row
              const colWidth = (drawWidthFull - optionGap * (g - 1)) / g;
              for (let i = 0; i < g; i++) {
                const u = URL.createObjectURL(present[optIdx + i] as Blob);
                const img = await readImage(u);
                const scale = colWidth / img.width;
                rowHeight = Math.max(rowHeight, img.height * scale + topOffset + colLabelLineHeight);
                URL.revokeObjectURL(u);
              }
              optIdx += g;
            }
            totalHeight += rowHeight + gap;
            isFirstGroup = false;
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
        } else {
          const present = b.files.filter(Boolean);
          if (!present.length) continue;
          const baseGroups = computeOptionGroups(present.length);
          const groups = enforceMinArea(baseGroups);

          let optIdx = 0;
          let isFirstGroup = true;
          for (const g of groups) {
            const drawWidth = targetWidth - padding * 2;
            let rowH = 0;
            // Row label only for first group in options block
            if (isFirstGroup) {
              ctx.fillStyle = '#000000';
              ctx.font = `${rowLabelFontSize}px sans-serif`;
              ctx.fillText(`<Image ${rowIndex}>`, padding, y + Math.round(rowLabelFontSize * 0.8));
            }

            if (g <= 1) {
              const file = present[optIdx] as Blob;
              const url = URL.createObjectURL(file);
              const img = await readImage(url);
              const scale = drawWidth / img.width;
              const h = img.height * scale;
              const x = padding;
              // label (A..E) under the row label
              const label = String.fromCharCode(65 + optIdx);
              ctx.fillStyle = '#000000';
              ctx.font = `${colLabelFontSize}px sans-serif`;
              const topOffset = isFirstGroup ? rowLabelLineHeight : 0;
              ctx.fillText(`(${label})`, x, y + topOffset + Math.round(colLabelFontSize * 0.8));
              ctx.drawImage(img, x, y + topOffset + colLabelLineHeight, drawWidth, h);
              rowH = Math.max(rowH, h + topOffset + colLabelLineHeight);
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
                const label = String.fromCharCode(65 + optIdx + i);
                ctx.fillStyle = '#000000';
                ctx.font = `${colLabelFontSize}px sans-serif`;
                const topOffset = isFirstGroup ? rowLabelLineHeight : 0;
                ctx.fillText(`(${label})`, x, y + topOffset + Math.round(colLabelFontSize * 0.8));
                ctx.drawImage(img, x, y + topOffset + colLabelLineHeight, colWidth, h);
                rowH = Math.max(rowH, h + topOffset + colLabelLineHeight);
                URL.revokeObjectURL(url);
              }
              optIdx += g;
            }

            y += rowH + gap;
            isFirstGroup = false;

            // separator line except after last group within block is handled below via bi check
          }
          // Increment image index once per options block
          rowIndex += 1;
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
        <button className="primary" onClick={compose} disabled={!blocks.length || isComposing}>{t('compose')}</button>
      </div>

      <div className="grid" style={{gap:12, gridTemplateColumns:'1fr'}}>
        {blocks.map((b, idx) => (
          <div key={b.id} className="card">
            <div className="row" style={{justifyContent:'space-between', marginBottom:8}}>
              <strong>{b.type === 'single' ? t('singleBlock') : t('optionBlock')}</strong>
              <button onClick={() => removeBlock(b.id)}>✕</button>
            </div>
            {b.type === 'single' ? (
              <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={(e)=> onDropToSingle(e, b.id)}>
                <div className="row" style={{gap:8, alignItems:'center', justifyContent:'center'}}>
                  {(() => {
                    let fileEl: HTMLInputElement | null = null;
                    let dirEl: HTMLInputElement | null = null;
                    return (
                      <>
                        <input type="file" accept="image/*" style={{display:'none'}} ref={(el)=>{ fileEl = el; }} onChange={(e)=>{
                          const f = e.target.files?.[0];
                          if (f) setFile(b.id, 0, f);
                        }} />
                        <input type="file" style={{display:'none'}} multiple ref={(el)=>{ if (el) { el.setAttribute('webkitdirectory',''); el.setAttribute('directory',''); dirEl = el; } }} onChange={(e)=>{
                          const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
                          files.sort((a, b) => a.name.localeCompare(b.name));
                          const f = files[0];
                          if (f) setFile(b.id, 0, f);
                        }} />
                        <button onClick={()=> fileEl?.click()}>{t('browse')}</button>
                        <button onClick={()=> dirEl?.click()}>{t('folder')}</button>
                      </>
                    );
                  })()}
                  <span className="small">{t('dropHintSingle')}</span>
                </div>
              </div>
            ) : (
              <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={(e)=> onDropToOptions(e, b.id)}>
                <div className="grid" style={{gridTemplateColumns:'repeat(5, 1fr)', gap:8}}>
                  {[0,1,2,3,4].map(i => (
                    <div key={i}>
                      <div className="small">({String.fromCharCode(65 + i)})</div>
                      {(() => {
                        let fileEl: HTMLInputElement | null = null;
                        return (
                          <>
                            <input type="file" accept="image/*" style={{display:'none'}} ref={(el)=>{ fileEl = el; }} onChange={(e)=>{
                              const f = e.target.files?.[0];
                              if (f) setFile(b.id, i, f);
                            }} />
                            <button onClick={()=> fileEl?.click()}>{t('browse')}</button>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
                <div className="row" style={{justifyContent:'center', marginTop:8}}>
                  {(() => {
                    let dirEl: HTMLInputElement | null = null;
                    const onDirChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                      const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
                      files.sort((a, b) => a.name.localeCompare(b.name));
                      setBlocks(prev => prev.map(bb => {
                        if (bb.id !== b.id) return bb;
                        const next: (File | Blob)[] = [];
                        for (const f of files) {
                          if (next.length >= 5) break;
                          next.push(f);
                        }
                        return { ...bb, files: next } as Block;
                      }));
                    };
                    return (
                      <>
                        <input type="file" style={{display:'none'}} multiple ref={(el)=>{ if (el) { el.setAttribute('webkitdirectory',''); el.setAttribute('directory',''); dirEl = el; } }} onChange={onDirChange} />
                        <button onClick={()=> dirEl?.click()}>{t('folder')}</button>
                      </>
                    );
                  })()}
                  <span className="small">{t('dropHintOptions')}</span>
                </div>
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
          <img className="preview" src={previewUrl} />
          <div className="row" style={{gap:8, marginTop:8, justifyContent:'space-between'}}>
            <button onClick={()=> window.open(`/image-viewer.html?lang=${encodeURIComponent(String((t as any).i18n?.language || 'en'))}&src=${encodeURIComponent(previewUrl)}`, '_blank')}>{t('viewLarge')}</button>
            <button onClick={()=> setPreviewUrl('')}>{t('regenerate')}</button>
            <button className="primary" disabled={!composedPath} onClick={()=> { update({ id: problem.id, image: composedPath }); }}>{t('confirmImage')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
