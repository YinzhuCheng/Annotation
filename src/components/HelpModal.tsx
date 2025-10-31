import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  class Boundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
    constructor(props: any) {
      super(props);
      this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
      return { hasError: true };
    }
    componentDidCatch() {}
    render() {
      if (this.state.hasError) {
        return (
          <div className="modal" role="dialog" aria-modal="true" tabIndex={-1}>
            <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
              <h3 style={{margin:0}}>{t('helpTitle') || 'Help'}</h3>
              <button onClick={onClose}>✕</button>
            </div>
            <hr className="div" />
            <div>
              <p style={{margin:0}}>{t('helpError') || 'Help content failed to render. Please close this dialog.'}</p>
            </div>
          </div>
        );
      }
      return this.props.children as any;
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    // Focus modal for accessibility
    const el = modalRef.current;
    if (el) {
      setTimeout(() => el.focus(), 0);
    }
  }, []);
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <Boundary>
        <div ref={modalRef} className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} tabIndex={-1}>
          <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
            <h3 style={{margin:0}}>{t('helpTitle') || 'Help'}</h3>
            <button onClick={onClose}>✕</button>
          </div>
          <hr className="div" />
          <div className="grid" style={{gridTemplateColumns:'1fr 1fr', gap:16}}>
            <div>
              <h4 style={{marginTop:0}}>English</h4>
              <div className="card" style={{marginTop:8}}>
                <h5 style={{margin:'0 0 8px 0'}}>Workflow Overview</h5>
                <ul className="list">
                  <li>Open <strong>LLM Configuration</strong> to set API keys, base URLs, and models for every agent.</li>
                  <li>Import, paste, or type problems; run OCR on screenshots to capture the source text.</li>
                  <li>Use the translation assistant whenever you need an English-to-Chinese or Chinese-to-English version.</li>
                  <li>Generate or polish questions, then fill in subfields, difficulty, and other metadata.</li>
                  <li>Save your progress and export datasets or composed images when finished.</li>
                </ul>
              </div>
              <div className="card" style={{marginTop:12}}>
                <h5 style={{margin:'0 0 8px 0'}}>LLM Agents</h5>
                <ul className="list">
                  <li><strong>OCR Agent:</strong> Extracts text from uploaded images with a vision-capable model.</li>
                  <li><strong>Translation Agent:</strong> Converts questions or answers between English and Chinese while preserving notation.</li>
                  <li><strong>LaTeX Correction Agent:</strong> Normalizes mathematical expressions into consistent LaTeX.</li>
                  <li><strong>Problem Generation Agent:</strong> Crafts structured problems, answers, and metadata from prompts.</li>
                </ul>
              </div>
            </div>
            <div>
              <h4 style={{marginTop:0}}>中文</h4>
              <div className="card" style={{marginTop:8}}>
                <h5 style={{margin:'0 0 8px 0'}}>使用流程</h5>
                <ul className="list">
                  <li>在「LLM 配置」中为各代理填写 API Key、Base URL 与模型。</li>
                  <li>通过导入、粘贴或手动输入录入题目，必要时对截图执行 OCR。</li>
                  <li>使用翻译助手在中英文之间快速切换题目或答案文本。</li>
                  <li>生成或校对题目后，完善分支领域、难度、学段等元信息。</li>
                  <li>随时保存，准备好后导出题目数据或合成图片。</li>
                </ul>
              </div>
              <div className="card" style={{marginTop:12}}>
                <h5 style={{margin:'0 0 8px 0'}}>LLM 代理说明</h5>
                <ul className="list">
                  <li><strong>OCR 代理：</strong> 借助具备视觉能力的模型读取截图文字。</li>
                  <li><strong>翻译代理：</strong> 在中英文之间转换题目或答案，保持数学符号与 LaTeX 不变。</li>
                  <li><strong>LaTeX 校正代理：</strong> 统一数学表达式的 LaTeX 写法。</li>
                  <li><strong>题目生成代理：</strong> 将提示加工为完整的题目、答案及元数据。</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Boundary>
    </div>,
    document.body
  );
}
