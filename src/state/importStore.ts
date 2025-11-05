import { create } from 'zustand';
import type { ProblemRecord } from './store';

export type StepStatus = 'idle' | 'processing' | 'completed' | 'error';

export interface PdfPageMeta {
  id: string;
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  dpi: number;
  dataUrl: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CoarseBlockStatus = 'pending' | 'processing' | 'completed' | 'skipped' | 'error';

export interface CoarseBlock {
  id: string;
  pageId: string;
  pageNumber: number;
  index: number;
  rect: Rect;
  text: string;
  stats: {
    lineCount: number;
    textLength: number;
  };
  status: CoarseBlockStatus;
  skipReason?: string;
  errorMessage?: string;
  requiresOcr?: boolean;
  sourceImage?: string;
  extractedText?: string;
}

export interface DetailedCandidate {
  id: string;
  blockId: string;
  pageId: string;
  pageNumber: number;
  index: number;
  text: string;
  classification: string;
  hasImage: boolean;
  confidence: number;
  skipReason?: string;
  notes?: string;
}

export type RewriteStatus = 'pending' | 'processing' | 'converted' | 'skipped' | 'error';

export interface RewriteResult {
  id: string;
  blockId: string;
  pageId: string;
  candidateIds: string[];
  chosenCandidateId: string | null;
  status: RewriteStatus;
  patch?: Partial<ProblemRecord>;
  raw?: string;
  reason?: string;
  message?: string;
  accepted?: boolean;
  createdAt: number;
}

export interface ImportSettings {
  concurrency: number;
  topK: number;
  targetQuestionType: ProblemRecord['questionType'];
  minConfidence: number;
}

export interface ImportState {
  pdfMeta: { name: string; pageCount: number } | null;
  pages: PdfPageMeta[];
  coarseBlocks: CoarseBlock[];
  detailedCandidates: DetailedCandidate[];
  rewriteResults: RewriteResult[];
  reviewCursor: number;
  stepStatus: {
    coarse: StepStatus;
    detailed: StepStatus;
    rewrite: StepStatus;
  };
  settings: ImportSettings;
  error?: string;
  isBusy: boolean;
  setSettings: (patch: Partial<ImportSettings>) => void;
  reset: () => void;
  setPdfMeta: (meta: { name: string; pageCount: number } | null) => void;
  setPages: (pages: PdfPageMeta[]) => void;
  setCoarseBlocks: (blocks: CoarseBlock[]) => void;
  patchCoarseBlock: (blockId: string, patch: Partial<CoarseBlock>) => void;
  upsertDetailedCandidates: (blockId: string, candidates: DetailedCandidate[]) => void;
  setDetailedCandidatesBulk: (candidates: DetailedCandidate[]) => void;
  upsertRewriteResult: (result: RewriteResult) => void;
  patchRewriteResult: (rewriteId: string, patch: Partial<RewriteResult>) => void;
  markAccepted: (rewriteId: string) => void;
  setReviewCursor: (index: number) => void;
  setStepStatus: (step: keyof ImportState['stepStatus'], status: StepStatus) => void;
  setError: (error?: string) => void;
  setBusy: (busy: boolean) => void;
}

const initialSettings: ImportSettings = {
  concurrency: 3,
  topK: 3,
  targetQuestionType: 'Multiple Choice',
  minConfidence: 0.45
};

const initialState = (): Omit<ImportState, 'setSettings' | 'reset' | 'setPdfMeta' | 'setPages' | 'setCoarseBlocks' | 'patchCoarseBlock' | 'upsertDetailedCandidates' | 'setDetailedCandidatesBulk' | 'upsertRewriteResult' | 'patchRewriteResult' | 'markAccepted' | 'setReviewCursor' | 'setStepStatus' | 'setError' | 'setBusy'> => ({
  pdfMeta: null,
  pages: [],
  coarseBlocks: [],
  detailedCandidates: [],
  rewriteResults: [],
  reviewCursor: 0,
  stepStatus: {
    coarse: 'idle',
    detailed: 'idle',
    rewrite: 'idle'
  },
  settings: initialSettings,
  error: undefined,
  isBusy: false
});

export const useImportStore = create<ImportState>((set, get) => ({
  ...initialState(),
  setSettings: (patch) => {
    set((state) => ({
      settings: {
        ...state.settings,
        ...patch,
        concurrency: patch.concurrency ? Math.max(1, Math.floor(patch.concurrency)) : state.settings.concurrency,
        topK: patch.topK ? Math.max(1, Math.floor(patch.topK)) : state.settings.topK,
        minConfidence: typeof patch.minConfidence === 'number'
          ? Math.min(1, Math.max(0, patch.minConfidence))
          : state.settings.minConfidence
      }
    }));
  },
  reset: () => {
    set({ ...initialState(), settings: { ...initialSettings } });
  },
  setPdfMeta: (meta) => set({ pdfMeta: meta }),
  setPages: (pages) => set({ pages: [...pages] }),
  setCoarseBlocks: (blocks) => set({ coarseBlocks: [...blocks] }),
  patchCoarseBlock: (blockId, patch) => {
    set((state) => ({
      coarseBlocks: state.coarseBlocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block))
    }));
  },
  upsertDetailedCandidates: (blockId, candidates) => {
    set((state) => {
      const filtered = state.detailedCandidates.filter((candidate) => candidate.blockId !== blockId);
      return { detailedCandidates: [...filtered, ...candidates] };
    });
  },
  setDetailedCandidatesBulk: (candidates) => set({ detailedCandidates: [...candidates] }),
  upsertRewriteResult: (result) => {
    set((state) => {
      const exists = state.rewriteResults.find((entry) => entry.id === result.id);
      if (exists) {
        return {
          rewriteResults: state.rewriteResults.map((entry) => (entry.id === result.id ? { ...entry, ...result } : entry))
        };
      }
      return {
        rewriteResults: [...state.rewriteResults, result]
      };
    });
  },
  patchRewriteResult: (rewriteId, patch) => {
    set((state) => ({
      rewriteResults: state.rewriteResults.map((entry) => (entry.id === rewriteId ? { ...entry, ...patch } : entry))
    }));
  },
  markAccepted: (rewriteId) => {
    set((state) => ({
      rewriteResults: state.rewriteResults.map((entry) => (entry.id === rewriteId ? { ...entry, accepted: true } : entry))
    }));
  },
  setReviewCursor: (index) => {
    const { rewriteResults } = get();
    const maxIndex = rewriteResults.length > 0 ? rewriteResults.length - 1 : 0;
    const next = Math.max(0, Math.min(index, maxIndex));
    set({ reviewCursor: next });
  },
  setStepStatus: (step, status) => {
    set((state) => ({
      stepStatus: {
        ...state.stepStatus,
        [step]: status
      }
    }));
  },
  setError: (error) => set({ error }),
  setBusy: (busy) => set({ isBusy: busy })
}));
