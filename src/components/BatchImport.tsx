import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import { useImportStore } from '../state/importStore';
import { extractCoarseBlocksFromPdf, analyzeCoarseBlockWithLLM, rewriteCandidatesWithLLM } from '../lib/pdfPipeline';
import { asyncPool } from '../lib/asyncPool';
import { downloadBlob } from '../lib/storage';

export function BatchImport() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { llmAgents, defaults } = useAppStore();
  const getAppState = useAppStore;
  const {
    pdfMeta,
    pages,
    coarseBlocks,
    detailedCandidates,
    rewriteResults,
    reviewCursor,
    stepStatus,
    settings,
    error,
    isBusy,
    setSettings,
    reset,
    setPdfMeta,
    setPages,
    setCoarseBlocks,
    patchCoarseBlock,
    upsertDetailedCandidates,
    upsertRewriteResult,
    patchRewriteResult,
    markAccepted,
    setReviewCursor,
    setStepStatus,
    setError,
    setBusy
  } = useImportStore();

  const [localError, setLocalError] = useState<string | null>(null);

  const generatorAgent = llmAgents.generator;

  const blocksById = useMemo(() => {
    const map = new Map<string, typeof coarseBlocks[number]>();
    coarseBlocks.forEach((block) => map.set(block.id, block));
    return map;
  }, [coarseBlocks]);

  const candidatesByBlock = useMemo(() => {
    const map = new Map<string, ReturnType<typeof detailedCandidates.filter>>();
    coarseBlocks.forEach((block) => {
      const related = detailedCandidates.filter((candidate) => candidate.blockId === block.id);
      map.set(block.id, related);
    });
    return map;
  }, [coarseBlocks, detailedCandidates]);

  const currentReview = rewriteResults[reviewCursor];
  const currentCandidates = currentReview ? candidatesByBlock.get(currentReview.blockId) ?? [] : [];

  const ensureGeneratorAgent = useCallback((): boolean => {
    const cfg = generatorAgent?.config;
    if (!cfg?.apiKey?.trim() || !cfg?.model?.trim() || !cfg?.baseUrl?.trim()) {
      alert(t('llmMissingBody', { agent: t('agentGenerator') }));
      return false;
    }
    return true;
  }, [generatorAgent?.config, t]);

  const handleSelectPdf = useCallback(async (file: File) => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setLocalError(null);
    setStepStatus('coarse', 'processing');
    try {
      const result = await extractCoarseBlocksFromPdf(file, { targetDpi: 144 });
      setPdfMeta({ name: file.name, pageCount: result.pages.length });
      setPages(result.pages);
      const prepared = result.blocks.map((block, index) => ({
        ...block,
        id: `${block.pageId}-${index}`,
        index,
        status: block.status ?? 'pending'
      }));
      setCoarseBlocks(prepared);
      setStepStatus('coarse', 'completed');
    } catch (err: any) {
      const message = err?.message ? String(err.message) : String(err);
      setStepStatus('coarse', 'error');
      setError(message);
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  }, [setBusy, setError, setLocalError, setStepStatus, setPdfMeta, setPages, setCoarseBlocks]);

  const onUploadPdf = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await handleSelectPdf(file);
  }, [handleSelectPdf]);

  const runSegmentation = useCallback(async () => {
    if (!ensureGeneratorAgent()) return;
    if (!coarseBlocks.length) {
      alert(t('batchImport_noBlocks'));
      return;
    }
    setBusy(true);
    setStepStatus('detailed', 'processing');
    setError(undefined);
    setLocalError(null);
    try {
      const pending = coarseBlocks.filter((block) => block.status === 'pending' || block.status === 'error');
      let hadError = false;
      await asyncPool(pending, settings.concurrency, async (block) => {
        patchCoarseBlock(block.id, { status: 'processing', errorMessage: undefined });
        try {
          const candidates = await analyzeCoarseBlockWithLLM(block, generatorAgent, { minConfidence: settings.minConfidence });
          upsertDetailedCandidates(block.id, candidates);
          patchCoarseBlock(block.id, { status: candidates.length > 0 ? 'completed' : 'skipped' });
        } catch (error: any) {
          const message = error?.message ? String(error.message) : String(error);
          patchCoarseBlock(block.id, { status: 'error', errorMessage: message });
          hadError = true;
        }
      });
      setStepStatus('detailed', hadError ? 'error' : 'completed');
      if (hadError) {
        setLocalError(t('batchImport_segmentationPartial')); // We'll add translation key soon
      }
    } catch (err: any) {
      const message = err?.message ? String(err.message) : String(err);
      setError(message);
      setLocalError(message);
      setStepStatus('detailed', 'error');
    } finally {
      setBusy(false);
    }
  }, [ensureGeneratorAgent, coarseBlocks, t, settings.concurrency, settings.minConfidence, patchCoarseBlock, upsertDetailedCandidates, generatorAgent, setBusy, setStepStatus, setError]);

  const runRewrite = useCallback(async () => {
    if (!ensureGeneratorAgent()) return;
    if (!detailedCandidates.length) {
      alert(t('batchImport_noCandidates'));
      return;
    }
    setBusy(true);
    setStepStatus('rewrite', 'processing');
    setError(undefined);
    setLocalError(null);
    try {
      const tasks = coarseBlocks
        .map((block) => ({ block, candidates: candidatesByBlock.get(block.id) ?? [] }))
        .filter((entry) => entry.candidates.length > 0);
      let hadError = false;
      await asyncPool(tasks, settings.concurrency, async ({ block, candidates }) => {
        const rewriteId = block.id;
        upsertRewriteResult({
          id: rewriteId,
          blockId: block.id,
          pageId: block.pageId,
          candidateIds: candidates.map((c) => c.id),
          chosenCandidateId: null,
          status: 'processing',
          createdAt: Date.now()
        });
        try {
          const outcome = await rewriteCandidatesWithLLM(block, candidates, generatorAgent, { topK: settings.topK, defaults });
          upsertRewriteResult({
            id: rewriteId,
            blockId: block.id,
            pageId: block.pageId,
            candidateIds: candidates.map((c) => c.id),
            chosenCandidateId: outcome.chosenCandidateId,
            status: outcome.status === 'converted' ? 'converted' : outcome.status,
            raw: outcome.raw,
            patch: outcome.status === 'converted' ? outcome.patch : undefined,
            reason: outcome.reason,
            message: outcome.message,
            createdAt: Date.now()
          });
          if (outcome.status === 'error') {
            hadError = true;
          }
        } catch (error: any) {
          const message = error?.message ? String(error.message) : String(error);
          upsertRewriteResult({
            id: rewriteId,
            blockId: block.id,
            pageId: block.pageId,
            candidateIds: candidates.map((c) => c.id),
            chosenCandidateId: null,
            status: 'error',
            raw: '',
            message,
            createdAt: Date.now()
          });
          hadError = true;
        }
      });
      setStepStatus('rewrite', hadError ? 'error' : 'completed');
      if (hadError) {
        setLocalError(t('batchImport_rewritePartial'));
      }
    } catch (err: any) {
      const message = err?.message ? String(err.message) : String(err);
      setError(message);
      setLocalError(message);
      setStepStatus('rewrite', 'error');
    } finally {
      setBusy(false);
    }
  }, [ensureGeneratorAgent, detailedCandidates.length, t, coarseBlocks, candidatesByBlock, settings.concurrency, settings.topK, generatorAgent, defaults, upsertRewriteResult, setBusy, setStepStatus, setError]);

  const exportCoarse = useCallback(() => {
    if (!coarseBlocks.length) {
      alert(t('batchImport_noBlocks'));
      return;
    }
    const payload = JSON.stringify({
      pdf: pdfMeta,
      pages,
      blocks: coarseBlocks.map(({ id, pageId, pageNumber, rect, text, stats, status, skipReason, errorMessage }) => ({
        id,
        pageId,
        pageNumber,
        rect,
        text,
        stats,
        status,
        skipReason,
        errorMessage
      }))
    }, null, 2);
    downloadBlob(new Blob([payload], { type: 'application/json' }), `coarse-${Date.now()}.json`);
  }, [coarseBlocks, pdfMeta, pages, t]);

  const exportDetailed = useCallback(() => {
    if (!detailedCandidates.length) {
      alert(t('batchImport_noCandidates'));
      return;
    }
    const payload = JSON.stringify({
      pdf: pdfMeta,
      candidates: detailedCandidates
    }, null, 2);
    downloadBlob(new Blob([payload], { type: 'application/json' }), `segmented-${Date.now()}.json`);
  }, [detailedCandidates, pdfMeta, t]);

  const exportRewrites = useCallback(() => {
    if (!rewriteResults.length) {
      alert(t('batchImport_noRewrites'));
      return;
    }
    const payload = JSON.stringify({
      pdf: pdfMeta,
      rewrites: rewriteResults
    }, null, 2);
    downloadBlob(new Blob([payload], { type: 'application/json' }), `rewrites-${Date.now()}.json`);
  }, [rewriteResults, pdfMeta, t]);

  const acceptCurrent = useCallback(() => {
    if (!currentReview || currentReview.status !== 'converted' || !currentReview.patch) {
      return;
    }
    const patch = currentReview.patch;
    const id = `${Date.now()}`;
    const state = getAppState.getState();
    state.upsertProblem({
      id,
      ...patch,
      source: pdfMeta ? `${pdfMeta.name} (Batch Import)` : 'Batch Import',
      image: '',
      imageDependency: 0
    });
    markAccepted(currentReview.id);
    setReviewCursor(reviewCursor + 1);
  }, [currentReview, getAppState, pdfMeta, markAccepted, setReviewCursor, reviewCursor]);

  const skipCurrent = useCallback(() => {
    if (!currentReview) return;
    patchRewriteResult(currentReview.id, { status: 'skipped', reason: t('batchImport_manualSkip') });
    setReviewCursor(reviewCursor + 1);
  }, [currentReview, patchRewriteResult, reviewCursor, setReviewCursor, t]);

  const resetWorkflow = useCallback(() => {
    if (isBusy) return;
    reset();
    setLocalError(null);
  }, [isBusy, reset]);

  const stats = useMemo(() => {
    const totalBlocks = coarseBlocks.length;
    const segmented = detailedCandidates.reduce((acc, candidate) => {
      acc.add(candidate.blockId);
      return acc;
    }, new Set<string>());
    const converted = rewriteResults.filter((rewrite) => rewrite.status === 'converted');
    return {
      totalBlocks,
      segmentedBlocks: segmented.size,
      converted: converted.length
    };
  }, [coarseBlocks, detailedCandidates, rewriteResults]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div className="label" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>{t('batchImport_title')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => fileInputRef.current?.click()} disabled={isBusy}>{t('batchImport_selectPdf')}</button>
          <button onClick={resetWorkflow} disabled={isBusy}>{t('batchImport_reset')}</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={onUploadPdf}
          />
        </div>
      </div>

      {pdfMeta && (
        <div className="small" style={{ color: 'var(--text-muted)' }}>
          {t('batchImport_fileSummary', { name: pdfMeta.name, pages: pdfMeta.pageCount })}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="label" style={{ margin: 0 }}>{t('batchImport_settings')}</div>
          <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {t('batchImport_concurrency')}
            <input
              type="number"
              min={1}
              max={10}
              value={settings.concurrency}
              onChange={(e) => setSettings({ concurrency: Number(e.target.value) })}
              disabled={isBusy}
            />
          </label>
          <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {t('batchImport_topK')}
            <input
              type="number"
              min={1}
              max={5}
              value={settings.topK}
              onChange={(e) => setSettings({ topK: Number(e.target.value) })}
              disabled={isBusy}
            />
          </label>
          <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {t('batchImport_minConfidence')}
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={settings.minConfidence.toFixed(2)}
              onChange={(e) => setSettings({ minConfidence: Number(e.target.value) })}
              disabled={isBusy}
            />
          </label>
        </div>

        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="label" style={{ margin: 0 }}>{t('batchImport_progress')}</div>
          <div className="small">{t('batchImport_blocksDetected', { value: stats.totalBlocks })}</div>
          <div className="small">{t('batchImport_blocksSegmented', { value: stats.segmentedBlocks })}</div>
          <div className="small">{t('batchImport_converted', { value: stats.converted })}</div>
          <div className="small">{t('batchImport_statusCoarse', { status: t(`batchImport_status_${stepStatus.coarse}`) })}</div>
          <div className="small">{t('batchImport_statusDetailed', { status: t(`batchImport_status_${stepStatus.detailed}`) })}</div>
          <div className="small">{t('batchImport_statusRewrite', { status: t(`batchImport_status_${stepStatus.rewrite}`) })}</div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button onClick={runSegmentation} disabled={isBusy || !coarseBlocks.length}>{t('batchImport_runSegmentation')}</button>
        <button onClick={runRewrite} disabled={isBusy || !detailedCandidates.length}>{t('batchImport_runRewrite')}</button>
        <button onClick={exportCoarse} disabled={!coarseBlocks.length}>{t('batchImport_exportCoarse')}</button>
        <button onClick={exportDetailed} disabled={!detailedCandidates.length}>{t('batchImport_exportDetailed')}</button>
        <button onClick={exportRewrites} disabled={!rewriteResults.length}>{t('batchImport_exportRewrites')}</button>
      </div>

      {(error || localError) && (
        <div className="small" style={{ color: '#f87171' }}>{error || localError}</div>
      )}

      {rewriteResults.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div className="label" style={{ margin: 0 }}>{t('batchImport_reviewTitle')}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setReviewCursor(Math.max(0, reviewCursor - 1))} disabled={reviewCursor === 0}>{t('prev')}</button>
              <button onClick={() => setReviewCursor(Math.min(rewriteResults.length - 1, reviewCursor + 1))}>{t('next')}</button>
              <span className="small">{t('batchImport_reviewPosition', { index: reviewCursor + 1, total: rewriteResults.length })}</span>
            </div>
          </div>

          {currentReview ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="label" style={{ margin: 0 }}>{t('batchImport_original')}</div>
                <div className="small" style={{ color: 'var(--text-muted)' }}>
                  {t('batchImport_blockInfo', { page: blocksById.get(currentReview.blockId)?.pageNumber || '-', block: currentReview.blockId })}
                </div>
                {currentCandidates.length > 0 ? currentCandidates.map((candidate) => (
                  <div key={candidate.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: 'var(--surface-subtle)' }}>
                    <div className="small" style={{ fontWeight: 600 }}>{candidate.id}</div>
                    <div className="small" style={{ color: 'var(--text-muted)' }}>{candidate.classification} · {(candidate.confidence * 100).toFixed(0)}%</div>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0 0', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem' }}>{candidate.text}</pre>
                  </div>
                )) : (
                  <span className="small" style={{ color: 'var(--text-muted)' }}>{t('batchImport_noCandidateText')}</span>
                )}
              </div>

              <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="label" style={{ margin: 0 }}>{t('batchImport_convertedPreview')}</div>
                <div className="small" style={{ color: 'var(--text-muted)' }}>{t('batchImport_selectedCandidate', { id: currentReview.chosenCandidateId || t('batchImport_none') })}</div>
                {currentReview.status === 'converted' && currentReview.patch ? (
                  <>
                    <div className="small" style={{ fontWeight: 600 }}>{t('batchImport_question')}</div>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem' }}>{currentReview.patch.question}</pre>
                    <div className="small" style={{ fontWeight: 600 }}>{t('batchImport_options')}</div>
                    <ol style={{ margin: 0, paddingLeft: 20 }}>
                      {(currentReview.patch.options || []).map((option, index) => (
                        <li key={index} style={{ marginBottom: 4 }}>{option}</li>
                      ))}
                    </ol>
                    <div className="small" style={{ fontWeight: 600 }}>{t('batchImport_answer')}</div>
                    <span className="small">{currentReview.patch.answer}</span>
                    <div className="small" style={{ fontWeight: 600 }}>{t('batchImport_metadata')}</div>
                    <span className="small">{t('subfield')}: {currentReview.patch.subfield}</span>
                    <span className="small">{t('academic')}: {currentReview.patch.academicLevel}</span>
                    <span className="small">{t('difficulty')}: {currentReview.patch.difficulty}</span>
                  </>
                ) : (
                  <span className="small" style={{ color: '#f87171' }}>{currentReview.reason || currentReview.message || t('batchImport_unavailable')}</span>
                )}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <button
                    onClick={acceptCurrent}
                    disabled={currentReview.status !== 'converted' || currentReview.accepted}
                    className="primary"
                  >
                    {currentReview.accepted ? t('batchImport_accepted') : t('batchImport_accept')}
                  </button>
                  <button onClick={skipCurrent}>{t('batchImport_skip')}</button>
                </div>
              </div>
            </div>
          ) : (
            <span className="small" style={{ color: 'var(--text-muted)' }}>{t('batchImport_reviewEmpty')}</span>
          )}
        </div>
      )}
    </div>
  );
}
