import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, ProblemRecord, AgentId } from '../state/store';
import { latexCorrection, ocrWithLLM, translateWithLLM } from '../lib/llmAdapter';
import { getImageBlob } from '../lib/db';
import { openViewerWindow } from '../lib/viewer';
import { generateProblemFromText, GeneratorConversationTurn, LLMGenerationError } from '../lib/generator';

type GeneratorTurnState = GeneratorConversationTurn & { patch: Partial<ProblemRecord>; timestamp: number };

export function ProblemEditor({ onOpenClear }: { onOpenClear?: () => void }) {
  const { t } = useTranslation();
  const store = useAppStore();
  const defaults = useAppStore((s)=> s.defaults);
  const agents = useAppStore((s)=> s.llmAgents);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const current = useMemo(() => store.problems.find(p => p.id === store.currentId)!, [store.problems, store.currentId]);
  const currentIndex = useMemo(() => store.problems.findIndex(p => p.id === store.currentId), [store.problems, store.currentId]);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0; // enable Next; will create new at tail if needed
  const commitCurrent = () => {
    // Touch-save current problem so edits are persisted before navigation
    store.upsertProblem({ id: current.id });
    setSavedAt(Date.now());
  };
  const goPrev = () => {
    if (!hasPrev) return;
    commitCurrent();
    store.upsertProblem({ id: store.problems[currentIndex - 1].id });
  };
  const goNext = () => {
    if (!hasNext) return;
    if (!ensureRequiredBeforeProceed()) return;
    commitCurrent();
    const isLast = currentIndex === store.problems.length - 1;
    if (isLast) {
      const newId = `${Date.now()}`;
      store.upsertProblem({ id: newId }); // creates a new problem at the tail and jumps to it
    } else {
      store.upsertProblem({ id: store.problems[currentIndex + 1].id });
    }
  };
  const [ocrText, setOcrText] = useState('');
  const [ocrImage, setOcrImage] = useState<Blob | null>(null);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string>('');
  const [confirmedImageUrl, setConfirmedImageUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const customSubfieldInputRef = useRef<HTMLInputElement>(null);
  const customSourceInputRef = useRef<HTMLInputElement>(null);
  const latexPreviewRef = useRef<HTMLDivElement>(null);
  const questionPreviewRef = useRef<HTMLDivElement>(null);
  const answerPreviewRef = useRef<HTMLDivElement>(null);
  const previewMathJaxRef = useRef<HTMLDivElement>(null);
  const [llmStatus, setLlmStatus] = useState<'idle'|'waiting_response'|'thinking'|'responding'|'done'>('idle');
  const [llmStatusSource, setLlmStatusSource] = useState<null | 'generate' | 'latex_question' | 'latex_answer' | 'latex_preview' | 'ocr'>(null);
  const [dots, setDots] = useState(1);
  const [translationInput, setTranslationInput] = useState('');
  const [translationOutput, setTranslationOutput] = useState('');
  const [translationStatus, setTranslationStatus] = useState<'idle'|'waiting_response'|'thinking'|'responding'|'done'>('idle');
  const [translationTarget, setTranslationTarget] = useState<'en' | 'zh'>('zh');
  const [translationError, setTranslationError] = useState('');
  const [generatorPreview, setGeneratorPreview] = useState('');
  const [generatorHistory, setGeneratorHistory] = useState<GeneratorTurnState[]>([]);
  const [latestFeedback, setLatestFeedback] = useState('');
  const [feedbackSavedAt, setFeedbackSavedAt] = useState<number | null>(null);
  const [latexInput, setLatexInput] = useState('');
  const [latexRenderError, setLatexRenderError] = useState('');
  const [latexErrors, setLatexErrors] = useState<string[]>([]);
  const [questionMathJaxError, setQuestionMathJaxError] = useState('');
  const [answerMathJaxError, setAnswerMathJaxError] = useState('');
  const [previewMathJaxError, setPreviewMathJaxError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const agentDisplay = useMemo<Record<AgentId, string>>(() => ({
    ocr: t('agentOcr'),
    latex: t('agentLatex'),
    generator: t('agentGenerator'),
    translator: t('agentTranslator')
  }), [t]);
  const CUSTOM_OPTION = '__custom__';

  const ensureMathJaxReady = async () => {
    const mj = (window as any).MathJax;
    if (!mj) {
      throw new Error(t('assistToolLatexLoading'));
    }
    if (mj.startup?.promise) {
      await mj.startup.promise;
    }
    if (typeof mj.typesetPromise !== 'function') {
      throw new Error(t('assistToolLatexUnavailable'));
    }
    return mj;
  };

  const composeLatexCorrectionInput = (snippet: string, reportLines?: string[], contextLabel?: string) => {
    const lines: string[] = [];
    lines.push('MathJax rendering is used in our application.');
    lines.push('This may be an iterative session. Carry forward all previous improvements and integrate any feedback provided below.');
    if (contextLabel) {
      lines.push(`Context: ${contextLabel}`);
    }
    lines.push('MathJax render report:');
    if (reportLines && reportLines.length > 0) {
      reportLines.forEach((line, idx) => {
        lines.push(`${idx + 1}. ${line}`);
      });
    } else {
      lines.push('No explicit parser errors were reported. Please still ensure MathJax compatibility.');
    }
    lines.push('---');
    lines.push('Original LaTeX snippet:');
    lines.push(snippet);
    return lines.join('\n');
  };

  const getOptionLabel = (idx: number) => String.fromCharCode(65 + idx);

  const getOptionCount = () => {
    if (current.questionType !== 'Multiple Choice') return 0;
    const existing = Array.isArray(current.options) ? current.options.length : 0;
    const configured = defaults.optionsCount || 5;
    const baseline = existing > 0 ? existing : configured;
    return Math.max(2, baseline);
  };

  const buildOptionsAnswerSnippet = (answerText: string, optionsOverride?: string[]): string => {
    const lines: string[] = [];
    if (current.questionType === 'Multiple Choice') {
      const optionCount = getOptionCount();
      const baseOptions = optionsOverride ?? current.options ?? [];
      const optionsList = Array.from({ length: optionCount }, (_, idx) => baseOptions[idx] ?? '');
      lines.push('Options:');
      optionsList.forEach((opt, idx) => {
        const label = getOptionLabel(idx);
        const body = (opt ?? '').trim();
        lines.push(body ? `${label}) ${body}` : `${label})`);
      });
      lines.push('');
    }
    lines.push('Answer:');
    lines.push(answerText ?? '');
    return lines.join('\n');
  };

  const parseOptionsAnswerSnippet = (input: string): { options: string[] | null; answer: string } => {
    const normalized = input.replace(/\r\n/g, '\n').trim();
    const answerLabelRegex = /(^|\n)\s*Answer\s*:\s*/i;
    const match = answerLabelRegex.exec(normalized);
    if (!match) {
      return { options: null, answer: normalized };
    }
    const answerStart = match.index + match[0].length;
    const answerText = normalized.slice(answerStart).trim();
    if (current.questionType !== 'Multiple Choice') {
      return { options: null, answer: answerText || normalized };
    }
    const optionsPartRaw = normalized.slice(0, match.index).replace(/^\s*Options\s*:\s*/i, '').trim();
    const optionCount = getOptionCount();
    const baseOptions = Array.from({ length: optionCount }, (_, idx) => current.options?.[idx] ?? '');
    if (!optionsPartRaw) {
      return { options: baseOptions.length > 0 ? baseOptions : null, answer: answerText };
    }
    const updated = baseOptions.map((opt) => opt ?? '');
    if (updated.length === 0) {
      return { options: null, answer: answerText };
    }
    const lines = optionsPartRaw.split('\n').map((line) => line.trim()).filter(Boolean);
    const assigned = new Set<number>();
    const assignOption = (index: number, value: string) => {
      if (index >= 0 && index < updated.length) {
        updated[index] = value.trim();
        assigned.add(index);
        return true;
      }
      return false;
    };
    for (const line of lines) {
      const labeled = line.match(/^([A-Z])[)\.\-:]\s*(.*)$/);
      if (labeled) {
        const idx = labeled[1].charCodeAt(0) - 65;
        const body = labeled[2].trim();
        if (assignOption(idx, body)) {
          continue;
        }
      }
      const nextIdx = updated.findIndex((_, idx) => !assigned.has(idx));
      if (nextIdx !== -1) {
        assignOption(nextIdx, line);
      }
    }
    return { options: updated, answer: answerText };
  };

  const hasOptionsOrAnswerContent = () => {
    const answerHasContent = Boolean(current.answer && current.answer.trim().length > 0);
    const optionsHasContent = current.questionType === 'Multiple Choice'
      && Array.isArray(current.options)
      && current.options.some((opt) => opt && opt.trim().length > 0);
    return answerHasContent || optionsHasContent;
  };

  useEffect(() => {
    if (!current) return;
    setTranslationInput(current.question || '');
    setTranslationOutput('');
    setTranslationError('');
    setTranslationStatus('idle');
  }, [current.id]);

  useEffect(() => {
    setGeneratorHistory([]);
    setGeneratorPreview('');
    setLatestFeedback('');
    setFeedbackSavedAt(null);
    setLatexInput('');
    setLatexRenderError('');
    setLatexErrors([]);
  }, [current.id]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const container = questionPreviewRef.current;
      if (!container) return;
      container.innerHTML = '';
      setQuestionMathJaxError('');
      const source = current.question?.trim() ?? '';
      if (!source) return;
      container.textContent = source;
      try {
        const mj = await ensureMathJaxReady();
        mj.texReset?.();
        await mj.typesetPromise([container]);
        if (cancelled) return;
        const errors = Array.from(container.querySelectorAll('mjx-merror'))
          .map((node) => node.getAttribute('data-mjx-error') || node.textContent?.trim() || '')
          .filter((text) => text.length > 0);
        if (errors.length > 0) {
          setQuestionMathJaxError(errors.join('; '));
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message ? String(error.message) : String(error);
        setQuestionMathJaxError(message);
      }
    };
    render();
    return () => { cancelled = true; };
  }, [current.question]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const container = answerPreviewRef.current;
      if (!container) return;
      container.innerHTML = '';
      setAnswerMathJaxError('');
      if (!hasOptionsOrAnswerContent()) {
        return;
      }
      const snippet = buildOptionsAnswerSnippet(current.answer ?? '');
      container.textContent = snippet;
      try {
        const mj = await ensureMathJaxReady();
        mj.texReset?.();
        await mj.typesetPromise([container]);
        if (cancelled) return;
        const errors = Array.from(container.querySelectorAll('mjx-merror'))
          .map((node) => node.getAttribute('data-mjx-error') || node.textContent?.trim() || '')
          .filter((text) => text.length > 0);
        if (errors.length > 0) {
          setAnswerMathJaxError(errors.join('; '));
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message ? String(error.message) : String(error);
        setAnswerMathJaxError(message);
      }
    };
    render();
    return () => { cancelled = true; };
  }, [current.answer, current.options, current.questionType, defaults.optionsCount]);

  useEffect(() => {
    if (!previewOpen) return;
    const container = previewMathJaxRef.current;
    if (!container) return;
    let cancelled = false;
    setPreviewMathJaxError('');
    container.innerHTML = '';
    container.textContent = previewSnippet;
    const run = async () => {
      try {
        const mj = await ensureMathJaxReady();
        if (cancelled) return;
        mj.texReset?.();
        await mj.typesetPromise([container]);
        if (cancelled) return;
        const errors = Array.from(container.querySelectorAll('mjx-merror'))
          .map((node) => node.getAttribute('data-mjx-error') || node.textContent?.trim() || '')
          .filter((text) => text.length > 0);
        if (errors.length > 0) {
          setPreviewMathJaxError(errors.join('; '));
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message ? String(error.message) : String(error);
        setPreviewMathJaxError(message);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [previewOpen, previewSnippet]);

  useEffect(() => {
    if (!previewOpen) {
      setPreviewMathJaxError('');
    }
  }, [previewOpen]);

  useEffect(() => {
    if (!feedbackSavedAt) return;
    const timer = setTimeout(() => setFeedbackSavedAt(null), 2000);
    return () => clearTimeout(timer);
  }, [feedbackSavedAt]);

  useEffect(() => {
    const container = latexPreviewRef.current;
    if (!container) return;
    let cancelled = false;

    const render = async () => {
      const source = latexInput.trim();
      setLatexRenderError('');
      setLatexErrors([]);
      if (!source) {
        container.innerHTML = '';
        return;
      }
      container.innerHTML = '';
      container.textContent = source;
      try {
        const mj = await ensureMathJaxReady();
        mj.texReset?.();
        await mj.typesetPromise([container]);
        if (cancelled) return;
        const errors = Array.from(container.querySelectorAll('mjx-merror'))
          .map((node) => node.getAttribute('data-mjx-error') || node.textContent?.trim() || '')
          .filter((text) => text.length > 0);
        setLatexErrors(errors);
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message ? String(error.message) : String(error);
        setLatexRenderError(message);
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [latexInput]);

  useEffect(() => {
    const active = (llmStatus !== 'idle' && llmStatus !== 'done') || (translationStatus !== 'idle' && translationStatus !== 'done');
    if (!active) return;
    const timer = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(timer);
  }, [llmStatus, translationStatus]);

  // When a composed image is confirmed in Images module, show preview in Problems
  useEffect(() => {
    let revokeUrl: string | null = null;
    (async () => {
      if (current.image) {
        const blob = await getImageBlob(current.image);
        if (blob) {
          const url = URL.createObjectURL(blob);
          revokeUrl = url;
          setConfirmedImageUrl(url);
        } else {
          setConfirmedImageUrl('');
        }
      } else {
        setConfirmedImageUrl('');
      }
    })();
    return () => { if (revokeUrl) URL.revokeObjectURL(revokeUrl); };
  }, [current.image]);

  const update = (patch: Partial<ProblemRecord>) => store.upsertProblem({ id: current.id, ...patch });

  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setSavedAt(null), 1500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const onAddOcrImage = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    setOcrImage(file);
    const url = URL.createObjectURL(file);
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    setOcrPreviewUrl(url);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) await onAddOcrImage(file);
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) await onAddOcrImage(file);
    }
  };

  const runOCR = async () => {
    if (!ocrImage) {
      alert('Please upload an image for OCR (not the problem image).');
      return;
    }
    if (!ensureAgent('ocr')) return;
    setLlmStatusSource('ocr');
    const text = await ocrWithLLM(ocrImage, agents.ocr, { onStatus: (s)=> setLlmStatus(s) });
    setOcrText(text);
    setLlmStatus('done');
  };

  const applyOcrText = () => {
    if (!ocrText.trim()) return;
    update({ question: ocrText });
  };

  const openViewer = (src: string) => openViewerWindow(src, { title: t('viewLarge'), back: t('back') });
  const ensureAgent = (agentId: AgentId): boolean => {
    const cfg = agents[agentId]?.config;
    if (!cfg?.apiKey?.trim() || !cfg?.model?.trim() || !cfg?.baseUrl?.trim()) {
      alert(`${t('llmMissingTitle')}: ${t('llmAgentMissingBody', { agent: agentDisplay[agentId] })}`);
      const anchor = document.querySelector('[data-llm-config-section="true"]') || document.querySelector('.label');
      anchor?.scrollIntoView({ behavior: 'smooth' });
      return false;
    }
    return true;
  };

  const fixLatex = async (field: 'question' | 'answer') => {
    const text = (current as any)[field] as string;
    if (!text?.trim() && field !== 'answer') return;
    if (field === 'answer' && !combinedOptionsAndAnswerFilled) return;
    if (!ensureAgent('latex')) return;
    setLlmStatusSource(field === 'question' ? 'latex_question' : 'latex_answer');
    const contextLabel = field === 'question'
      ? 'Question field'
      : current.questionType === 'Multiple Choice'
        ? 'Options and answer section'
        : 'Answer section';
    const snippet = field === 'question'
      ? text
      : buildOptionsAnswerSnippet(text, current.options ?? []);
    const payload = composeLatexCorrectionInput(snippet, undefined, contextLabel);
    const corrected = (await latexCorrection(payload, agents.latex, { onStatus: (s)=> setLlmStatus(s) })).trim();
    if (field === 'question') {
      update({ question: corrected } as any);
    } else {
      const parsed = parseOptionsAnswerSnippet(corrected);
      let finalAnswer = parsed.answer && parsed.answer.trim().length > 0 ? parsed.answer.trim() : (text ?? '');
      finalAnswer = finalAnswer.replace(/^Answer\s*:\s*/i, '').trim();
      if (!finalAnswer && text) {
        finalAnswer = text.trim();
      }
      const patch: Partial<ProblemRecord> = { answer: finalAnswer };
      if (parsed.options && current.questionType === 'Multiple Choice') {
        patch.options = parsed.options;
      }
      update(patch);
    }
    setLlmStatus('done');
  };

  const generate = async () => {
    const input = current.question?.trim() || ocrText.trim();
    if (!input) return;
    if (!ensureAgent('generator')) return;
    setLlmStatusSource('generate');
    setGeneratorPreview('');
    try {
      const conversation = generatorHistory.map(({ prompt, response, feedback }) => ({ prompt, response, feedback }));
      const result = await generateProblemFromText(input, current, agents.generator, defaults, {
        onStatus: (s) => setLlmStatus(s),
        conversation
      });
      update(result.patch);
      setGeneratorPreview(result.raw || '');
      setGeneratorHistory((prev) => [
        ...prev,
        {
          prompt: input,
          response: result.raw,
          feedback: undefined,
          patch: result.patch,
          timestamp: Date.now()
        }
      ]);
      setLatestFeedback('');
      setFeedbackSavedAt(null);
      setLlmStatus('done');
    } catch (err: any) {
      console.error('Generate with LLM failed:', err);
      const baseMessage = err?.message ? String(err.message) : String(err);
      const rawText = typeof err?.raw === 'string' ? err.raw : '';
      const rawTrimmed = rawText.trim();
      const preview = rawTrimmed ? rawText : (typeof err?.displayMessage === 'string' ? err.displayMessage : baseMessage);
      setGeneratorPreview(preview);
      const alertMessage = typeof err?.displayMessage === 'string'
        ? err.displayMessage
        : (rawTrimmed ? `${baseMessage}\n\n${rawText}` : `Error: ${baseMessage}`);
      alert(alertMessage);

      setLlmStatus('idle');
      setLlmStatusSource(null);
    }
  };

  const handleSubmitFeedback = () => {
    if (generatorHistory.length === 0) return;
    const trimmed = latestFeedback.trim();
    setGeneratorHistory((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = {
        ...next[next.length - 1],
        feedback: trimmed.length > 0 ? trimmed : undefined
      };
      return next;
    });
    setLatestFeedback('');
    setFeedbackSavedAt(Date.now());
  };

  const loadLatexFrom = (field: 'question' | 'answer') => {
    if (field === 'answer') {
      const snippet = buildOptionsAnswerSnippet(current.answer ?? '', current.options ?? []);
      setLatexInput(snippet);
      return;
    }
    const text = (current as any)[field] as string;
    setLatexInput(text || '');
  };

  const clearLatexInput = () => {
    setLatexInput('');
  };

  const clearAttachedImage = () => {
    update({ image: '', imageDependency: 0 });
    setConfirmedImageUrl('');
  };

  const latexHasSource = latexInput.trim().length > 0;

  const fixLatexPreview = async () => {
    const source = latexInput.trim();
    if (!source) return;
    if (!ensureAgent('latex')) return;
    const previousRenderError = latexRenderError;
    setLatexRenderError('');
    setLlmStatusSource('latex_preview');
    try {
      const uniqueErrors = latexErrors.length > 0 ? Array.from(new Set(latexErrors)) : undefined;
      const fallbackReport = !uniqueErrors && previousRenderError ? [previousRenderError] : undefined;
      const payload = composeLatexCorrectionInput(source, uniqueErrors ?? fallbackReport, 'MathJax preview panel');
      const corrected = await latexCorrection(payload, agents.latex, { onStatus: (s) => setLlmStatus(s) });
      setLatexInput(corrected);
      setLatexErrors([]);
      setLatexRenderError('');
      setLlmStatus('done');
    } catch (error: any) {
      const message = error?.message ? String(error.message) : String(error);
      setLatexRenderError(message);
      setLlmStatus('idle');
      setLlmStatusSource(null);
    }
  };

  const runTranslation = async () => {
    const payload = translationInput.trim();
    if (!payload) {
      alert(t('translationInputMissing'));
      return;
    }
    if (!ensureAgent('translator')) return;
    setTranslationError('');
    setTranslationStatus('waiting_response');
    try {
      const output = await translateWithLLM(payload, translationTarget, agents.translator, { onStatus: (s) => setTranslationStatus(s) });
      setTranslationOutput(output);
    } catch (err: any) {
      setTranslationError(String(err?.message || err));
    } finally {
      setTranslationStatus('done');
    }
  };

  const loadTranslationFrom = (field: 'question' | 'answer') => {
    const source = (current as any)[field] as string;
    setTranslationInput(source || '');
  };

  const ensureOptionsForMC = () => {
    if (current.questionType === 'Multiple Choice') {
      const count = Math.max(2, defaults.optionsCount || 5);
      if (!current.options || current.options.length !== count) {
        const next = Array.from({ length: count }, (_, i) => current.options?.[i] ?? '');
        update({ options: next });
      }
    }
  };

  const combinedOptionsAndAnswerFilled = hasOptionsOrAnswerContent();

  useEffect(() => { ensureOptionsForMC(); }, [current.questionType]);
  useEffect(() => { ensureOptionsForMC(); }, [defaults.optionsCount]);

  const renderPreviewSnippet = () => {
    const lines: string[] = [];
    lines.push(current.question?.trim() || '(blank question)');
    lines.push('');
    lines.push(`Type: ${current.questionType || 'N/A'}`);
    lines.push(`Subfield: ${current.subfield || 'N/A'}`);
    lines.push(`Academic level: ${current.academicLevel || 'N/A'}`);
    lines.push(`Difficulty: ${current.difficulty || 'N/A'}`);
    if (current.questionType === 'Multiple Choice') {
      lines.push('');
      lines.push('Options:');
      const optionCount = Math.max(2, defaults.optionsCount || current.options?.length || 0);
      const options = Array.from({ length: optionCount }, (_, idx) => current.options?.[idx] ?? '');
      options.forEach((opt, idx) => {
        const label = String.fromCharCode(65 + idx);
        lines.push(`${label}) ${opt || '(blank)'}`);
      });
    }
    lines.push('');
    lines.push('Answer:');
    lines.push(current.answer?.trim() || '(blank answer)');
    return lines.join('\n');
  };

  const previewSnippet = useMemo(() => renderPreviewSnippet(), [
    current.question,
    current.questionType,
    current.subfield,
    current.academicLevel,
    current.difficulty,
    current.answer,
    JSON.stringify(current.options),
    defaults.optionsCount
  ]);

  // ----- Subfield helpers -----
  const selectedSubfields = useMemo(() => (current.subfield ? current.subfield.split(';').filter(Boolean) : []), [current.subfield]);
  const subfieldOptions = defaults.subfieldOptions;
  const sourceOptions = defaults.sourceOptions;
  const academicOptions = defaults.academicLevels;
  const difficultyOptions = defaults.difficultyOptions;
  const difficultyLabel = defaults.difficultyPrompt?.trim() || t('difficulty');
  const difficultyLabelDisplay = difficultyLabel === 'Difficulty (1=easy, 3=hard)' ? t('difficulty') : difficultyLabel;
  const sourceSelectValue = sourceOptions.includes(current.source) ? current.source : CUSTOM_OPTION;
  const academicSelectOptions = academicOptions.includes(current.academicLevel) || !current.academicLevel
    ? academicOptions
    : [...academicOptions, current.academicLevel];
  const difficultySelectOptions = difficultyOptions.includes(current.difficulty) || !current.difficulty
    ? difficultyOptions
    : [...difficultyOptions, current.difficulty];
  const [showCustomSubfield, setShowCustomSubfield] = useState(false);
  const [customSubfield, setCustomSubfield] = useState('');
  const assistToolsHint = t('llmAssistGenerateHint');

  const getMissingRequiredFields = (): string[] => {
    const missing: string[] = [];
    if (!current.question?.trim()) missing.push(t('problemText'));
    if (!current.questionType?.trim()) missing.push(t('targetType'));
    if (!current.answer?.trim()) missing.push(t('answer'));
    if (selectedSubfields.length === 0) missing.push(t('subfield'));
    if (!current.source?.trim()) missing.push(t('source'));
    if (!current.academicLevel?.trim()) missing.push(t('academic'));
    if (!current.difficulty?.trim()) missing.push(difficultyLabelDisplay);
    if (current.questionType === 'Multiple Choice') {
      const optionCount = Math.max(2, defaults.optionsCount || (current.options?.length ?? 0) || 0);
      const options = Array.from({ length: optionCount }, (_, i) => (current.options?.[i] ?? '').trim());
      if (options.some((opt) => !opt)) missing.push(t('options'));
    }
    return missing;
  };

  const ensureRequiredBeforeProceed = () => {
    const missing = Array.from(new Set(getMissingRequiredFields()));
    if (missing.length === 0) return true;
    const message = t('requiredMissing', { fields: missing.join(', ') });
    return window.confirm(message);
  };

  const handleSaveCurrent = () => {
    if (!ensureRequiredBeforeProceed()) return;
    store.upsertProblem({});
    setSavedAt(Date.now());
  };

  const addSubfield = (value: string) => {
    const v = value.trim();
    if (!v) return;
    const set = new Set(selectedSubfields);
    set.add(v);
    update({ subfield: Array.from(set).join(';') });
  };
  const removeSubfield = (value: string) => {
    const next = selectedSubfields.filter(s => s !== value);
    update({ subfield: next.join(';') });
  };
  const onSelectSubfield = (v: string) => {
    if (!v) return;
    if (v === CUSTOM_OPTION) {
      setShowCustomSubfield(true);
      setTimeout(() => customSubfieldInputRef.current?.focus(), 0);
      return;
    }
    addSubfield(v);
  };
  const confirmCustomSubfield = () => {
    if (!customSubfield.trim()) return;
    addSubfield(customSubfield);
    setCustomSubfield('');
    setShowCustomSubfield(false);
  };

  return (
    <div>
      <div className="row" style={{justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8}}>
        <div className="row" style={{gap:8, flexWrap:'wrap'}}>
          <button className="primary" onClick={() => store.newProblem()}>{t('newProblem')}</button>
          <button onClick={handleSaveCurrent}>{t('saveProblem')}</button>
          <button onClick={() => setPreviewOpen((prev) => !prev)}>{previewOpen ? t('previewClose') : t('previewOpen')}</button>
        </div>
        <div className="row" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
          <button onClick={goPrev} disabled={!hasPrev}>{t('prev')}</button>
          <button onClick={goNext}>{t('next')}</button>
          <span className="small">ID: {current.id}</span>
          {savedAt && <span className="badge">{t('saved')}</span>}
        </div>
      </div>

      <div className="small" style={{marginTop:8, color:'var(--text-muted)'}}>{t('requiredMarkNote')}</div>

      <hr className="div" />

      <div className="grid grid-2">
        <div>
          <div className="card" style={{display:'flex', flexDirection:'column', gap:12}}>
            <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
              <div className="label" style={{margin:0, fontSize:'1.15rem', fontWeight:600}}>{t('questionInfoTitle')}</div>
            </div>
            <div>
              <div className="label">{t('problemText')}<span style={{ color: '#f97316', marginLeft: 4 }}>*</span></div>
              <textarea value={current.question} onChange={(e)=> update({ question: e.target.value })} onPaste={onPaste} />
              <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
                <div className="row" style={{gap:6, alignItems:'center'}}>
                  <button onClick={() => fixLatex('question')}>{t('latexFix')}</button>
                  {(llmStatusSource === 'latex_question' && llmStatus !== 'idle' && llmStatus !== 'done') && (
                    <span className="small">{llmStatus === 'waiting_response' ? t('waitingLLMResponse') : t('waitingLLMThinking')}{'.'.repeat(dots)}</span>
                  )}
                </div>
                <span className="small">{t('latexFixHint')}</span>
              </div>
              <div style={{marginTop:8}}>
                <div className="small" style={{color:'var(--text-muted)'}}>{t('mathJaxPreviewLabel')}</div>
                <div
                  ref={questionPreviewRef}
                  style={{marginTop:4, padding:12, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface-subtle)', minHeight:48, whiteSpace:'pre-wrap'}}
                />
                {questionMathJaxError ? (
                  <span className="small" style={{color:'#f87171', display:'block', marginTop:4}}>{t('mathJaxPreviewError', { error: questionMathJaxError })}</span>
                ) : (!current.question?.trim() ? (
                  <span className="small" style={{color:'var(--text-muted)', display:'block', marginTop:4}}>{t('mathJaxPreviewEmpty')}</span>
                ) : null)}
              </div>
            </div>

            <div>
              <div className="label">{t('targetType')}<span style={{ color: '#f97316', marginLeft: 4 }}>*</span></div>
              <select value={current.questionType} onChange={(e)=> update({ questionType: e.target.value as any })}>
                <option value="Multiple Choice">{t('type_mc')}</option>
                <option value="Fill-in-the-blank">{t('type_fitb')}</option>
                <option value="Proof">{t('type_proof')}</option>
              </select>
              <div className="small" style={{marginTop:6}}>{t('type_hint')}</div>
            </div>

            {current.questionType === 'Multiple Choice' && (
              <div>
                <div className="label">{t('options')}<span style={{ color: '#f97316', marginLeft: 4 }}>*</span></div>
                <div className="options-grid">
                  {Array.from({ length: Math.max(2, defaults.optionsCount || current.options.length || 5) }).map((_, idx) => (
                    <input key={idx} value={current.options[idx] || ''} onChange={(e)=>{
                      const next = [...(current.options||[])];
                      next[idx] = e.target.value;
                      update({ options: next });
                    }} placeholder={String.fromCharCode(65 + idx)} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="label">{t('answer')}<span style={{ color: '#f97316', marginLeft: 4 }}>*</span></div>
              <textarea value={current.answer} onChange={(e)=> update({ answer: e.target.value })} />
              <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
                <div className="row" style={{gap:6, alignItems:'center'}}>
                  <button onClick={() => fixLatex('answer')} disabled={!combinedOptionsAndAnswerFilled}>{t('latexFix')}</button>
                  {(llmStatusSource === 'latex_answer' && llmStatus !== 'idle' && llmStatus !== 'done') && (
                    <span className="small">{llmStatus === 'waiting_response' ? t('waitingLLMResponse') : t('waitingLLMThinking')}{'.'.repeat(dots)}</span>
                  )}
                </div>
                <span className="small">{t('latexFixHint')}</span>
              </div>
              <div style={{marginTop:8}}>
                <div className="small" style={{color:'var(--text-muted)'}}>{t('mathJaxPreviewLabel')}</div>
                <div
                  ref={answerPreviewRef}
                  style={{marginTop:4, padding:12, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface-subtle)', minHeight:48, whiteSpace:'pre-wrap'}}
                />
                {answerMathJaxError ? (
                  <span className="small" style={{color:'#f87171', display:'block', marginTop:4}}>{t('mathJaxPreviewError', { error: answerMathJaxError })}</span>
                ) : (!combinedOptionsAndAnswerFilled ? (
                  <span className="small" style={{color:'var(--text-muted)', display:'block', marginTop:4}}>{t('mathJaxPreviewEmpty')}</span>
                ) : null)}
              </div>
            </div>
            <div>
              <div className="label">{t('subfield')}<span style={{ color: '#f97316', marginLeft: 4 }}>*</span></div>
              <div className="row" style={{gap:8, flexWrap:'wrap'}}>
                <select
                  onChange={(e)=>{ onSelectSubfield(e.target.value); (e.target as HTMLSelectElement).value=''; }}
                  defaultValue=""
                >
                  <option value="" disabled>--</option>
                  {subfieldOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value={CUSTOM_OPTION}>{t('subfield_others')}</option>
                </select>
                {showCustomSubfield && (
                  <div className="row" style={{gap:8}}>
                    <input ref={customSubfieldInputRef} value={customSubfield} placeholder={t('subfield_others')} onChange={(e)=> setCustomSubfield(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') confirmCustomSubfield(); }} />
                    <button onClick={confirmCustomSubfield}>{t('confirmText')}</button>
                  </div>
                )}
                {selectedSubfields.length > 0 && (
                  <div className="row" style={{gap:6, flexWrap:'wrap'}}>
                    {selectedSubfields.map((s) => (
                      <span key={s} className="badge" style={{display:'inline-flex', alignItems:'center', gap:6}}>
                        {s}
                        <button onClick={()=> removeSubfield(s)} style={{padding:'0 6px'}} aria-label={t('defaultsRemoveItem', { item: s })}>x</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="row" style={{gap:8, width:'100%'}}>
                  <span className="small">{t('resultLabel')}:</span>
                  <input style={{flex:1, minWidth:0}} value={current.subfield} readOnly />
                </div>
                <span className="small">{t('selectSubfieldHint')}</span>
              </div>
            </div>

            <div>
              <div className="label">{t('source')}<span style={{ color: '#f97316', marginLeft: 4 }}>*</span></div>
              <div className="row" style={{gap:8, flexWrap:'wrap'}}>
                <select
                  value={sourceSelectValue}
                  onChange={(e)=>{
                    const v = e.target.value;
                    if (v === CUSTOM_OPTION) {
                      update({ source: '' });
                      setTimeout(()=> customSourceInputRef.current?.focus(), 0);
                    } else {
                      update({ source: v });
                    }
                  }}
                >
                  {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value={CUSTOM_OPTION}>{t('subfield_others')}</option>
                </select>
                <input
                  ref={customSourceInputRef}
                  placeholder={t('subfield_others')}
                  value={current.source}
                  onChange={(e)=> update({ source: e.target.value })}
                  style={{flex:1, minWidth:0}}
                />
              </div>
            </div>

            <div className="grid" style={{gridTemplateColumns:'1fr 1fr 1fr', gap:8}}>
              <div>
                <div className="label">{t('academic')}<span style={{ color: '#f97316', marginLeft: 4 }}>*</span></div>
                <select value={current.academicLevel} onChange={(e)=> update({ academicLevel: e.target.value })}>
                  {academicSelectOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="label">{difficultyLabelDisplay}<span style={{ color: '#f97316', marginLeft: 4 }}>*</span></div>
                <select value={current.difficulty} onChange={(e)=> update({ difficulty: e.target.value })}>
                  {difficultySelectOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div className="row" style={{alignItems:'flex-end', justifyContent:'flex-end'}}>
                {/* intentionally left blank to balance layout */}
              </div>
            </div>
          </div>
        </div>

        <div>
          {confirmedImageUrl && (
            <div className="card" style={{marginBottom:12}}>
              <div className="row" style={{gap:8, alignItems:'center', justifyContent:'space-between'}}>
                <div className="row" style={{gap:8, alignItems:'center'}}>
                  <span className="badge">{t('imageAttached')}</span>
                  <span className="small">{t('imageDependencyLabel')}</span>
                </div>
                <div className="row" style={{gap:8, alignItems:'center'}}>
                  <button onClick={()=> openViewer(confirmedImageUrl)}>{t('viewLarge')}</button>
                  <button onClick={clearAttachedImage} aria-label={t('clearImageAttachment')}>{t('clearImageAttachment')}</button>
                </div>
              </div>
              <img src={confirmedImageUrl} style={{maxWidth:'100%', maxHeight:200, borderRadius:8, border:'1px solid var(--border)', marginTop:8}} />
            </div>
          )}
          <div className="card" style={{display:'flex', flexDirection:'column', gap:12}}>
            <div>
              <div className="label" style={{margin:0, fontSize:'1.15rem', fontWeight:600}}>{t('assistToolsTitle')}</div>
              {assistToolsHint && assistToolsHint.trim().length > 0 && (
                <div className="small" style={{marginTop:6, color:'var(--text-muted)'}}>{assistToolsHint}</div>
              )}
            </div>

            <div>
              <div className="label" style={{marginBottom:4}}>{t('assistToolGenerator')}</div>
              <div className="small" style={{color:'var(--text-muted)'}}>{t('assistToolGeneratorHint')}</div>
              <div className="row" style={{gap:8, flexWrap:'wrap', alignItems:'center', marginTop:8}}>
                <button className="primary" onClick={generate}>{t('assistToolGeneratorAction')}</button>
                {(llmStatusSource === 'generate' && llmStatus !== 'idle' && llmStatus !== 'done') && (
                  <span className="small">{llmStatus === 'waiting_response' ? t('waitingLLMResponse') : t('waitingLLMThinking')}{'.'.repeat(dots)}</span>
                )}
              </div>
              {generatorPreview && (
                <div style={{marginTop:8}}>
                  <div className="label" style={{marginBottom:4}}>{t('llmReply')}</div>
                  <textarea readOnly value={generatorPreview} rows={8} style={{width:'100%', fontFamily:'var(--font-mono, monospace)'}} />
                </div>
              )}
              {generatorHistory.length > 0 && (
                <div style={{marginTop:12, display:'flex', flexDirection:'column', gap:12}}>
                  <div>
                    <div className="label" style={{marginBottom:4}}>{t('llmConversationHistory')}</div>
                    <div className="small" style={{color:'var(--text-muted)'}}>{t('llmConversationHistoryHint')}</div>
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:8, maxHeight:220, overflowY:'auto'}}>
                    {generatorHistory.map((turn, idx) => (
                      <div key={turn.timestamp} style={{border:'1px solid var(--border)', borderRadius:8, padding:8, display:'flex', flexDirection:'column', gap:6}}>
                        <div className="small" style={{fontWeight:600}}>{t('llmTurnLabel', { index: idx + 1 })}</div>
                        <div className="small" style={{whiteSpace:'pre-wrap'}}>
                          <strong>{t('llmPromptLabel')}:</strong>{' '}
                          {turn.prompt || t('llmEmptyValue')}
                        </div>
                        <div className="small" style={{whiteSpace:'pre-wrap'}}>
                          <strong>{t('llmResponseLabel')}:</strong>{' '}
                          {turn.response || t('llmEmptyValue')}
                        </div>
                        <div className="small" style={{whiteSpace:'pre-wrap'}}>
                          <strong>{t('llmUserFeedbackLabel')}:</strong>{' '}
                          {turn.feedback || t('llmEmptyValue')}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="label" style={{marginBottom:4}}>{t('llmUserFeedbackLabel')}</div>
                    <textarea
                      value={latestFeedback}
                      onChange={(e)=> setLatestFeedback(e.target.value)}
                      rows={3}
                      placeholder={t('llmFeedbackPlaceholder')}
                      disabled={generatorHistory.length === 0}
                    />
                    <div className="row" style={{justifyContent:'flex-end', gap:8, alignItems:'center', marginTop:6, flexWrap:'wrap'}}>
                      <button type="button" onClick={handleSubmitFeedback} disabled={generatorHistory.length === 0}>{t('llmSubmitFeedback')}</button>
                      {feedbackSavedAt && <span className="small" style={{color:'var(--text-muted)'}}>{t('saved')}</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <hr className="div" style={{margin:'12px 0'}} />
            <div>
              <div className="row" style={{justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8}}>
                <div className="label" style={{margin:0}}>{t('assistToolTranslation')}</div>
                <div className="row" style={{gap:8, flexWrap:'wrap'}}>
                  <button type="button" onClick={() => loadTranslationFrom('question')}>{t('translationLoadQuestion')}</button>
                  <button type="button" onClick={() => loadTranslationFrom('answer')}>{t('translationLoadAnswer')}</button>
                  <select value={translationTarget} onChange={(e)=> setTranslationTarget(e.target.value as 'en' | 'zh')}>
                    <option value="zh">{t('translationTargetZh')}</option>
                    <option value="en">{t('translationTargetEn')}</option>
                  </select>
                  <div className="row" style={{gap:6, alignItems:'center'}}>
                    <button type="button" className="primary" onClick={runTranslation}>{t('translationRun')}</button>
                    {(translationStatus !== 'idle' && translationStatus !== 'done') && (
                      <span className="small">{translationStatus === 'waiting_response' ? t('waitingLLMResponse') : t('waitingLLMThinking')}{'.'.repeat(dots)}</span>
                    )}
                  </div>
                </div>
              </div>
              {translationError && (
                <span className="small" style={{color:'#f87171'}}>{translationError}</span>
              )}
              <div className="grid" style={{gridTemplateColumns:'1fr 1fr', gap:8, marginTop:8}}>
                <div>
                  <div className="label" style={{marginBottom:4}}>{t('translationInputLabel')}</div>
                  <textarea value={translationInput} onChange={(e)=> setTranslationInput(e.target.value)} rows={6} />
                </div>
                <div>
                  <div className="label" style={{marginBottom:4}}>{t('translationOutputLabel')}</div>
                  <textarea value={translationOutput} onChange={(e)=> setTranslationOutput(e.target.value)} rows={6} />
                </div>
              </div>
              <div className="row" style={{justifyContent:'flex-end', gap:8, flexWrap:'wrap'}}>
                <button type="button" onClick={()=> translationOutput && update({ question: translationOutput })}>{t('translationApplyQuestion')}</button>
                <button type="button" onClick={()=> translationOutput && update({ answer: translationOutput })}>{t('translationApplyAnswer')}</button>
              </div>
            </div>
            <hr className="div" style={{margin:'12px 0'}} />
            <div>
              <div className="label" style={{marginBottom:4}}>{t('assistToolLatex')}</div>
              <div className="small" style={{color:'var(--text-muted)'}}>{t('assistToolLatexHint')}</div>
              <div className="row" style={{gap:8, flexWrap:'wrap', marginTop:8}}>
                <button type="button" onClick={()=> loadLatexFrom('question')}>{t('assistToolLatexLoadQuestion')}</button>
                <button type="button" onClick={()=> loadLatexFrom('answer')}>{t('assistToolLatexLoadAnswer')}</button>
                <button type="button" onClick={clearLatexInput} disabled={!latexHasSource}>{t('assistToolLatexClear')}</button>
                <div className="row" style={{gap:6, alignItems:'center'}}>
                  <button type="button" className="primary" onClick={fixLatexPreview} disabled={!latexHasSource}>{t('assistToolLatexFix')}</button>
                  {(llmStatusSource === 'latex_preview' && llmStatus !== 'idle' && llmStatus !== 'done') && (
                    <span className="small">{llmStatus === 'waiting_response' ? t('waitingLLMResponse') : t('waitingLLMThinking')}{'.'.repeat(dots)}</span>
                  )}
                </div>
              </div>
              <textarea
                value={latexInput}
                onChange={(e)=> setLatexInput(e.target.value)}
                rows={6}
                placeholder={t('assistToolLatexPlaceholder')}
                style={{marginTop:8, fontFamily:'var(--font-mono, monospace)'}}
              />
              {latexRenderError && (
                <span className="small" style={{color:'#f87171'}}>{t('assistToolLatexRenderError', { error: latexRenderError })}</span>
              )}
              {latexErrors.length > 0 && (
                <div className="small" style={{marginTop:8}}>
                  <div style={{fontWeight:600}}>{t('assistToolLatexErrorsTitle')}</div>
                  <ul style={{margin:'4px 0 0 0', paddingLeft:18}}>
                    {latexErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              {latexHasSource && !latexRenderError && latexErrors.length === 0 && (
                <span className="small" style={{color:'var(--text-muted)', display:'block', marginTop:8}}>{t('assistToolLatexNoIssues')}</span>
              )}
              {latexHasSource && (
                <div
                  ref={latexPreviewRef}
                  style={{marginTop:8, padding:12, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface-subtle)', minHeight:48, whiteSpace:'pre-wrap'}}
                />
              )}
            </div>
            <hr className="div" style={{margin:'12px 0'}} />
            <div>
              <div className="label" style={{marginBottom:4}}>{t('assistToolOcr')}</div>
              <div className="small" style={{color:'var(--text-muted)'}}>{t('uploadImage')}</div>
              <div className="dropzone" onDrop={onDrop} onDragOver={(e)=> e.preventDefault()} onPaste={onPaste}>
                <div className="row" style={{justifyContent:'center', gap:8}}>
                  <input type="file" accept="image/*" style={{display:'none'}} ref={fileInputRef} onChange={(e)=>{
                    const f = e.target.files?.[0];
                    if (f) onAddOcrImage(f);
                  }} />
                  <input type="file" style={{display:'none'}} ref={folderInputRef} multiple onChange={(e)=>{
                    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
                    if (files[0]) onAddOcrImage(files[0]);
                  }} />
                  {folderInputRef.current && (()=>{ folderInputRef.current.setAttribute('webkitdirectory',''); folderInputRef.current.setAttribute('directory',''); })()}
                  <button onClick={()=> fileInputRef.current?.click()}>{t('browse')}</button>
                  <button onClick={()=> folderInputRef.current?.click()}>{t('folder')}</button>
                  <span className="small">{t('dragDropOrPaste')}</span>
                </div>
              </div>
              {ocrPreviewUrl && (
                <div style={{marginTop:8}}>
                  <div className="row" style={{justifyContent:'flex-end', marginBottom:6}}>
                    <button onClick={()=> openViewer(ocrPreviewUrl)}>{t('viewLarge')}</button>
                  </div>
                  <img className="preview" src={ocrPreviewUrl} />
                </div>
              )}

              <div className="row" style={{marginTop:8, gap:8, alignItems:'center'}}>
                <div className="row" style={{gap:6, alignItems:'center'}}>
                  <button onClick={runOCR}>{t('ocrExtract')}</button>
                  {(llmStatusSource === 'ocr' && llmStatus !== 'idle' && llmStatus !== 'done') && (
                    <span className="small">{llmStatus === 'waiting_response' ? t('waitingLLMResponse') : t('waitingLLMThinking')}{'.'.repeat(dots)}</span>
                  )}
                </div>
                <button onClick={applyOcrText}>{t('confirmText')}</button>
              </div>
              {ocrText && (
                <textarea style={{marginTop:8}} value={ocrText} onChange={(e)=> setOcrText(e.target.value)} />
              )}
            </div>
          </div>

          <div className="row" style={{alignItems:'flex-end', justifyContent:'flex-end', marginTop:12}}>
            <button onClick={()=> onOpenClear && onOpenClear()}>{t('clearBank')}</button>
          </div>
        </div>

        {previewOpen && (
          <div>
            <div className="card" style={{display:'flex', flexDirection:'column', gap:12}}>
              <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
                <div className="label" style={{margin:0, fontSize:'1.15rem', fontWeight:600}}>{t('questionPreviewTitle')}</div>
              </div>
              <div className="small" style={{color:'var(--text-muted)'}}>{t('questionPreviewHint')}</div>
              <div ref={previewMathJaxRef} style={{padding:12, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface-subtle)', minHeight:120, whiteSpace:'pre-wrap'}} />
              {previewMathJaxError && (
                <span className="small" style={{color:'#f87171'}}>{t('mathJaxPreviewError', { error: previewMathJaxError })}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
