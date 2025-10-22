import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
          <h3 style={{margin:0}}>{t('helpTitle')}</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <hr className="div" />
        <div className="grid" style={{gridTemplateColumns:'1fr 1fr', gap:16}}>
          <div>
            <h4 style={{marginTop:0}}>English</h4>
            <ul className="list">
              <li>Local-first; data stays in your browser (localStorage/IndexedDB/OPFS).</li>
              <li>Manual and LLM Agent modes; switch anytime and state auto-saves.</li>
              <li>Agent mode: paste/upload images, client-side OCR with Tesseract.js.</li>
              <li>Unified LLM adapter (OpenAI-compatible, Gemini, Claude) via a Cloudflare Pages Function proxy.</li>
              <li>Generate Multiple Choice / Fill-in-the-blank / Proof; auto-fill attributes.</li>
              <li>Images composed client-side into a single JPG under images/&lt;timestamp&gt;.jpg.</li>
              <li>LaTeX Correction converts symbols like ℤ into \\mathbb{Z}.</li>
              <li>Import/Export dataset to XLSX with the specified header.</li>
              <li>Storage usage and quota shown; cache remains across reloads.</li>
              <li>Privacy: API keys/config live only in your browser; no server storage.</li>
            </ul>
          </div>
          <div>
            <h4 style={{marginTop:0}}>中文</h4>
            <ul className="list">
              <li>本地优先；数据仅保存在浏览器（localStorage/IndexedDB/OPFS）。</li>
              <li>支持手动模式与 LLM 代理模式；可随时切换并自动保存状态。</li>
              <li>代理模式：支持粘贴/上传图片，使用 Tesseract.js 在本地执行 OCR。</li>
              <li>统一 LLM 适配（OpenAI 兼容、Gemini、Claude），通过 Cloudflare Pages 函数代理。</li>
              <li>可生成选择题/填空题/证明题，并自动补全主要属性。</li>
              <li>图片在本地合成为单张 JPG，路径为 images/&lt;timestamp&gt;.jpg。</li>
              <li>LaTeX 纠正：将 ℤ 等符号转换为合法 LaTeX（如 \\mathbb{Z}）。</li>
              <li>按指定表头导入/导出 XLSX。</li>
              <li>显示存储用量与配额；刷新后仍能恢复。</li>
              <li>隐私：API Key 与配置仅在本地使用，不经服务器保存。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
