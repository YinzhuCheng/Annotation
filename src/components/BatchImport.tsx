import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../state/store';
import { useImportStore } from '../state/importStore';
import { extractCoarseBlocksFromPdf, analyzeCoarseBlockWithLLM, rewriteCandidatesWithLLM } from '../lib/pdfPipeline';
import { ocrWithLLM, translateWithLLM } from '../lib/llmAdapter';
import { asyncPool } from '../lib/asyncPool';
import { downloadBlob } from '../lib/storage';
import type { DetailedCandidate, RewriteResult, RewriteStatus, QualityReport } from '../state/importStore';
import type { ProblemRecord } from '../state/store';

async function ensureMathJaxReady() {
  const mj = (window as any).MathJax;
  if (!mj) throw new Error('MathJax not ready');
  if (mj.startup?.promise) {
    await mj.startup.promise;
  }
  if (typeof mj.typesetPromise !== 'function') {
    throw new Error('MathJax typeset unavailable');
  }
  return mj;
}

export function BatchImport() {
  const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const segmentationImportRef = useRef<HTMLInputElement>(null);
    const rewriteImportRef = useRef<HTMLInputElement>(null);
  const { llmAgents, defaults } = useAppStore();
  const getAppState = useAppStore;
    const {
      pdfMeta,
      pages,
      coarseBlocks,
      detailedCandidates,
      rewriteResults,
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
        setDetailedCandidatesBulk,
        setRewriteResults,
      upsertRewriteResult,
      patchRewriteResult,
      markAccepted,
      setStepStatus,
      setError,
      setBusy
    } = useImportStore();

    const [localError, setLocalError] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [reviewIndex, setReviewIndex] = useState(0);

    const MathJaxPreviewBlock = ({ text, placeholder }: { text: string; placeholder: string }) => {
      const containerRef = useRef<HTMLDivElement>(null);
      const [renderError, setRenderError] = useState<string | null>(null);

      useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const source = text?.trim();
        if (!source) {
          el.innerText = placeholder;
          setRenderError(null);
          return;
        }
        let cancelled = false;
        el.innerHTML = '';
        el.textContent = source;
        (async () => {
          try {
            const mj = await ensureMathJaxReady();
            if (cancelled) return;
            await mj.typesetPromise([el]);
            if (cancelled) return;
            setRenderError(null);
          } catch (error: any) {
            if (cancelled) return;
            setRenderError(error?.message ? String(error.message) : String(error));
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [text, placeholder]);

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div ref={containerRef} style={{ whiteSpace: 'pre-wrap' }} />
          {renderError && (
            <span className="small" style={{ color: '#f87171' }}>{t('mathJaxPreviewError', { error: renderError })}</span>
          )}
        </div>
      );
    };

    const generatorAgent = llmAgents.generator;
    const ocrAgent = llmAgents.ocr;
    const translatorAgent = llmAgents.translator;

  const dataUrlToBlob = useCallback(async (url: string): Promise<Blob> => {
    const response = await fetch(url);
    return await response.blob();
  }, []);

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

    const reviewList = useMemo(() => rewriteResults.filter((item) => item.status !== 'skipped'), [rewriteResults]);
    const currentReview = reviewList[reviewIndex] ?? null;
    const currentCandidate = useMemo(() => {
      if (!currentReview) return null;
      if (!currentReview.chosenCandidateId) return null;
      return detailedCandidates.find((candidate) => candidate.id === currentReview.chosenCandidateId) || null;
    }, [currentReview, detailedCandidates]);

    useEffect(() => {
      if (reviewIndex >= reviewList.length) {
        setReviewIndex(reviewList.length > 0 ? reviewList.length - 1 : 0);
      }
      if (reviewIndex < 0 && reviewList.length > 0) {
        setReviewIndex(0);
      }
    }, [reviewIndex, reviewList.length]);

  const ensureGeneratorAgent = useCallback((): boolean => {
    const cfg = generatorAgent?.config;
    if (!cfg?.apiKey?.trim() || !cfg?.model?.trim() || !cfg?.baseUrl?.trim()) {
      alert(t('llmMissingBody', { agent: t('agentGenerator') }));
      return false;
    }
    return true;
  }, [generatorAgent?.config, t]);

  const ensureOcrAgent = useCallback((): boolean => {
    const cfg = ocrAgent?.config;
    if (!cfg?.apiKey?.trim() || !cfg?.model?.trim() || !cfg?.baseUrl?.trim()) {
      alert(t('llmMissingBody', { agent: t('agentOcr') }));
      return false;
    }
    return true;
  }, [ocrAgent?.config, t]);

  const ensureTranslatorAgent = useCallback((): boolean => {
    const cfg = translatorAgent?.config;
    if (!cfg?.apiKey?.trim() || !cfg?.model?.trim() || !cfg?.baseUrl?.trim()) {
      alert(t('llmMissingBody', { agent: t('agentTranslator') }));
      return false;
    }
    return true;
  }, [translatorAgent?.config, t]);

  const importDetailedFromFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.candidates)
          ? parsed.candidates
          : [];
      if (!Array.isArray(payload) || payload.length === 0) {
        alert(t('batchImport_importEmpty'));
        return;
      }
      const normalized: DetailedCandidate[] = payload
        .map((item: any, index: number) => {
          const id = typeof item?.id === 'string' && item.id.trim().length > 0 ? item.id.trim() : `import-${Date.now()}-${index}`;
          const blockId = typeof item?.blockId === 'string' ? item.blockId : '';
          const pageId = typeof item?.pageId === 'string' ? item.pageId : '';
          const pageNumber = Number.isFinite(item?.pageNumber) ? Number(item.pageNumber) : 0;
          const text = typeof item?.text === 'string' ? item.text : '';
          if (!blockId || !text.trim()) return null;
          const confidenceRaw = Number(item?.confidence);
          const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0.5;
          return {
            id,
            blockId,
            pageId,
            pageNumber,
            index: Number.isFinite(item?.index) ? Number(item.index) : index,
            text,
            classification: typeof item?.classification === 'string' ? item.classification : 'unspecified',
            hasImage: Boolean(item?.hasImage),
            confidence,
            skipReason: typeof item?.skipReason === 'string' ? item.skipReason : undefined,
            notes: typeof item?.notes === 'string' ? item.notes : undefined
          } as DetailedCandidate;
        })
        .filter((candidate): candidate is DetailedCandidate => candidate !== null);

      if (normalized.length === 0) {
        alert(t('batchImport_importEmpty'));
        return;
      }

      setDetailedCandidatesBulk(normalized);
      normalized.forEach((candidate) => {
        patchCoarseBlock(candidate.blockId, { status: 'completed' });
      });
      setStepStatus('detailed', 'completed');
      setLocalError(null);
      setReviewIndex(0);
    } catch (error: any) {
      alert(t('batchImport_importFailed', { error: String(error?.message || error) }));
    }
  }, [patchCoarseBlock, setDetailedCandidatesBulk, setLocalError, setStepStatus, t]);

  const importRewritesFromFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rewrites)
          ? parsed.rewrites
          : [];
      if (!Array.isArray(payload) || payload.length === 0) {
        alert(t('batchImport_importEmpty'));
        return;
      }
      const normalized: RewriteResult[] = payload
        .map((item: any, index: number) => {
          const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `rewrite-${Date.now()}-${index}`;
          const blockId = typeof item?.blockId === 'string' ? item.blockId : '';
          const pageId = typeof item?.pageId === 'string' ? item.pageId : '';
          if (!blockId) return null;
          const candidateIds = Array.isArray(item?.candidateIds)
            ? item.candidateIds.filter((id: any) => typeof id === 'string')
            : [];
          const status: RewriteStatus = item?.status === 'converted' || item?.status === 'processing' || item?.status === 'error'
            ? item.status
            : 'skipped';
          const patch = item?.patch && typeof item.patch === 'object' ? item.patch as Partial<ProblemRecord> : undefined;
          const qualityRaw = item?.qualityReport;
          const qualityReport: QualityReport | undefined = qualityRaw && typeof qualityRaw === 'object'
            ? {
                difficulty: String(qualityRaw.difficulty ?? ''),
                selfContainment: Boolean(qualityRaw.selfContainment),
                noLeakage: Boolean(qualityRaw.noLeakage),
                singleAnswer: Boolean(qualityRaw.singleAnswer),
                quantitative: Boolean(qualityRaw.quantitative),
                overall: qualityRaw.overall === 'pass' ? 'pass' : 'fail',
                notes: typeof qualityRaw.notes === 'string' ? qualityRaw.notes : undefined
              }
            : undefined;
          return {
            id,
            blockId,
            pageId,
            candidateIds,
            chosenCandidateId: typeof item?.chosenCandidateId === 'string' ? item.chosenCandidateId : null,
            status,
            patch,
            raw: typeof item?.raw === 'string' ? item.raw : '',
            reason: typeof item?.reason === 'string' ? item.reason : undefined,
            message: typeof item?.message === 'string' ? item.message : undefined,
            accepted: Boolean(item?.accepted),
            createdAt: Number.isFinite(item?.createdAt) ? Number(item.createdAt) : Date.now(),
            qualityReport,
            editedProblemId: typeof item?.editedProblemId === 'string' ? item.editedProblemId : undefined
          } as RewriteResult;
        })
        .filter((entry): entry is RewriteResult => entry !== null);

      if (normalized.length === 0) {
        alert(t('batchImport_importEmpty'));
        return;
      }

      setRewriteResults(normalized);
      setStepStatus('rewrite', 'completed');
      setLocalError(null);
      setReviewIndex(0);
    } catch (error: any) {
      alert(t('batchImport_importFailed', { error: String(error?.message || error) }));
    }
  }, [setLocalError, setRewriteResults, setStepStatus, t]);

  const translateProblemToEnglish = useCallback(async (patch: Partial<ProblemRecord>) => {
    if (!translatorAgent) return patch;
    const translated: Partial<ProblemRecord> = { ...patch };
    try {
      if (typeof patch.question === 'string' && patch.question.trim().length > 0) {
        translated.question = (await translateWithLLM(patch.question, 'en', translatorAgent)).trim();
      }
      if (Array.isArray(patch.options)) {
        const translatedOptions = await Promise.all(
          patch.options.map(async (option) => {
            if (typeof option === 'string' && option.trim().length > 0) {
              return (await translateWithLLM(option, 'en', translatorAgent)).trim();
            }
            return option;
          })
        );
        translated.options = translatedOptions;
      }
      if (typeof patch.answer === 'string' && patch.answer.trim().length > 0 && !/^[A-Z]$/.test(patch.answer.trim())) {
        translated.answer = (await translateWithLLM(patch.answer, 'en', translatorAgent)).trim();
      }
    } catch (error) {
      throw error;
    }
    return translated;
  }, [translatorAgent]);

  const handleSegmentationImportChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void importDetailedFromFile(file);
    }
    event.target.value = '';
  }, [importDetailedFromFile]);

  const handleRewriteImportChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void importRewritesFromFile(file);
    }
    event.target.value = '';
  }, [importRewritesFromFile]);

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
      if (pending.length === 0) {
        setLocalError(t('batchImport_noPendingSegmentation'));
        setStepStatus('detailed', 'idle');
        setBusy(false);
        return;
      }
      let hadError = false;
      await asyncPool(pending, settings.concurrency, async (block) => {
        patchCoarseBlock(block.id, { status: 'processing', errorMessage: undefined });
        try {
          let preparedText = block.text?.trim() ?? '';

          if (!preparedText && block.requiresOcr && block.sourceImage) {
            if (!ensureOcrAgent()) {
              throw new Error(t('batchImport_ocrMissing'));
            }
            const blob = await dataUrlToBlob(block.sourceImage);
            preparedText = (await ocrWithLLM(blob, ocrAgent)).trim();
            patchCoarseBlock(block.id, {
              text: preparedText,
              extractedText: preparedText,
              requiresOcr: false
            });
          }

          if (!preparedText) {
            patchCoarseBlock(block.id, {
              status: 'skipped',
              skipReason: t('batchImport_skipEmpty'),
              errorMessage: undefined
            });
            return;
          }

          const candidates = await analyzeCoarseBlockWithLLM({ ...block, text: preparedText }, generatorAgent, { minConfidence: settings.minConfidence });
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
        setLocalError(t('batchImport_segmentationPartial'));
      }
    } catch (err: any) {
      const message = err?.message ? String(err.message) : String(err);
      setError(message);
      setLocalError(message);
      setStepStatus('detailed', 'error');
    } finally {
      setBusy(false);
    }
    }, [ensureGeneratorAgent, ensureOcrAgent, coarseBlocks, t, settings.concurrency, settings.minConfidence, patchCoarseBlock, upsertDetailedCandidates, generatorAgent, ocrAgent, dataUrlToBlob, setBusy, setStepStatus, setError, setLocalError]);

    const runRewrite = useCallback(async () => {
      if (!ensureGeneratorAgent()) return;
      if (!ensureTranslatorAgent()) return;
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
      if (tasks.length === 0) {
        setLocalError(t('batchImport_noPendingRewrite'));
        setStepStatus('rewrite', 'idle');
        setBusy(false);
        return;
      }
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
            let finalPatch = outcome.patch;
            if (outcome.status === 'converted' && outcome.patch) {
              try {
                finalPatch = await translateProblemToEnglish(outcome.patch);
              } catch (translationError: any) {
                setLocalError(t('batchImport_translationFailed', { error: String(translationError?.message || translationError) }));
                hadError = true;
              }
            }
          upsertRewriteResult({
            id: rewriteId,
            blockId: block.id,
            pageId: block.pageId,
            candidateIds: candidates.map((c) => c.id),
            chosenCandidateId: outcome.chosenCandidateId,
            status: outcome.status === 'converted' ? 'converted' : outcome.status,
            raw: outcome.raw,
              patch: outcome.status === 'converted' ? finalPatch : undefined,
            reason: outcome.reason,
            message: outcome.message,
              createdAt: Date.now(),
              qualityReport: outcome.qualityReport
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
    }, [ensureGeneratorAgent, ensureTranslatorAgent, detailedCandidates.length, t, coarseBlocks, candidatesByBlock, settings.concurrency, settings.topK, generatorAgent, defaults, upsertRewriteResult, setBusy, setStepStatus, setError, translateProblemToEnglish, setLocalError]);

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
    const baseId = currentReview.editedProblemId || `${Date.now()}`;
    const state = getAppState.getState();
    state.upsertProblem({
      id: baseId,
      ...currentReview.patch,
      source: pdfMeta ? `${pdfMeta.name} (Batch Import)` : 'Batch Import',
      image: '',
      imageDependency: 0
    });
    markAccepted(currentReview.id);
    patchRewriteResult(currentReview.id, { editedProblemId: baseId });
    setReviewIndex((prev) => (prev + 1 < reviewList.length ? prev + 1 : prev));
  }, [currentReview, getAppState, pdfMeta, markAccepted, patchRewriteResult, reviewList.length]);

  const skipCurrent = useCallback(() => {
    if (!currentReview) return;
    patchRewriteResult(currentReview.id, { status: 'skipped', reason: t('batchImport_manualSkip') });
    setReviewIndex((prev) => (prev >= reviewList.length - 1 ? Math.max(0, prev - 1) : prev));
  }, [currentReview, patchRewriteResult, reviewList.length, t]);

  const handleEditCurrent = useCallback(() => {
    if (!currentReview || !currentReview.patch) return;
    const baseId = currentReview.editedProblemId || `${Date.now()}`;
    const state = getAppState.getState();
    state.upsertProblem({
      id: baseId,
      ...currentReview.patch,
      source: pdfMeta ? `${pdfMeta.name} (Batch Import)` : 'Batch Import',
      image: '',
      imageDependency: 0
    });
    patchRewriteResult(currentReview.id, { editedProblemId: baseId });
  }, [currentReview, getAppState, pdfMeta, patchRewriteResult]);

  const resetWorkflow = useCallback(() => {
    if (isBusy) return;
    reset();
    setLocalError(null);
  }, [isBusy, reset]);

  const segmentationStats = useMemo(() => {
    const total = coarseBlocks.length;
    const completed = coarseBlocks.filter((block) => block.status === 'completed').length;
    const skipped = coarseBlocks.filter((block) => block.status === 'skipped').length;
    const errors = coarseBlocks.filter((block) => block.status === 'error').length;
    const processing = coarseBlocks.filter((block) => block.status === 'processing').length;
    return {
      total,
      completed,
      skipped,
      errors,
      processing,
      done: completed + skipped + errors
    };
  }, [coarseBlocks]);

  const rewriteStats = useMemo(() => {
    const total = rewriteResults.length;
    const converted = rewriteResults.filter((rewrite) => rewrite.status === 'converted').length;
    const skipped = rewriteResults.filter((rewrite) => rewrite.status === 'skipped').length;
    const errors = rewriteResults.filter((rewrite) => rewrite.status === 'error').length;
    const processing = rewriteResults.filter((rewrite) => rewrite.status === 'processing').length;
    return {
      total,
      converted,
      skipped,
      errors,
      processing,
      done: converted + skipped + errors
    };
  }, [rewriteResults]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div className="label" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>{t('batchImport_title')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setCollapsed((prev) => !prev)}>{collapsed ? t('batchImport_expand') : t('batchImport_collapse')}</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={isBusy}>{t('batchImport_selectPdf')}</button>
          <button onClick={resetWorkflow} disabled={isBusy}>{t('batchImport_reset')}</button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={onUploadPdf}
      />
      <input
        ref={segmentationImportRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={handleSegmentationImportChange}
      />
      <input
        ref={rewriteImportRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={handleRewriteImportChange}
      />

      {!collapsed && (
        <>
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
              <div className="small">{t('batchImport_statusCoarse', { status: t(`batchImport_status_${stepStatus.coarse}`) })}</div>
              <div className="small">{t('batchImport_statusDetailed', { status: t(`batchImport_status_${stepStatus.detailed}`) })}</div>
              <div className="small">{t('batchImport_statusRewrite', { status: t(`batchImport_status_${stepStatus.rewrite}`) })}</div>
              <div className="small">{t('batchImport_progressSegmentation', {
                done: segmentationStats.done,
                total: segmentationStats.total,
                processing: segmentationStats.processing,
                errors: segmentationStats.errors
              })}</div>
              <div className="small">{t('batchImport_progressRewrite', {
                done: rewriteStats.done,
                total: rewriteStats.total,
                processing: rewriteStats.processing,
                errors: rewriteStats.errors
              })}</div>
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button onClick={runSegmentation} disabled={isBusy || !coarseBlocks.length}>{t('batchImport_runSegmentation')}</button>
            <button onClick={runRewrite} disabled={isBusy || !detailedCandidates.length}>{t('batchImport_runRewrite')}</button>
            <button onClick={() => segmentationImportRef.current?.click()} disabled={isBusy}>{t('batchImport_importDetailed')}</button>
            <button onClick={() => rewriteImportRef.current?.click()} disabled={isBusy}>{t('batchImport_importRewrites')}</button>
            <button onClick={exportDetailed} disabled={!detailedCandidates.length}>{t('batchImport_exportDetailed')}</button>
            <button onClick={exportRewrites} disabled={!rewriteResults.length}>{t('batchImport_exportRewrites')}</button>
          </div>

          {(error || localError) && (
            <div className="small" style={{ color: '#f87171' }}>{error || localError}</div>
          )}

          <div className="grid" style={{ gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
              <div className="label" style={{ margin: 0 }}>{t('batchImport_segmentationHeading')}</div>
              {detailedCandidates.length === 0 ? (
                <span className="small" style={{ color: 'var(--text-muted)' }}>{t('batchImport_noSegmentation')}</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                  {detailedCandidates.map((candidate) => {
                    const preview = candidate.text.length > 240 ? `${candidate.text.slice(0, 240)}…` : candidate.text;
                    return (
                      <div key={candidate.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: 'var(--surface-subtle)' }}>
                        <div className="small" style={{ fontWeight: 600 }}>
                          {t('batchImport_candidateMeta', {
                            page: candidate.pageNumber,
                            block: candidate.blockId,
                            confidence: Math.round(candidate.confidence * 100)
                          })}
                        </div>
                        <div className="small" style={{ color: 'var(--text-muted)' }}>{candidate.classification}</div>
                        <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0 0', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem' }}>{preview}</pre>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
              <div className="label" style={{ margin: 0 }}>{t('batchImport_rewriteHeading')}</div>
              {rewriteResults.length === 0 ? (
                <span className="small" style={{ color: 'var(--text-muted)' }}>{t('batchImport_noRewrite')}</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                  {rewriteResults.map((rewrite) => {
                    const questionPreview = rewrite.patch?.question ? rewrite.patch.question.slice(0, 200) : '';
                    return (
                      <div key={rewrite.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: 'var(--surface-subtle)' }}>
                        <div className="small" style={{ fontWeight: 600 }}>
                          {t('batchImport_problemMeta', {
                            candidate: rewrite.chosenCandidateId || t('batchImport_none'),
                            status: rewrite.status
                          })}
                        </div>
                        {questionPreview ? (
                          <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0 0', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem' }}>
                            {questionPreview}
                            {rewrite.patch?.question && rewrite.patch.question.length > 200 ? '…' : ''}
                          </pre>
                        ) : (
                          <span className="small" style={{ color: rewrite.status === 'error' ? '#f87171' : 'var(--text-muted)' }}>{rewrite.reason || rewrite.message || t('batchImport_unavailable')}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {reviewList.length > 0 && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div className="label" style={{ margin: 0 }}>{t('batchImport_reviewTitle')}</div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => setReviewIndex((prev) => Math.max(0, prev - 1))} disabled={reviewIndex === 0}>{t('prev')}</button>
                  <button onClick={() => setReviewIndex((prev) => Math.min(reviewList.length - 1, prev + 1))} disabled={reviewIndex >= reviewList.length - 1}>{t('next')}</button>
                  <span className="small">{t('batchImport_reviewPosition', { index: reviewIndex + 1, total: reviewList.length })}</span>
                </div>
              </div>

              {currentReview ? (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                  <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="label" style={{ margin: 0 }}>{t('batchImport_original')}</div>
                    <div className="small" style={{ color: 'var(--text-muted)' }}>
                      {t('batchImport_blockInfo', { page: blocksById.get(currentReview.blockId)?.pageNumber || '-', block: currentReview.blockId })}
                    </div>
                    <MathJaxPreviewBlock
                      text={currentCandidate?.text || blocksById.get(currentReview.blockId)?.text || ''}
                      placeholder={t('batchImport_noCandidateText')}
                    />
                  </div>

                  <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="label" style={{ margin: 0 }}>{t('batchImport_convertedPreview')}</div>
                    <div className="small" style={{ color: 'var(--text-muted)' }}>{t('batchImport_selectedCandidate', { id: currentReview.chosenCandidateId || t('batchImport_none') })}</div>
                    {currentReview.status === 'converted' && currentReview.patch ? (
                      <>
                        <div className="small" style={{ fontWeight: 600 }}>{t('batchImport_question')}</div>
                        <MathJaxPreviewBlock text={currentReview.patch.question || ''} placeholder={t('batchImport_unavailable')} />
                        <div className="small" style={{ fontWeight: 600 }}>{t('batchImport_options')}</div>
                        <ol style={{ margin: 0, paddingLeft: 20 }}>
                          {(currentReview.patch.options || []).map((option, index) => (
                            <li key={index} style={{ marginBottom: 4 }}>
                              <MathJaxPreviewBlock text={option || ''} placeholder={t('batchImport_unavailable')} />
                            </li>
                          ))}
                        </ol>
                        <div className="small" style={{ fontWeight: 600 }}>{t('batchImport_answer')}</div>
                        <MathJaxPreviewBlock text={currentReview.patch.answer || ''} placeholder={t('batchImport_unavailable')} />
                        <div className="small" style={{ fontWeight: 600 }}>{t('batchImport_metadata')}</div>
                        <span className="small">{t('subfield')}: {currentReview.patch.subfield}</span>
                        <span className="small">{t('academic')}: {currentReview.patch.academicLevel}</span>
                        <span className="small">{t('difficulty')}: {currentReview.patch.difficulty}</span>
                        {currentReview.qualityReport && (
                          <div className="small" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span>{t('batchImport_qualityDifficultyLabel', { value: currentReview.qualityReport.difficulty || '-' })}</span>
                            <span>{t('batchImport_qualityBoolean', { label: t('batchImport_qualitySelfContainment'), value: currentReview.qualityReport.selfContainment ? t('batchImport_qualityYes') : t('batchImport_qualityNo') })}</span>
                            <span>{t('batchImport_qualityBoolean', { label: t('batchImport_qualityNoLeakage'), value: currentReview.qualityReport.noLeakage ? t('batchImport_qualityYes') : t('batchImport_qualityNo') })}</span>
                            <span>{t('batchImport_qualityBoolean', { label: t('batchImport_qualitySingleAnswer'), value: currentReview.qualityReport.singleAnswer ? t('batchImport_qualityYes') : t('batchImport_qualityNo') })}</span>
                            <span>{t('batchImport_qualityBoolean', { label: t('batchImport_qualityQuantitative'), value: currentReview.qualityReport.quantitative ? t('batchImport_qualityYes') : t('batchImport_qualityNo') })}</span>
                            <span>{currentReview.qualityReport.overall === 'pass' ? t('batchImport_qualityOverallPass') : t('batchImport_qualityOverallFail')}</span>
                            {currentReview.qualityReport.notes && (
                              <span>{t('batchImport_qualityNotes', { notes: currentReview.qualityReport.notes })}</span>
                            )}
                          </div>
                        )}
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
                      <button onClick={handleEditCurrent} disabled={currentReview.status !== 'converted'}>{t('batchImport_edit')}</button>
                      <button onClick={skipCurrent}>{t('batchImport_skip')}</button>
                    </div>
                  </div>
                </div>
              ) : (
                <span className="small" style={{ color: 'var(--text-muted)' }}>{t('batchImport_reviewEmpty')}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
