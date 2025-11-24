import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, ProblemRecord, AgentId } from "../state/store";
import {
  chatStream,
  latexCorrection,
  ocrWithLLM,
  translateWithLLM,
} from "../lib/llmAdapter";
import type { ChatMessage } from "../lib/llmAdapter";
import { getImageBlob, saveImageBlobAtPath } from "../lib/db";
import { openViewerWindow } from "../lib/viewer";
import {
  generateProblemFromText,
  GeneratorConversationTurn,
  LLMGenerationError,
  reviewGeneratedQuestion,
  ReviewAuditResult,
} from "../lib/generator";
import {
  buildDisplayName,
  collectFilesFromItems,
  extractFilesFromClipboardData,
  formatTimestamp,
  inferExtension,
  readClipboardFiles,
  resolveImageFileName,
} from "../lib/fileHelpers";

type GeneratorTurnState = GeneratorConversationTurn & {
  patch: Partial<ProblemRecord>;
  timestamp: number;
  review?: ReviewAuditResult & { attempts: number; forced: boolean };
};

type QAHistoryTurn = ChatMessage & { timestamp: number };

export function ProblemEditor({ onOpenClear }: { onOpenClear?: () => void }) {
  const { t } = useTranslation();
  const store = useAppStore();
  const defaults = useAppStore((s) => s.defaults);
  const agents = useAppStore((s) => s.llmAgents);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const current = useMemo(
    () => store.problems.find((p) => p.id === store.currentId)!,
    [store.problems, store.currentId],
  );
  const currentIndex = useMemo(
    () => store.problems.findIndex((p) => p.id === store.currentId),
    [store.problems, store.currentId],
  );
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
  const [ocrText, setOcrText] = useState("");
  const [ocrImage, setOcrImage] = useState<Blob | null>(null);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string>("");
  const [ocrDisplayName, setOcrDisplayName] = useState("");
  const [confirmedImageUrl, setConfirmedImageUrl] = useState<string>("");
  const ocrFileInputRef = useRef<HTMLInputElement>(null);
  const [ocrContextMenu, setOcrContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [ocrPasteActive, setOcrPasteActive] = useState(false);
  const customSubfieldInputRef = useRef<HTMLInputElement>(null);
  const customSourceInputRef = useRef<HTMLInputElement>(null);
  const latexPreviewRef = useRef<HTMLDivElement>(null);
  const questionPreviewRef = useRef<HTMLDivElement>(null);
  const answerPreviewRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [llmStatus, setLlmStatus] = useState<
    "idle" | "waiting_response" | "thinking" | "responding" | "done"
  >("idle");
  const [llmStatusSource, setLlmStatusSource] = useState<
    | null
    | "generate"
    | "review"
    | "latex_question"
    | "latex_answer"
    | "latex_preview"
    | "ocr"
  >(null);
  const DOT_SEQUENCE = [" .", " ..", " ..."] as const;
  const [dotStep, setDotStep] = useState(0);
  const [translationInput, setTranslationInput] = useState("");
  const [translationOutput, setTranslationOutput] = useState("");
  const [translationStatus, setTranslationStatus] = useState<
    "idle" | "waiting_response" | "thinking" | "responding" | "done"
  >("idle");
  const [translationTarget, setTranslationTarget] = useState<"en" | "zh">("zh");
  const [translationError, setTranslationError] = useState("");
  const [generatorPreview, setGeneratorPreview] = useState("");
  const [generatorHistory, setGeneratorHistory] = useState<
    GeneratorTurnState[]
  >([]);
  const [reviewerPreview, setReviewerPreview] = useState("");
  const [reviewIssues, setReviewIssues] = useState<string[]>([]);
  const [reviewAttempts, setReviewAttempts] = useState(0);
  const [reviewStatus, setReviewStatus] = useState<"pass" | "fail" | null>(
    null,
  );
  const [forcedReviewAccept, setForcedReviewAccept] = useState(false);
  const [latestFeedback, setLatestFeedback] = useState("");
  const [feedbackSavedAt, setFeedbackSavedAt] = useState<number | null>(null);
  const [qaConversation, setQaConversation] = useState<QAHistoryTurn[]>([]);
  const [qaInput, setQaInput] = useState("");
  const [qaStatus, setQaStatus] = useState<
    "idle" | "waiting_response" | "thinking" | "responding" | "done"
  >("idle");
  const [qaError, setQaError] = useState("");
  const [latexInput, setLatexInput] = useState("");
  const [latexRenderError, setLatexRenderError] = useState("");
  const [latexErrors, setLatexErrors] = useState<string[]>([]);
  const [questionMathJaxError, setQuestionMathJaxError] = useState("");
  const [answerMathJaxError, setAnswerMathJaxError] = useState("");
  const [previewMathJaxError, setPreviewMathJaxError] = useState("");
  const agentDisplay = useMemo<Record<AgentId, string>>(
    () => ({
      ocr: t("agentOcr"),
      latex: t("agentLatex"),
      generator: t("agentGenerator"),
      reviewer: t("agentReviewer"),
      translator: t("agentTranslator"),
      qa: t("agentQa"),
    }),
    [t],
  );
  const CUSTOM_OPTION = "__custom__";

  useEffect(() => {
    const closeMenu = () => {
      setOcrContextMenu(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const ensureMathJaxReady = async () => {
    const mj = (window as any).MathJax;
    if (!mj) {
      throw new Error(t("assistToolLatexLoading"));
    }
    if (mj.startup?.promise) {
      await mj.startup.promise;
    }
    if (typeof mj.typesetPromise !== "function") {
      throw new Error(t("assistToolLatexUnavailable"));
    }
    return mj;
  };

  const composeLatexCorrectionInput = (
    snippet: string,
    reportLines?: string[],
    contextLabel?: string,
  ) => {
    const lines: string[] = [];
    lines.push("MathJax rendering is used in our application.");
    lines.push(
      "This may be an iterative session. Carry forward all previous improvements and integrate any feedback provided below.",
    );
    if (contextLabel) {
      lines.push(`Context: ${contextLabel}`);
    }
    lines.push("MathJax render report:");
    if (reportLines && reportLines.length > 0) {
      reportLines.forEach((line, idx) => {
        lines.push(`${idx + 1}. ${line}`);
      });
    } else {
      lines.push(
        "No explicit parser errors were reported. Please still ensure MathJax compatibility.",
      );
    }
    lines.push("---");
    lines.push("Original LaTeX snippet:");
    lines.push(snippet);
    return lines.join("\n");
  };

  const getOptionLabel = (idx: number) => String.fromCharCode(65 + idx);

  const getOptionCount = () => {
    if (current.questionType !== "Multiple Choice") return 0;
    const existing = Array.isArray(current.options)
      ? current.options.length
      : 0;
    const configured = defaults.optionsCount || 5;
    const baseline = existing > 0 ? existing : configured;
    return Math.max(2, baseline);
  };

  const buildOptionsAnswerSnippet = (
    answerText: string,
    optionsOverride?: string[],
  ): string => {
    const lines: string[] = [];
    if (current.questionType === "Multiple Choice") {
      const optionCount = getOptionCount();
      const baseOptions = optionsOverride ?? current.options ?? [];
      const optionsList = Array.from(
        { length: optionCount },
        (_, idx) => baseOptions[idx] ?? "",
      );
      lines.push("Options:");
      optionsList.forEach((opt, idx) => {
        const label = getOptionLabel(idx);
        const body = (opt ?? "").trim();
        lines.push(body ? `${label}) ${body}` : `${label})`);
      });
      lines.push("");
    }
    lines.push("Answer:");
    lines.push(answerText ?? "");
    return lines.join("\n");
  };

  const parseOptionsAnswerSnippet = (
    input: string,
  ): { options: string[] | null; answer: string } => {
    const normalized = input.replace(/\r\n/g, "\n").trim();
    const answerLabelRegex = /(^|\n)\s*Answer\s*:\s*/i;
    const match = answerLabelRegex.exec(normalized);
    if (!match) {
      return { options: null, answer: normalized };
    }
    const answerStart = match.index + match[0].length;
    const answerText = normalized.slice(answerStart).trim();
    if (current.questionType !== "Multiple Choice") {
      return { options: null, answer: answerText || normalized };
    }
    const optionsPartRaw = normalized
      .slice(0, match.index)
      .replace(/^\s*Options\s*:\s*/i, "")
      .trim();
    const optionCount = getOptionCount();
    const baseOptions = Array.from(
      { length: optionCount },
      (_, idx) => current.options?.[idx] ?? "",
    );
    if (!optionsPartRaw) {
      return {
        options: baseOptions.length > 0 ? baseOptions : null,
        answer: answerText,
      };
    }
    const updated = baseOptions.map((opt) => opt ?? "");
    if (updated.length === 0) {
      return { options: null, answer: answerText };
    }
    const lines = optionsPartRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
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
    const answerHasContent = Boolean(
      current.answer && current.answer.trim().length > 0,
    );
    const optionsHasContent =
      current.questionType === "Multiple Choice" &&
      Array.isArray(current.options) &&
      current.options.some((opt) => opt && opt.trim().length > 0);
    return answerHasContent || optionsHasContent;
  };

  useEffect(() => {
    if (!current) return;
    setTranslationInput(current.question || "");
    setTranslationOutput("");
    setTranslationError("");
    setTranslationStatus("idle");
  }, [current.id]);

  useEffect(() => {
    setGeneratorHistory([]);
    setGeneratorPreview("");
    setReviewerPreview("");
    setReviewIssues([]);
    setReviewAttempts(0);
    setReviewStatus(null);
    setForcedReviewAccept(false);
    setLatestFeedback("");
    setFeedbackSavedAt(null);
    setLatexInput("");
    setLatexRenderError("");
    setLatexErrors([]);
    setQaConversation([]);
    setQaInput("");
    setQaStatus("idle");
    setQaError("");
  }, [current.id]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const container = questionPreviewRef.current;
      if (!container) return;
      container.innerHTML = "";
      setQuestionMathJaxError("");
      const source = current.question?.trim() ?? "";
      if (!source) return;
      container.textContent = source;
      try {
        const mj = await ensureMathJaxReady();
        mj.texReset?.();
        await mj.typesetPromise([container]);
        if (cancelled) return;
        const errors = Array.from(container.querySelectorAll("mjx-merror"))
          .map(
            (node) =>
              node.getAttribute("data-mjx-error") ||
              node.textContent?.trim() ||
              "",
          )
          .filter((text) => text.length > 0);
        if (errors.length > 0) {
          setQuestionMathJaxError(errors.join("; "));
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message ? String(error.message) : String(error);
        setQuestionMathJaxError(message);
      }
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [current.question]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const container = answerPreviewRef.current;
      if (!container) return;
      container.innerHTML = "";
      setAnswerMathJaxError("");
      if (!hasOptionsOrAnswerContent()) {
        return;
      }
      const snippet = buildOptionsAnswerSnippet(current.answer ?? "");
      container.textContent = snippet;
      try {
        const mj = await ensureMathJaxReady();
        mj.texReset?.();
        await mj.typesetPromise([container]);
        if (cancelled) return;
        const errors = Array.from(container.querySelectorAll("mjx-merror"))
          .map(
            (node) =>
              node.getAttribute("data-mjx-error") ||
              node.textContent?.trim() ||
              "",
          )
          .filter((text) => text.length > 0);
        if (errors.length > 0) {
          setAnswerMathJaxError(errors.join("; "));
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message ? String(error.message) : String(error);
        setAnswerMathJaxError(message);
      }
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [
    current.answer,
    current.options,
    current.questionType,
    defaults.optionsCount,
  ]);

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
      setLatexRenderError("");
      setLatexErrors([]);
      if (!source) {
        container.innerHTML = "";
        return;
      }
      container.innerHTML = "";
      container.textContent = source;
      try {
        const mj = await ensureMathJaxReady();
        mj.texReset?.();
        await mj.typesetPromise([container]);
        if (cancelled) return;
        const errors = Array.from(container.querySelectorAll("mjx-merror"))
          .map(
            (node) =>
              node.getAttribute("data-mjx-error") ||
              node.textContent?.trim() ||
              "",
          )
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
    const active =
      (llmStatus !== "idle" && llmStatus !== "done") ||
      (translationStatus !== "idle" && translationStatus !== "done");
    if (!active) {
      setDotStep(0);
      return;
    }
    const timer = setInterval(
      () => setDotStep((step) => (step + 1) % DOT_SEQUENCE.length),
      500,
    );
    return () => clearInterval(timer);
  }, [llmStatus, translationStatus]);
  const dotPattern = DOT_SEQUENCE[dotStep];
  const isGeneratorBusy =
    llmStatusSource === "generate" &&
    llmStatus !== "idle" &&
    llmStatus !== "done";
  const isReviewerBusy =
    llmStatusSource === "review" &&
    llmStatus !== "idle" &&
    llmStatus !== "done";

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
          setConfirmedImageUrl("");
        }
      } else {
        setConfirmedImageUrl("");
      }
    })();
    return () => {
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [current.image]);

  const update = (patch: Partial<ProblemRecord>) =>
    store.upsertProblem({ id: current.id, ...patch });

  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setSavedAt(null), 1500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const onAddOcrImage = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    setOcrContextMenu(null);
    setOcrImage(file);
    const ext = inferExtension(file, "png").toLowerCase();
    const normalizedExt = ext === "jpeg" ? "jpg" : ext;
    const displayName = buildDisplayName(normalizedExt, {
      base: formatTimestamp(),
    });
    setOcrDisplayName(displayName);
    const url = URL.createObjectURL(file);
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    setOcrPreviewUrl(url);
  };

  useEffect(() => {
    if (!ocrPasteActive) return;
    const handlePasteEvent = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      const files = extractFilesFromClipboardData(data, (file) =>
        file.type.startsWith("image/"),
      );
      if (!files.length) return;
      event.preventDefault();
      void onAddOcrImage(files[0]).catch(() => {});
    };
    window.addEventListener("paste", handlePasteEvent);
    return () => window.removeEventListener("paste", handlePasteEvent);
  }, [ocrPasteActive, onAddOcrImage]);

  const handleOcrDrop = async (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOcrContextMenu(null);
    const items = e.dataTransfer?.items ?? null;
    let files: File[] = [];
    if (items && items.length) {
      files = await collectFilesFromItems(items, (file) =>
        file.type.startsWith("image/"),
      );
    }
    if (!files.length) {
      files = Array.from(e.dataTransfer.files || []).filter((file) =>
        file.type.startsWith("image/"),
      );
    }
    const target = files[0];
    if (target) await onAddOcrImage(target);
  };

  const handleOcrPaste = async (e: ReactClipboardEvent<Element>) => {
    const files = extractFilesFromClipboardData(e.clipboardData, (file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    e.preventDefault();
    await onAddOcrImage(files[0]);
  };

  const handleOcrClipboardError = (error: unknown) => {
    if (error instanceof Error) {
      if (error.message === "clipboard_permission_denied") {
        alert(t("clipboardReadDenied"));
        return;
      }
      if (error.message === "clipboard_not_supported") {
        alert(t("clipboardReadUnsupported"));
        return;
      }
      alert(error.message);
      return;
    }
    alert(String(error));
  };

  const runOCR = async () => {
    if (!ocrImage) {
      alert("Please upload an image for OCR (not the problem image).");
      return;
    }
    if (!ensureAgent("ocr")) return;
    setLlmStatusSource("ocr");
    const text = await ocrWithLLM(ocrImage, agents.ocr, {
      onStatus: (s) => setLlmStatus(s),
    });
    setOcrText(text);
    setLlmStatus("done");
  };

  const applyOcrText = () => {
    if (!ocrText.trim()) return;
    update({ question: ocrText });
  };

  const openViewer = (src: string) =>
    openViewerWindow(src, { title: t("viewLarge"), back: t("back") });
  const ensureAgent = (agentId: AgentId): boolean => {
    const cfg = agents[agentId]?.config;
    if (!cfg?.apiKey?.trim() || !cfg?.model?.trim() || !cfg?.baseUrl?.trim()) {
      alert(
        `${t("llmMissingTitle")}: ${t("llmAgentMissingBody", { agent: agentDisplay[agentId] })}`,
      );
      const anchor =
        document.querySelector('[data-llm-config-section="true"]') ||
        document.querySelector(".label");
      anchor?.scrollIntoView({ behavior: "smooth" });
      return false;
    }
    return true;
  };

  const fixLatex = async (field: "question" | "answer") => {
    const text = (current as any)[field] as string;
    if (!text?.trim() && field !== "answer") return;
    if (field === "answer" && !combinedOptionsAndAnswerFilled) return;
    if (!ensureAgent("latex")) return;
    setLlmStatusSource(
      field === "question" ? "latex_question" : "latex_answer",
    );
    const contextLabel =
      field === "question"
        ? "Question field"
        : current.questionType === "Multiple Choice"
          ? "Options and answer section"
          : "Answer section";
    const snippet =
      field === "question"
        ? text
        : buildOptionsAnswerSnippet(text, current.options ?? []);
    const payload = composeLatexCorrectionInput(
      snippet,
      undefined,
      contextLabel,
    );
    const corrected = (
      await latexCorrection(payload, agents.latex, {
        onStatus: (s) => setLlmStatus(s),
      })
    ).trim();
    if (field === "question") {
      update({ question: corrected } as any);
    } else {
      const parsed = parseOptionsAnswerSnippet(corrected);
      let finalAnswer =
        parsed.answer && parsed.answer.trim().length > 0
          ? parsed.answer.trim()
          : (text ?? "");
      finalAnswer = finalAnswer.replace(/^Answer\s*:\s*/i, "").trim();
      if (!finalAnswer && text) {
        finalAnswer = text.trim();
      }
      const patch: Partial<ProblemRecord> = { answer: finalAnswer };
      if (parsed.options && current.questionType === "Multiple Choice") {
        patch.options = parsed.options;
      }
      update(patch);
    }
    setLlmStatus("done");
  };

  const buildAutoReviewFeedback = (
    review: ReviewAuditResult,
    attempt: number,
    limit: number,
  ): string => {
    const lines: string[] = [];
    lines.push(`Auto-review summary (round ${attempt}/${limit})`);
    lines.push(`Status: ${review.status.toUpperCase()}`);
    if (review.issues.length > 0) {
      lines.push("Issues:");
      review.issues.forEach((issue, idx) => {
        lines.push(`${idx + 1}. ${issue}`);
      });
    } else {
      lines.push("Issues: (none reported)");
    }
    if (review.feedback) {
      lines.push(`Feedback: ${review.feedback}`);
    }
    lines.push("Please resolve every issue before producing the next draft.");
    return lines.join("\n");
  };

  const generate = async () => {
    const input = current.question?.trim() || ocrText.trim();
    if (!input) return;
    if (!ensureAgent("generator") || !ensureAgent("reviewer")) return;
    const maxReviewRounds = Math.max(1, defaults.maxReviewRounds || 3);
    setLlmStatusSource("generate");
    setGeneratorPreview("");
    setReviewerPreview("");
    setReviewIssues([]);
    setReviewAttempts(0);
    setReviewStatus(null);
    setForcedReviewAccept(false);
    const historyConversation = generatorHistory.map(
      ({ prompt, response, feedback }) => ({ prompt, response, feedback }),
    );
    const dynamicConversation: GeneratorConversationTurn[] = [];
    let workingProblem = current;
    try {
      for (let attempt = 1; attempt <= maxReviewRounds; attempt += 1) {
        const result = await generateProblemFromText(
          input,
          workingProblem,
          agents.generator,
          defaults,
          {
            onStatus: (s) => setLlmStatus(s),
            conversation: [...historyConversation, ...dynamicConversation],
          },
        );
        workingProblem = {
          ...workingProblem,
          ...result.patch,
        } as ProblemRecord;

        setLlmStatusSource("review");
        const review = await reviewGeneratedQuestion(
          {
            raw: result.raw,
            generatedBlock: result.generatedBlock,
            parsed: result.parsed,
            patch: result.patch,
            targetType: workingProblem.questionType,
          },
          agents.reviewer,
          { onStatus: (s) => setLlmStatus(s) },
        );

        setReviewerPreview(review.raw);
        setReviewIssues(review.issues);
        setReviewAttempts(attempt);
        setReviewStatus(review.status);

        const reviewPassed = review.status === "pass";
        const reachedLimit = attempt >= maxReviewRounds;
        const forced = !reviewPassed && reachedLimit;

        if (reviewPassed || reachedLimit) {
          update(result.patch);
          setGeneratorPreview(result.raw || "");
          setForcedReviewAccept(forced);
          setGeneratorHistory((prev) => [
            ...prev,
            {
              prompt: input,
              response: result.raw,
              feedback: undefined,
              patch: result.patch,
              timestamp: Date.now(),
              review: { ...review, attempts: attempt, forced },
            },
          ]);
          setLatestFeedback("");
          setFeedbackSavedAt(null);
          setLlmStatus("done");
          setLlmStatusSource(null);
          return;
        }

        const feedbackSummary = buildAutoReviewFeedback(
          review,
          attempt,
          maxReviewRounds,
        );
        dynamicConversation.push({
          prompt: input,
          response: result.raw,
          feedback: feedbackSummary,
        });
        setLlmStatusSource("generate");
      }
    } catch (err: any) {
      console.error("Generate with LLM failed:", err);
      const baseMessage = err?.message ? String(err.message) : String(err);
      const rawText = typeof err?.raw === "string" ? err.raw : "";
      const rawTrimmed = rawText.trim();
      const preview = rawTrimmed
        ? rawText
        : typeof err?.displayMessage === "string"
          ? err.displayMessage
          : baseMessage;
      setGeneratorPreview(preview);
      setReviewerPreview("");
      setReviewIssues([]);
      setReviewAttempts(0);
      setReviewStatus(null);
      setForcedReviewAccept(false);
      const alertMessage =
        typeof err?.displayMessage === "string"
          ? err.displayMessage
          : rawTrimmed
            ? `${baseMessage}\n\n${rawText}`
            : `Error: ${baseMessage}`;
      alert(alertMessage);
      setLlmStatus("idle");
      setLlmStatusSource(null);
    }
  };

  const handleSubmitFeedback = () => {
    const trimmed = latestFeedback.trim();
    if (generatorHistory.length === 0) {
      if (!trimmed) return;
      setGeneratorHistory((prev) => [
        ...prev,
        {
          prompt: "",
          response: "",
          feedback: trimmed,
          patch: {},
          timestamp: Date.now(),
        },
      ]);
    } else {
      setGeneratorHistory((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          feedback: trimmed.length > 0 ? trimmed : undefined,
        };
        return next;
      });
    }
    setLatestFeedback("");
    setFeedbackSavedAt(Date.now());
  };

  const buildQaContext = () => {
    const lines: string[] = [];
    lines.push("Context for the conversation (do not regenerate the problem):");
    lines.push(`Question Type: ${current.questionType}`);
    lines.push(`Subfield: ${current.subfield?.trim() || "<missing>"}`);
    lines.push(`Academic Level: ${current.academicLevel?.trim() || "<missing>"}`);
    lines.push(`Difficulty: ${current.difficulty?.trim() || "<missing>"}`);
    lines.push(`Source: ${current.source?.trim() || "<missing>"}`);
    lines.push("");
    lines.push("Question:");
    lines.push(current.question?.trim() || "<missing>");
    lines.push("");
    if (current.questionType === "Multiple Choice") {
      lines.push("Options:");
      (current.options || []).forEach((opt, idx) => {
        const label = String.fromCharCode(65 + idx);
        const value = opt?.trim() || "<empty>";
        lines.push(`${label}. ${value}`);
      });
      if (!current.options || current.options.length === 0) {
        lines.push("<no options provided>");
      }
      lines.push("");
    } else {
      lines.push("Options: (none)");
      lines.push("");
    }
    lines.push("Answer:");
    lines.push(current.answer?.trim() || "<missing>");
    lines.push("");
    lines.push("Important: respond in the same language as the user's next question. Do not rewrite the problem—only answer questions about it.");
    return lines.join("\n");
  };

  const clearQaConversation = () => {
    setQaConversation([]);
    setQaInput("");
    setQaStatus("idle");
    setQaError("");
  };

  const askQaAssistant = async () => {
    const trimmed = qaInput.trim();
    if (!trimmed) return;
    if (!ensureAgent("qa")) return;
    setQaError("");
    const contextBlock = buildQaContext();
    const systemPrompt = agents.qa.prompt?.trim() || "";
    setQaStatus("waiting_response");
    try {
      const historyMessages: ChatMessage[] = qaConversation.map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${contextBlock}`,
        },
        ...historyMessages,
        { role: "user", content: trimmed },
      ];
      const answer = await chatStream(
        messages,
        agents.qa.config,
        { temperature: 0 },
        { onStatus: (s) => setQaStatus(s) },
      );
      const now = Date.now();
      setQaConversation((prev) => [
        ...prev,
        { role: "user", content: trimmed, timestamp: now },
        { role: "assistant", content: answer, timestamp: now + 1 },
      ]);
      setQaInput("");
      setQaStatus("done");
    } catch (err: any) {
      const message = err?.message ? String(err.message) : String(err);
      setQaError(message);
      setQaStatus("idle");
    }
  };

  const loadLatexFrom = (field: "question" | "answer") => {
    if (field === "answer") {
      const snippet = buildOptionsAnswerSnippet(
        current.answer ?? "",
        current.options ?? [],
      );
      setLatexInput(snippet);
      return;
    }
    const text = (current as any)[field] as string;
    setLatexInput(text || "");
  };

  const clearLatexInput = () => {
    setLatexInput("");
  };

  const clearAttachedImage = () => {
    update({ image: "", imageDependency: 0 });
    setConfirmedImageUrl("");
  };

  const latexHasSource = latexInput.trim().length > 0;

  const fixLatexPreview = async () => {
    const source = latexInput.trim();
    if (!source) return;
    if (!ensureAgent("latex")) return;
    const previousRenderError = latexRenderError;
    setLatexRenderError("");
    setLlmStatusSource("latex_preview");
    try {
      const uniqueErrors =
        latexErrors.length > 0 ? Array.from(new Set(latexErrors)) : undefined;
      const fallbackReport =
        !uniqueErrors && previousRenderError
          ? [previousRenderError]
          : undefined;
      const payload = composeLatexCorrectionInput(
        source,
        uniqueErrors ?? fallbackReport,
        "MathJax preview panel",
      );
      const corrected = await latexCorrection(payload, agents.latex, {
        onStatus: (s) => setLlmStatus(s),
      });
      setLatexInput(corrected);
      setLatexErrors([]);
      setLatexRenderError("");
      setLlmStatus("done");
    } catch (error: any) {
      const message = error?.message ? String(error.message) : String(error);
      setLatexRenderError(message);
      setLlmStatus("idle");
      setLlmStatusSource(null);
    }
  };

  const runTranslation = async () => {
    const payload = translationInput.trim();
    if (!payload) {
      alert(t("translationInputMissing"));
      return;
    }
    if (!ensureAgent("translator")) return;
    setTranslationError("");
    setTranslationStatus("waiting_response");
    try {
      const output = await translateWithLLM(
        payload,
        translationTarget,
        agents.translator,
        { onStatus: (s) => setTranslationStatus(s) },
      );
      setTranslationOutput(output);
    } catch (err: any) {
      setTranslationError(String(err?.message || err));
    } finally {
      setTranslationStatus("done");
    }
  };

  const loadTranslationFrom = (field: "question" | "answer") => {
    const source = (current as any)[field] as string;
    setTranslationInput(source || "");
  };

  const ensureOptionsForMC = () => {
    if (current.questionType === "Multiple Choice") {
      const count = Math.max(2, defaults.optionsCount || 5);
      if (!current.options || current.options.length !== count) {
        const next = Array.from(
          { length: count },
          (_, i) => current.options?.[i] ?? "",
        );
        update({ options: next });
      }
    }
  };

  const combinedOptionsAndAnswerFilled = hasOptionsOrAnswerContent();

  useEffect(() => {
    ensureOptionsForMC();
  }, [current.questionType]);
  useEffect(() => {
    ensureOptionsForMC();
  }, [defaults.optionsCount]);

  // ----- Subfield helpers -----
  const selectedSubfields = useMemo(
    () => (current.subfield ? current.subfield.split(";").filter(Boolean) : []),
    [current.subfield],
  );
  const subfieldOptions = defaults.subfieldOptions;
  const sourceOptions = defaults.sourceOptions;
  const academicOptions = defaults.academicLevels;
  const difficultyOptions = defaults.difficultyOptions;
  const difficultyLabel = defaults.difficultyPrompt?.trim() || t("difficulty");
  const difficultyLabelDisplay =
    difficultyLabel === "Difficulty (1=easy, 3=hard)"
      ? t("difficulty")
      : difficultyLabel;
  const sourceSelectValue = sourceOptions.includes(current.source)
    ? current.source
    : CUSTOM_OPTION;
  const academicSelectOptions =
    academicOptions.includes(current.academicLevel) || !current.academicLevel
      ? academicOptions
      : [...academicOptions, current.academicLevel];
  const difficultySelectOptions =
    difficultyOptions.includes(current.difficulty) || !current.difficulty
      ? difficultyOptions
      : [...difficultyOptions, current.difficulty];
  const [showCustomSubfield, setShowCustomSubfield] = useState(false);
  const [customSubfield, setCustomSubfield] = useState("");
  const assistToolsHint = t("llmAssistGenerateHint");
  const imageCellValue = current.image?.trim()
    ? resolveImageFileName(current.image, `${current.id}.jpg`)
    : "-";
  const previewContent = useMemo(() => {
    const lines: string[] = [];
    lines.push(`${t("previewFieldId")}: ${current.id}`);
    lines.push(
      `${t("previewFieldQuestionType")}: ${current.questionType || "-"}`,
    );
    lines.push("");
    lines.push(`${t("previewFieldQuestion")}:`);
    lines.push(current.question?.trim() || "-");
    if (current.questionType === "Multiple Choice") {
      lines.push("");
      lines.push(`${t("previewFieldOptions")}:`);
      const optionCount = getOptionCount();
      const optionsList = Array.from(
        { length: optionCount },
        (_, idx) => current.options?.[idx] ?? "",
      );
      optionsList.forEach((opt, idx) => {
        const label = getOptionLabel(idx);
        const body = opt?.trim() ?? "";
        lines.push(body ? `${label}. ${body}` : `${label}.`);
      });
    }
    lines.push("");
    lines.push(`${t("previewFieldAnswer")}:`);
    lines.push(current.answer?.trim() || "-");
    lines.push("");
    const subfieldDisplay =
      selectedSubfields.length > 0
        ? selectedSubfields.join(", ")
        : current.subfield?.trim() || "-";
    lines.push(`${t("previewFieldSubfield")}: ${subfieldDisplay}`);
    lines.push(`${t("previewFieldSource")}: ${current.source?.trim() || "-"}`);
    lines.push(
      `${t("previewFieldAcademicLevel")}: ${current.academicLevel?.trim() || "-"}`,
    );
    lines.push(
      `${t("previewFieldDifficulty")}: ${current.difficulty?.trim() || "-"}`,
    );
    lines.push(`${t("previewFieldImage")}: ${imageCellValue || "-"}`);
    lines.push(
      `${t("previewImageDependency")}: ${typeof current.imageDependency === "number" ? current.imageDependency : 0}`,
    );
    return lines.join("\n");
  }, [
    t,
    current.id,
    current.question,
    current.questionType,
    current.options,
    current.answer,
    current.subfield,
    current.source,
    current.academicLevel,
    current.difficulty,
    current.imageDependency,
    selectedSubfields,
    imageCellValue,
    defaults.optionsCount,
  ]);

  useEffect(() => {
    const currentPath = current.image?.trim();
    if (!currentPath || !currentPath.startsWith("images/")) return;
    const ext = currentPath.includes(".")
      ? currentPath.substring(currentPath.lastIndexOf(".") + 1).toLowerCase()
      : "jpg";
    const normalizedExt = ext === "jpeg" ? "jpg" : ext;
    const desiredPath = `images/${current.id}.${normalizedExt}`;
    if (currentPath === desiredPath) return;
    let cancelled = false;
    (async () => {
      const blob = await getImageBlob(currentPath);
      if (!blob || cancelled) return;
      await saveImageBlobAtPath(desiredPath, blob);
      if (cancelled) return;
      update({ image: desiredPath });
    })();
    return () => {
      cancelled = true;
    };
  }, [current.image, current.id]);

  useEffect(() => {
    if (!showPreview) return;
    const container = previewContainerRef.current;
    if (!container) return;
    let cancelled = false;
    container.innerHTML = "";
    setPreviewMathJaxError("");
    if (!previewContent.trim()) {
      return () => {
        cancelled = true;
      };
    }
    container.textContent = previewContent;
    (async () => {
      try {
        const mj = await ensureMathJaxReady();
        mj.texReset?.();
        await mj.typesetPromise([container]);
        if (cancelled) return;
        const errors = Array.from(container.querySelectorAll("mjx-merror"))
          .map(
            (node) =>
              node.getAttribute("data-mjx-error") ||
              node.textContent?.trim() ||
              "",
          )
          .filter((text) => text.length > 0);
        if (errors.length > 0) {
          setPreviewMathJaxError(errors.join("; "));
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message ? String(error.message) : String(error);
        setPreviewMathJaxError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showPreview, previewContent]);

  const getMissingRequiredFields = (): string[] => {
    const missing: string[] = [];
    if (!current.question?.trim()) missing.push(t("problemText"));
    if (!current.questionType?.trim()) missing.push(t("targetType"));
    if (!current.answer?.trim()) missing.push(t("answer"));
    if (selectedSubfields.length === 0) missing.push(t("subfield"));
    if (!current.source?.trim()) missing.push(t("source"));
    if (!current.academicLevel?.trim()) missing.push(t("academic"));
    if (!current.difficulty?.trim()) missing.push(difficultyLabelDisplay);
    if (current.questionType === "Multiple Choice") {
      const optionCount = Math.max(
        2,
        defaults.optionsCount || (current.options?.length ?? 0) || 0,
      );
      const options = Array.from({ length: optionCount }, (_, i) =>
        (current.options?.[i] ?? "").trim(),
      );
      if (options.some((opt) => !opt)) missing.push(t("options"));
    }
    return missing;
  };

  const ensureRequiredBeforeProceed = () => {
    const missing = Array.from(new Set(getMissingRequiredFields()));
    if (missing.length === 0) return true;
    const message = t("requiredMissing", { fields: missing.join(", ") });
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
    update({ subfield: Array.from(set).join(";") });
  };
  const removeSubfield = (value: string) => {
    const next = selectedSubfields.filter((s) => s !== value);
    update({ subfield: next.join(";") });
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
    setCustomSubfield("");
    setShowCustomSubfield(false);
  };

  if (showPreview) {
    return (
      <div>
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                setPreviewMathJaxError("");
                setShowPreview(false);
              }}
            >
              {t("back")}
            </button>
            <button onClick={goPrev} disabled={!hasPrev}>
              {t("prev")}
            </button>
            <button onClick={goNext}>{t("next")}</button>
          </div>
          <span className="small">
            {t("previewFieldId")}: {current.id}
          </span>
        </div>

        <hr className="div" style={{ margin: "12px 0" }} />

        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div
            className="label"
            style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600 }}
          >
            {t("previewTitle")}
          </div>
          <div
            ref={previewContainerRef}
            style={{
              padding: 16,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface-subtle)",
              minHeight: 200,
              whiteSpace: "pre-wrap",
            }}
          />
          {previewMathJaxError ? (
            <span className="small" style={{ color: "#f87171" }}>
              {t("mathJaxPreviewError", { error: previewMathJaxError })}
            </span>
          ) : !previewContent.trim() ? (
            <span className="small" style={{ color: "var(--text-muted)" }}>
              {t("previewEmpty")}
            </span>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="label" style={{ margin: 0 }}>
              {t("previewImageSection")}
            </div>
            <div
              className="row"
              style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}
            >
              <span className="small">
                {t("previewImageDependency")}:{" "}
                {typeof current.imageDependency === "number"
                  ? current.imageDependency
                  : 0}
              </span>
              <span className="small">
                {t("previewFieldImage")}: {imageCellValue}
              </span>
            </div>
            {current.image?.trim() ? (
              confirmedImageUrl ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <img
                    src={confirmedImageUrl}
                    style={{
                      maxWidth: "100%",
                      maxHeight: 240,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      objectFit: "contain",
                    }}
                    alt={`${t("previewFieldImage")}: ${imageCellValue}`}
                  />
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button onClick={() => openViewer(confirmedImageUrl)}>
                      {t("viewLarge")}
                    </button>
                  </div>
                </div>
              ) : (
                <span className="small" style={{ color: "var(--text-muted)" }}>
                  {t("previewImageLoading")}
                </span>
              )
            ) : (
              <span className="small" style={{ color: "var(--text-muted)" }}>
                {t("previewImageNone")}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button onClick={handleSaveCurrent}>{t("saveProblem")}</button>
          <button
            onClick={() => {
              setPreviewMathJaxError("");
              setShowPreview(true);
            }}
          >
            {t("previewProblem")}
          </button>
        </div>
        <div
          className="row"
          style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <button onClick={goPrev} disabled={!hasPrev}>
            {t("prev")}
          </button>
          <button onClick={goNext}>{t("next")}</button>
          <span className="small">ID: {current.id}</span>
          {savedAt && <span className="badge">{t("saved")}</span>}
        </div>
      </div>

      <div
        className="small"
        style={{ marginTop: 8, color: "var(--text-muted)" }}
      >
        {t("requiredMarkNote")}
      </div>

      <hr className="div" />

      <div className="grid grid-2">
        <div>
          <div
            className="card"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <div
                className="label"
                style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600 }}
              >
                {t("questionInfoTitle")}
              </div>
            </div>
            <div>
              <div className="label">
                {t("problemText")}
                <span style={{ color: "#f97316", marginLeft: 4 }}>*</span>
              </div>
              <textarea
                value={current.question}
                onChange={(e) => update({ question: e.target.value })}
                onPaste={handleOcrPaste}
              />
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <button onClick={() => fixLatex("question")}>
                    {t("latexFix")}
                  </button>
                  {llmStatusSource === "latex_question" &&
                    llmStatus !== "idle" &&
                    llmStatus !== "done" && (
                      <span className="small">
                        {llmStatus === "waiting_response"
                          ? t("waitingLLMResponse")
                          : t("waitingLLMThinking")}
                        {dotPattern}
                      </span>
                    )}
                </div>
                <span className="small">{t("latexFixHint")}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="small" style={{ color: "var(--text-muted)" }}>
                  {t("mathJaxPreviewLabel")}
                </div>
                <div
                  ref={questionPreviewRef}
                  style={{
                    marginTop: 4,
                    padding: 12,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface-subtle)",
                    minHeight: 48,
                    whiteSpace: "pre-wrap",
                  }}
                />
                {questionMathJaxError ? (
                  <span
                    className="small"
                    style={{ color: "#f87171", display: "block", marginTop: 4 }}
                  >
                    {t("mathJaxPreviewError", { error: questionMathJaxError })}
                  </span>
                ) : !current.question?.trim() ? (
                  <span
                    className="small"
                    style={{
                      color: "var(--text-muted)",
                      display: "block",
                      marginTop: 4,
                    }}
                  >
                    {t("mathJaxPreviewEmpty")}
                  </span>
                ) : null}
              </div>
            </div>

            <div>
              <div className="label">
                {t("targetType")}
                <span style={{ color: "#f97316", marginLeft: 4 }}>*</span>
              </div>
              <select
                value={current.questionType}
                onChange={(e) =>
                  update({ questionType: e.target.value as any })
                }
              >
                <option value="Multiple Choice">{t("type_mc")}</option>
                <option value="Fill-in-the-blank">{t("type_fitb")}</option>
                <option value="Proof">{t("type_proof")}</option>
              </select>
              <div className="small" style={{ marginTop: 6 }}>
                {t("type_hint")}
              </div>
            </div>

            {current.questionType === "Multiple Choice" && (
              <div>
                <div className="label">
                  {t("options")}
                  <span style={{ color: "#f97316", marginLeft: 4 }}>*</span>
                </div>
                <div className="options-grid">
                  {Array.from({
                    length: Math.max(
                      2,
                      defaults.optionsCount || current.options.length || 5,
                    ),
                  }).map((_, idx) => (
                    <input
                      key={idx}
                      value={current.options[idx] || ""}
                      onChange={(e) => {
                        const next = [...(current.options || [])];
                        next[idx] = e.target.value;
                        update({ options: next });
                      }}
                      placeholder={String.fromCharCode(65 + idx)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="label">
                {t("answer")}
                <span style={{ color: "#f97316", marginLeft: 4 }}>*</span>
              </div>
              <textarea
                value={current.answer}
                onChange={(e) => update({ answer: e.target.value })}
              />
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <button
                    onClick={() => fixLatex("answer")}
                    disabled={!combinedOptionsAndAnswerFilled}
                  >
                    {t("latexFix")}
                  </button>
                  {llmStatusSource === "latex_answer" &&
                    llmStatus !== "idle" &&
                    llmStatus !== "done" && (
                      <span className="small">
                        {llmStatus === "waiting_response"
                          ? t("waitingLLMResponse")
                          : t("waitingLLMThinking")}
                        {dotPattern}
                      </span>
                    )}
                </div>
                <span className="small">{t("latexFixHint")}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="small" style={{ color: "var(--text-muted)" }}>
                  {t("mathJaxPreviewLabel")}
                </div>
                <div
                  ref={answerPreviewRef}
                  style={{
                    marginTop: 4,
                    padding: 12,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface-subtle)",
                    minHeight: 48,
                    whiteSpace: "pre-wrap",
                  }}
                />
                {answerMathJaxError ? (
                  <span
                    className="small"
                    style={{ color: "#f87171", display: "block", marginTop: 4 }}
                  >
                    {t("mathJaxPreviewError", { error: answerMathJaxError })}
                  </span>
                ) : !combinedOptionsAndAnswerFilled ? (
                  <span
                    className="small"
                    style={{
                      color: "var(--text-muted)",
                      display: "block",
                      marginTop: 4,
                    }}
                  >
                    {t("mathJaxPreviewEmpty")}
                  </span>
                ) : null}
              </div>
            </div>
            <div>
              <div className="label">
                {t("subfield")}
                <span style={{ color: "#f97316", marginLeft: 4 }}>*</span>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <select
                  onChange={(e) => {
                    onSelectSubfield(e.target.value);
                    (e.target as HTMLSelectElement).value = "";
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    --
                  </option>
                  {subfieldOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION}>{t("subfield_others")}</option>
                </select>
                {showCustomSubfield && (
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      ref={customSubfieldInputRef}
                      value={customSubfield}
                      placeholder={t("subfield_others")}
                      onChange={(e) => setCustomSubfield(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmCustomSubfield();
                      }}
                    />
                    <button onClick={confirmCustomSubfield}>
                      {t("confirmText")}
                    </button>
                  </div>
                )}
                {selectedSubfields.length > 0 && (
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {selectedSubfields.map((s) => (
                      <span
                        key={s}
                        className="badge"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {s}
                        <button
                          onClick={() => removeSubfield(s)}
                          style={{ padding: "0 6px" }}
                          aria-label={t("defaultsRemoveItem", { item: s })}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="row" style={{ gap: 8, width: "100%" }}>
                  <span className="small">{t("resultLabel")}:</span>
                  <input
                    style={{ flex: 1, minWidth: 0 }}
                    value={current.subfield}
                    readOnly
                  />
                </div>
                <span className="small">{t("selectSubfieldHint")}</span>
              </div>
            </div>

            <div>
              <div className="label">
                {t("source")}
                <span style={{ color: "#f97316", marginLeft: 4 }}>*</span>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <select
                  value={sourceSelectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === CUSTOM_OPTION) {
                      update({ source: "" });
                      setTimeout(
                        () => customSourceInputRef.current?.focus(),
                        0,
                      );
                    } else {
                      update({ source: v });
                    }
                  }}
                >
                  {sourceOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION}>{t("subfield_others")}</option>
                </select>
                <input
                  ref={customSourceInputRef}
                  placeholder={t("subfield_others")}
                  value={current.source}
                  onChange={(e) => update({ source: e.target.value })}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </div>
            </div>

            <div
              className="grid"
              style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}
            >
              <div>
                <div className="label">
                  {t("academic")}
                  <span style={{ color: "#f97316", marginLeft: 4 }}>*</span>
                </div>
                <select
                  value={current.academicLevel}
                  onChange={(e) => update({ academicLevel: e.target.value })}
                >
                  {academicSelectOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="label">
                  {difficultyLabelDisplay}
                  <span style={{ color: "#f97316", marginLeft: 4 }}>*</span>
                </div>
                <select
                  value={current.difficulty}
                  onChange={(e) => update({ difficulty: e.target.value })}
                >
                  {difficultySelectOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div
                className="row"
                style={{ alignItems: "flex-end", justifyContent: "flex-end" }}
              >
                {/* intentionally left blank to balance layout */}
              </div>
            </div>
          </div>
        </div>

        <div>
          {confirmedImageUrl && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div
                className="row"
                style={{
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span className="badge">{t("imageAttached")}</span>
                  <span className="small">{t("imageDependencyLabel")}</span>
                </div>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <button onClick={() => openViewer(confirmedImageUrl)}>
                    {t("viewLarge")}
                  </button>
                  <button
                    onClick={clearAttachedImage}
                    aria-label={t("clearImageAttachment")}
                  >
                    {t("clearImageAttachment")}
                  </button>
                </div>
              </div>
              <img
                src={confirmedImageUrl}
                style={{
                  maxWidth: "100%",
                  maxHeight: 200,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  marginTop: 8,
                }}
              />
            </div>
          )}
          <div
            className="card"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div>
              <div
                className="label"
                style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600 }}
              >
                {t("assistToolsTitle")}
              </div>
              {assistToolsHint && assistToolsHint.trim().length > 0 && (
                <div
                  className="small"
                  style={{ marginTop: 6, color: "var(--text-muted)" }}
                >
                  {assistToolsHint}
                </div>
              )}
            </div>

            <div>
              <div
                className="label"
                style={{ marginBottom: 4, fontSize: "1.05rem", fontWeight: 600 }}
              >
                {t("assistToolGenerator")}
              </div>
              <div className="small" style={{ color: "var(--text-muted)" }}>
                {t("assistToolGeneratorHint")}
              </div>
              <div
                className="row"
                style={{
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <button className="primary" onClick={generate}>
                  {t("assistToolGeneratorAction")}
                </button>
                {isGeneratorBusy && (
                  <span className="small">
                    {t("llmGeneratorInProgress")}
                    {dotPattern}
                  </span>
                )}
                {!isGeneratorBusy && isReviewerBusy && (
                  <span className="small">
                    {t("llmReviewerInProgress")}
                    {dotPattern}
                  </span>
                )}
              </div>
              {generatorPreview && (
                <div style={{ marginTop: 8 }}>
                  <div className="label" style={{ marginBottom: 4 }}>
                    {t("llmReply")}
                  </div>
                  <textarea
                    readOnly
                    value={generatorPreview}
                    rows={8}
                    style={{
                      width: "100%",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  />
                </div>
              )}
              {(reviewStatus !== null || reviewerPreview) && (
                <div style={{ marginTop: 12 }}>
                  <div className="label" style={{ marginBottom: 4 }}>
                    {t("reviewerReply")}
                  </div>
                  {reviewerPreview ? (
                    <textarea
                      readOnly
                      value={reviewerPreview}
                      rows={6}
                      style={{
                        width: "100%",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    />
                  ) : null}
                  {reviewStatus !== null && (
                    <div className="small" style={{ marginTop: 4 }}>
                      <strong>{t("reviewerStatusLabel")}:</strong>{" "}
                      {reviewStatus === "pass"
                        ? t("reviewerStatusPass")
                        : t("reviewerStatusFail")}
                    </div>
                  )}
                  {reviewAttempts > 0 && (
                    <div className="small">
                      {t("reviewerAttemptsLabel", { count: reviewAttempts })}
                    </div>
                  )}
                  {reviewIssues.length > 0 ? (
                    <div className="small" style={{ marginTop: 4 }}>
                      <div style={{ fontWeight: 600 }}>
                        {t("reviewerIssuesLabel")}
                      </div>
                      <ul style={{ margin: "4px 0 0 16px" }}>
                        {reviewIssues.map((issue, idx) => (
                          <li key={idx}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  ) : reviewStatus === "pass" ? (
                    <div
                      className="small"
                      style={{ marginTop: 4, color: "var(--text-muted)" }}
                    >
                      {t("reviewerNoIssues")}
                    </div>
                  ) : null}
                  {forcedReviewAccept && (
                    <div
                      className="small"
                      style={{ marginTop: 4, color: "#f97316" }}
                    >
                      {t("reviewerForcedAcceptNotice", {
                        count: defaults.maxReviewRounds || 3,
                      })}
                    </div>
                  )}
                </div>
              )}
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>
                    {t("llmConversationHistory")}
                  </div>
                  <div
                    className="small"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {generatorHistory.length > 0
                      ? t("llmConversationHistoryHint")
                      : t("llmConversationHistoryEmpty")}
                  </div>
                </div>
                {generatorHistory.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      maxHeight: 220,
                      overflowY: "auto",
                    }}
                  >
                    {generatorHistory.map((turn, idx) => (
                      <div
                        key={turn.timestamp}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: 8,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div className="small" style={{ fontWeight: 600 }}>
                          {t("llmTurnLabel", { index: idx + 1 })}
                        </div>
                        <div
                          className="small"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          <strong>{t("llmPromptLabel")}:</strong>{" "}
                          {turn.prompt || t("llmEmptyValue")}
                        </div>
                        <div
                          className="small"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          <strong>{t("llmResponseLabel")}:</strong>{" "}
                          {turn.response || t("llmEmptyValue")}
                        </div>
                        <div
                          className="small"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          <strong>{t("llmUserFeedbackLabel")}:</strong>{" "}
                          {turn.feedback || t("llmEmptyValue")}
                        </div>
                        {turn.review && (
                          <div
                            className="small"
                            style={{ whiteSpace: "pre-wrap" }}
                          >
                            <strong>{t("reviewerStatusLabel")}:</strong>{" "}
                            {turn.review.status === "pass"
                              ? t("reviewerStatusPass")
                              : t("reviewerStatusFail")}{" "}
                            (
                            {t("reviewerAttemptsLabel", {
                              count: turn.review.attempts,
                            })}
                            )
                            {turn.review.forced && (
                              <span style={{ color: "#f97316", marginLeft: 6 }}>
                                {t("reviewerForcedAcceptShort")}
                              </span>
                            )}
                            {turn.review.issues.length > 0 && (
                              <ul style={{ margin: "4px 0 0 16px" }}>
                                {turn.review.issues.map((issue, idx) => (
                                  <li key={idx}>{issue}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="small"
                    style={{
                      border: "1px dashed var(--border)",
                      borderRadius: 8,
                      padding: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    {t("llmConversationHistoryEmpty")}
                  </div>
                )}
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>
                    {t("llmUserFeedbackLabel")}
                  </div>
                  <textarea
                    value={latestFeedback}
                    onChange={(e) => setLatestFeedback(e.target.value)}
                    rows={3}
                    placeholder={t("llmFeedbackPlaceholder")}
                  />
                  <div
                    className="row"
                    style={{
                      justifyContent: "flex-end",
                      gap: 8,
                      alignItems: "center",
                      marginTop: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={handleSubmitFeedback}
                      disabled={
                        generatorHistory.length === 0 &&
                        latestFeedback.trim().length === 0
                      }
                    >
                      {t("llmSubmitFeedback")}
                    </button>
                    {feedbackSavedAt && (
                      <span
                        className="small"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {t("saved")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <hr className="div" style={{ margin: "12px 0" }} />
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div
                    className="label"
                    style={{
                      marginBottom: 4,
                      fontSize: "1.05rem",
                      fontWeight: 600,
                    }}
                  >
                    {t("qaAssistantTitle")}
                  </div>
                  <div
                    className="small"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t("qaAssistantHint")}
                  </div>
                </div>
                <div
                  className="row"
                  style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}
                >
                  <button
                    type="button"
                    onClick={clearQaConversation}
                    disabled={
                      qaConversation.length === 0 && qaInput.trim().length === 0
                    }
                  >
                    {t("qaAssistantClear")}
                  </button>
                  {qaStatus !== "idle" && qaStatus !== "done" && (
                    <span className="small">
                      {t("waitingLLMResponse")}
                      {dotPattern}
                    </span>
                  )}
                </div>
              </div>
              {qaConversation.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxHeight: 220,
                    overflowY: "auto",
                  }}
                >
                  {qaConversation.map((turn) => (
                    <div
                      key={turn.timestamp}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 8,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div className="small" style={{ fontWeight: 600 }}>
                        {turn.role === "user"
                          ? t("qaAssistantUserLabel")
                          : t("qaAssistantAgentLabel")}
                      </div>
                      <div
                        className="small"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {turn.content}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="small"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("qaAssistantEmpty")}
                </div>
              )}
              {qaError && (
                <span className="small" style={{ color: "#f87171" }}>
                  {t("qaAssistantError", { message: qaError })}
                </span>
              )}
              <textarea
                value={qaInput}
                onChange={(e) => setQaInput(e.target.value)}
                rows={3}
                placeholder={t("qaAssistantInputPlaceholder")}
              />
              <div
                className="row"
                style={{
                  justifyContent: "flex-end",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="primary"
                  onClick={askQaAssistant}
                  disabled={
                    qaInput.trim().length === 0 ||
                    qaStatus === "waiting_response" ||
                    qaStatus === "thinking" ||
                    qaStatus === "responding"
                  }
                >
                  {t("qaAssistantSend")}
                </button>
              </div>
            </div>
            <hr className="div" style={{ margin: "12px 0" }} />
            <div>
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div
                  className="label"
                  style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}
                >
                  {t("assistToolTranslation")}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => loadTranslationFrom("question")}
                  >
                    {t("translationLoadQuestion")}
                  </button>
                  <button
                    type="button"
                    onClick={() => loadTranslationFrom("answer")}
                  >
                    {t("translationLoadAnswer")}
                  </button>
                  <select
                    value={translationTarget}
                    onChange={(e) =>
                      setTranslationTarget(e.target.value as "en" | "zh")
                    }
                  >
                    <option value="zh">{t("translationTargetZh")}</option>
                    <option value="en">{t("translationTargetEn")}</option>
                  </select>
                  <div className="row" style={{ gap: 6, alignItems: "center" }}>
                    <button
                      type="button"
                      className="primary"
                      onClick={runTranslation}
                    >
                      {t("translationRun")}
                    </button>
                    {translationStatus !== "idle" &&
                      translationStatus !== "done" && (
                        <span className="small">
                          {translationStatus === "waiting_response"
                            ? t("waitingLLMResponse")
                            : t("waitingLLMThinking")}
                          {dotPattern}
                        </span>
                      )}
                  </div>
                </div>
              </div>
              {translationError && (
                <span className="small" style={{ color: "#f87171" }}>
                  {translationError}
                </span>
              )}
              <div
                className="grid"
                style={{ gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}
              >
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>
                    {t("translationInputLabel")}
                  </div>
                  <textarea
                    value={translationInput}
                    onChange={(e) => setTranslationInput(e.target.value)}
                    rows={6}
                  />
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>
                    {t("translationOutputLabel")}
                  </div>
                  <textarea
                    value={translationOutput}
                    onChange={(e) => setTranslationOutput(e.target.value)}
                    rows={6}
                  />
                </div>
              </div>
              <div
                className="row"
                style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}
              >
                <button
                  type="button"
                  onClick={() =>
                    translationOutput && update({ question: translationOutput })
                  }
                >
                  {t("translationApplyQuestion")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    translationOutput && update({ answer: translationOutput })
                  }
                >
                  {t("translationApplyAnswer")}
                </button>
              </div>
            </div>
            <hr className="div" style={{ margin: "12px 0" }} />
            <div>
              <div
                className="label"
                style={{ marginBottom: 4, fontSize: "1.05rem", fontWeight: 600 }}
              >
                {t("assistToolLatex")}
              </div>
              <div className="small" style={{ color: "var(--text-muted)" }}>
                {t("assistToolLatexHint")}
              </div>
              <div
                className="row"
                style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}
              >
                <button type="button" onClick={() => loadLatexFrom("question")}>
                  {t("assistToolLatexLoadQuestion")}
                </button>
                <button type="button" onClick={() => loadLatexFrom("answer")}>
                  {t("assistToolLatexLoadAnswer")}
                </button>
                <button
                  type="button"
                  onClick={clearLatexInput}
                  disabled={!latexHasSource}
                >
                  {t("assistToolLatexClear")}
                </button>
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={fixLatexPreview}
                    disabled={!latexHasSource}
                  >
                    {t("assistToolLatexFix")}
                  </button>
                  {llmStatusSource === "latex_preview" &&
                    llmStatus !== "idle" &&
                    llmStatus !== "done" && (
                      <span className="small">
                        {llmStatus === "waiting_response"
                          ? t("waitingLLMResponse")
                          : t("waitingLLMThinking")}
                        {dotPattern}
                      </span>
                    )}
                </div>
              </div>
              <textarea
                value={latexInput}
                onChange={(e) => setLatexInput(e.target.value)}
                rows={6}
                placeholder={t("assistToolLatexPlaceholder")}
                style={{
                  marginTop: 8,
                  fontFamily: "var(--font-mono, monospace)",
                }}
              />
              {latexRenderError && (
                <span className="small" style={{ color: "#f87171" }}>
                  {t("assistToolLatexRenderError", { error: latexRenderError })}
                </span>
              )}
              {latexErrors.length > 0 && (
                <div className="small" style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 600 }}>
                    {t("assistToolLatexErrorsTitle")}
                  </div>
                  <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                    {latexErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              {latexHasSource &&
                !latexRenderError &&
                latexErrors.length === 0 && (
                  <span
                    className="small"
                    style={{
                      color: "var(--text-muted)",
                      display: "block",
                      marginTop: 8,
                    }}
                  >
                    {t("assistToolLatexNoIssues")}
                  </span>
                )}
              {latexHasSource && (
                <div
                  ref={latexPreviewRef}
                  style={{
                    marginTop: 8,
                    padding: 12,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface-subtle)",
                    minHeight: 48,
                    whiteSpace: "pre-wrap",
                  }}
                />
              )}
            </div>
            <hr className="div" style={{ margin: "12px 0" }} />
            <div>
              <div
                className="label"
                style={{ marginBottom: 4, fontSize: "1.05rem", fontWeight: 600 }}
              >
                {t("assistToolOcr")}
              </div>
              <div className="small" style={{ color: "var(--text-muted)" }}>
                {t("uploadImage")}
              </div>
              <div
                className="dropzone"
                tabIndex={0}
                role="button"
                onDrop={handleOcrDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onPaste={handleOcrPaste}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOcrPasteActive(true);
                  setOcrContextMenu({ x: e.clientX, y: e.clientY });
                }}
                onMouseEnter={() => setOcrPasteActive(true)}
                onMouseLeave={() => setOcrPasteActive(false)}
                onFocus={() => setOcrPasteActive(true)}
                onFocusCapture={() => setOcrPasteActive(true)}
                onBlur={() => setOcrPasteActive(false)}
                onBlurCapture={() => setOcrPasteActive(false)}
              >
                <div
                  className="row"
                  style={{ justifyContent: "center", gap: 8, flexWrap: "wrap" }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    ref={ocrFileInputRef}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) await onAddOcrImage(file);
                      e.target.value = "";
                    }}
                  />
                  <button onClick={() => ocrFileInputRef.current?.click()}>
                    {t("browse")}
                  </button>
                </div>
                <div
                  className="row"
                  style={{
                    justifyContent: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 8,
                  }}
                >
                  <span className="small">{t("dragDropOrPaste")}</span>
                  <span className="small">{t("rightClickForPaste")}</span>
                  {ocrDisplayName && (
                    <span className="small">
                      {t("generatedNameLabel")}: {ocrDisplayName}
                    </span>
                  )}
                </div>
              </div>
              {ocrContextMenu && (
                <div
                  style={{
                    position: "fixed",
                    top: ocrContextMenu.y,
                    left: ocrContextMenu.x,
                    zIndex: 9999,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.18)",
                    padding: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    onClick={async (event) => {
                      event.stopPropagation();
                      try {
                        const files = await readClipboardFiles((mime) =>
                          mime.startsWith("image/"),
                        );
                        if (!files.length) {
                          alert(t("noFilesFromClipboard"));
                        } else {
                          await onAddOcrImage(files[0]);
                        }
                      } catch (error) {
                        handleOcrClipboardError(error);
                      } finally {
                        setOcrContextMenu(null);
                      }
                    }}
                  >
                    {t("pasteFromClipboard")}
                  </button>
                </div>
              )}
              {ocrPreviewUrl && (
                <div style={{ marginTop: 8 }}>
                  <div
                    className="row"
                    style={{ justifyContent: "flex-end", marginBottom: 6 }}
                  >
                    <button onClick={() => openViewer(ocrPreviewUrl)}>
                      {t("viewLarge")}
                    </button>
                  </div>
                  <img className="preview" src={ocrPreviewUrl} />
                </div>
              )}

              <div
                className="row"
                style={{ marginTop: 8, gap: 8, alignItems: "center" }}
              >
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <button onClick={runOCR}>{t("ocrExtract")}</button>
                  {llmStatusSource === "ocr" &&
                    llmStatus !== "idle" &&
                    llmStatus !== "done" && (
                      <span className="small">
                        {llmStatus === "waiting_response"
                          ? t("waitingLLMResponse")
                          : t("waitingLLMThinking")}
                        {dotPattern}
                      </span>
                    )}
                </div>
                <button onClick={applyOcrText}>{t("confirmText")}</button>
              </div>
              {ocrText && (
                <textarea
                  style={{ marginTop: 8 }}
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                />
              )}
            </div>
          </div>

          <div
            className="row"
            style={{
              alignItems: "flex-end",
              justifyContent: "flex-end",
              marginTop: 12,
            }}
          >
            <button onClick={() => onOpenClear && onOpenClear()}>
              {t("clearBank")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
