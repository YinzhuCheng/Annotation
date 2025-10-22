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
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b;
      const next = [...b.files];
      for (const f of files) {
        if (next.length >= 5) break;
        next.push(f);
      }
      return { ...b, files: next } as Block;
    }));
  };

  const compose = async () => {
    setIsComposing(true);
    try {
      const targetWidth = 1000;
      const padding = 24;
      const gap = 16;
      const optionGap = 10;
      let totalHeight = padding; // start padding

      // First pass: measure heights
      for (const b of blocks) {
        if (b.type === 'single') {
          const file = b.files[0];
          if (!file) continue;
          const url = URL.createObjectURL(file);
          const img = await readImage(url);
          const scale = (targetWidth - padding * 2) / img.width;
          totalHeight += img.height * scale + gap;
          URL.revokeObjectURL(url);
        } else {
          const present = b.files.filter(Boolean);
          if (!present.length) continue;
          const cols = present.length;
          let rowHeight = 0;
          for (let i=0;i<present.length;i++){
            const u = URL.createObjectURL(present[i] as Blob);
            const img = await readImage(u);
            const colWidth = (targetWidth - padding * 2 - optionGap * (cols - 1)) / cols;
            const scale = colWidth / img.width;
            rowHeight = Math.max(rowHeight, img.height * scale + 24); // include label space
            URL.revokeObjectURL(u);
          }
          totalHeight += rowHeight + gap;
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
      ctx.font = '20px sans-serif';
      let y = padding;
      const separatorColor = '#e5e7eb';

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
          ctx.drawImage(img, padding, y, drawWidth, h);
          y += h + gap;
          URL.revokeObjectURL(url);
        } else {
          const present = b.files.filter(Boolean);
          if (!present.length) continue;
          const cols = present.length;
          const colWidth = (targetWidth - padding * 2 - optionGap * (cols - 1)) / cols;
          let rowH = 0;
          for (let i=0;i<present.length;i++){
            const file = present[i] as Blob;
            const url = URL.createObjectURL(file);
            const img = await readImage(url);
            const scale = colWidth / img.width;
            const h = img.height * scale;
            const x = padding + i * (colWidth + optionGap);
            // label (A..E)
            const label = String.fromCharCode(65 + i);
            ctx.fillStyle = '#000000';
            ctx.fillText(`(${label})`, x, y + 18);
            ctx.drawImage(img, x, y + 24, colWidth, h);
            rowH = Math.max(rowH, h + 24);
            URL.revokeObjectURL(url);
          }
          y += rowH + gap;
        }
        // separator line except after last
        if (bi < blocks.length - 1) {
          ctx.strokeStyle = separatorColor;
          ctx.beginPath();
          ctx.moveTo(padding, y - gap/2);
          ctx.lineTo(targetWidth - padding, y - gap/2);
          ctx.stroke();
        }
      }

      const blob = await new Promise<Blob>((resolve) => canvas.toBlob(b => resolve(b || new Blob()), 'image/jpeg', 0.92));
      const path = await saveImageBlob(blob);
      update({ id: problem.id, image: path });
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
              <div className="row" style={{gap:8}}>
                <input type="file" accept="image/*" onChange={(e)=>{
                  const f = e.target.files?.[0];
                  if (f) setFile(b.id, 0, f);
                }} />
              </div>
            ) : (
              <div className="dropzone" onDragOver={(e)=> e.preventDefault()} onDrop={(e)=> onDropToOptions(e, b.id)}>
                <div className="grid" style={{gridTemplateColumns:'repeat(5, 1fr)', gap:8}}>
                  {[0,1,2,3,4].map(i => (
                    <div key={i}>
                      <div className="small">({String.fromCharCode(65 + i)})</div>
                      <input type="file" accept="image/*" onChange={(e)=>{
                        const f = e.target.files?.[0];
                        if (f) setFile(b.id, i, f);
                      }} />
                    </div>
                  ))}
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
          <div className="row" style={{gap:8, marginTop:8}}>
            <button onClick={()=> setPreviewUrl('')}>{t('regenerate')}</button>
            <button className="primary" onClick={()=> {/* already saved in compose */}}>{t('confirmImage')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
