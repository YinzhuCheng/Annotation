import { create } from 'zustand';
import { normalizeImagePath } from '../lib/fileHelpers';

export type Mode = 'manual' | 'agent';

export interface LLMConfigState {
  provider: 'openai' | 'gemini' | 'claude';
  apiKey: string;
  baseUrl: string; // for openai-compatible
  model: string;
}

export type AgentId = 'ocr' | 'latex' | 'generator' | 'reviewer' | 'translator' | 'qa';

export interface LLMAgentSettings {
  config: LLMConfigState;
  prompt: string;
}

export interface DefaultSettings {
  subfieldOptions: string[];
  sourceOptions: string[];
  academicLevels: string[];
  difficultyOptions: string[];
  difficultyPrompt: string;
  optionsCount: number; // default 5
  maxReviewRounds: number;
}

const SUPPORTED_PROVIDERS = new Set<LLMConfigState['provider']>(['openai', 'gemini', 'claude']);

export const DEFAULT_SUBFIELD_OPTIONS: string[] = [
  'Point-Set Topology',
  'Homotopy Theory',
  'Homology Theory',
  'Knot Theory',
  'Low-Dimensional Topology',
  'Geometric Topology',
  'Differential Topology',
  'Foliation Theory',
  'Degree Theory'
];

export const DEFAULT_SOURCE_OPTIONS: string[] = [
  'MATH-Vision Dataset',
  'Original Question',
  'Math Kangaroo Contest',
  'Caribou Contests',
  'Lecture Notes on Basic Topology: You Cheng Ye',
  'Armstrong Topology',
  'Hatcher AT',
  'Munkres Topology',
  'SimplicialTopology',
  '3-Manifold Topology',
  'Introduction to 3-Manifolds'
];

export const DEFAULT_ACADEMIC_LEVELS: string[] = ['K12', 'Professional'];

export const DEFAULT_DIFFICULTY_OPTIONS: string[] = ['1', '2', '3'];

export const DEFAULT_DIFFICULTY_PROMPT = 'Difficulty (1=easy, 3=hard)';

const DEFAULT_OPTIONS_COUNT = 5;
const DEFAULT_MAX_REVIEW_ROUNDS = 3;

const DEFAULT_QA_PROMPT = `You are a helpful subject-matter expert for math assessment authors. You will receive the fully structured problem (question, options, answer, metadata). Your job is to answer the user's follow-up questions about this exact problem without altering the draft.

Guidelines:
- Reference the provided fields when explaining your reasoning, but do not rewrite or regenerate the question.
- If the user asks in Chinese, answer in Chinese; otherwise reply in the same language they used. Mirror mixed-language queries as well.
- When you are unsure, say so and suggest what additional details would help.`;

const DEFAULT_AGENT_PROMPTS: Record<AgentId, string> = {
  ocr: `You are a meticulous OCR engine for mathematical documents. Extract every piece of readable text from the provided image and return plain UTF-8 text only.

Guidelines:
- Preserve original line breaks when they reflect structure (paragraphs, bullet lists, tables).
- Keep existing LaTeX or math notation exactly as seen; do not invent new notation.
- If a symbol is visually unclear, transcribe your best guess without commentary.
- Never add explanations, metadata, or confidence notes; return only the transcribed text.`,
  latex: `You are a LaTeX normalization assistant responsible for producing MathJax-compatible output (TeX → CHTML). Each request includes a "MathJax render report" followed by the original snippet. Use the report to identify syntax problems, unsupported commands, or missing braces, then return a corrected version that preserves the original meaning.

Guidelines:
- Leave natural language portions untouched while repairing mathematical notation.
- Replace unsupported or ambiguous commands with MathJax-supported equivalents.
- Ensure delimiters, environments, and escape characters are balanced so MathJax parses cleanly.
- Preserve existing valid structure; do not introduce new packages or commentary.
- Respond with the corrected LaTeX snippet only, without explanations or surrounding markup.`,
  generator: `You are an expert math problem assistant. You receive partial structured data for a math problem and must reply with a single compact JSON object containing exactly the keys: question, questionType, options, answer, subfield, academicLevel, difficulty.

Guidelines:
- Preserve the intent of any provided field. Minor wording improvements are allowed, but do not contradict supplied information.
- Fill only the missing or incomplete fields by using the source text and the allowed value lists that will be provided.
- When the question type is "Multiple Choice", return exactly the requested number of options labeled A, B, C, ...; keep existing non-empty options unless refinement is clearly beneficial.
- For subfield, academicLevel, and difficulty, pick from the allowed lists. If you must use "Others", append a colon and a short descriptor (e.g., "Others: Graph Theory").
- Ensure the answer is consistent with the completed problem statement.
- Any LaTeX you output must render without errors in MathJax; prefer MathJax-supported commands and syntax.
- Return valid JSON with double quotes, no trailing commas, and no commentary outside the JSON object.`,
  translator: `You are a precise bilingual translator for mathematics education content. Translate the provided text into the requested target language while preserving structure.

Guidelines:
- Keep mathematical notation, LaTeX commands, equations, and labels unchanged and compatible with MathJax.
- Maintain bullet lists, numbering, and paragraph breaks.
- Retain proper nouns and technical terms in a consistent, context-appropriate form.
- Return only the translated text without explanations or back-translations.`,
  reviewer: `You are a meticulous QA reviewer for structured math problems. You will receive the full <Generated Question> block plus parsed fields. Assess the draft and reply with strict JSON using double quotes:
{
  "status": "pass" | "fail",
  "issues": ["description 1", "description 2"],
  "feedback": "Actionable summary"
  }

Pass only if:
1. The question text is clear, contains no undefined terminology, and has no ambiguity.
2. The output preserves the exact contract structure (<Generated Question> block with required fields).
3. For Multiple Choice, there are at least two options, exactly one correct choice, and the stated answer matches that option.

When failing, list each issue in "issues" and ensure "feedback" briefly explains how to fix them. Do not include any other text.`,
  qa: DEFAULT_QA_PROMPT
};

function sanitizeList(input: unknown, fallback: string[]): string[] {
  const arr = Array.isArray(input) ? input : [];
  const cleaned = arr
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  const unique: string[] = [];
  for (const item of cleaned) {
    if (!unique.includes(item)) unique.push(item);
  }
  return unique.length > 0 ? unique : [...fallback];
}

function sanitizeLLMConfig(input?: Partial<LLMConfigState> | null): LLMConfigState {
  const provider = SUPPORTED_PROVIDERS.has((input?.provider as any)) ? (input!.provider as LLMConfigState['provider']) : 'openai';
  return {
    provider,
    apiKey: typeof input?.apiKey === 'string' ? input!.apiKey : '',
    baseUrl: typeof input?.baseUrl === 'string' ? input!.baseUrl : '',
    model: typeof input?.model === 'string' ? input!.model : ''
  };
}

function sanitizeAgentSettings(input: Partial<LLMAgentSettings> | undefined, fallbackPrompt: string): LLMAgentSettings {
  const config = sanitizeLLMConfig(input?.config || (input as any));
  const prompt = typeof input?.prompt === 'string' && input.prompt.trim().length > 0
    ? input.prompt.trim()
    : fallbackPrompt;
  return { config, prompt };
}

function sanitizeDefaults(partial?: Partial<DefaultSettings> & Record<string, unknown>): DefaultSettings {
  const optionsCountRaw = typeof partial?.optionsCount === 'number' ? partial!.optionsCount : DEFAULT_OPTIONS_COUNT;
  const optionsCount = Math.max(2, Math.min(10, Math.floor(optionsCountRaw)));
  const maxReviewRaw = typeof partial?.maxReviewRounds === 'number' ? partial!.maxReviewRounds : DEFAULT_MAX_REVIEW_ROUNDS;
  const maxReviewRounds = Math.max(1, Math.min(10, Math.floor(maxReviewRaw)));
  const difficultyPrompt = typeof partial?.difficultyPrompt === 'string' && partial.difficultyPrompt.trim().length > 0
    ? partial.difficultyPrompt.trim()
    : DEFAULT_DIFFICULTY_PROMPT;
  return {
    subfieldOptions: sanitizeList((partial as any)?.subfieldOptions, DEFAULT_SUBFIELD_OPTIONS),
    sourceOptions: sanitizeList((partial as any)?.sourceOptions, DEFAULT_SOURCE_OPTIONS),
    academicLevels: sanitizeList((partial as any)?.academicLevels, DEFAULT_ACADEMIC_LEVELS),
    difficultyOptions: sanitizeList((partial as any)?.difficultyOptions, DEFAULT_DIFFICULTY_OPTIONS),
    difficultyPrompt,
    optionsCount,
    maxReviewRounds
  };
}

export interface ProblemRecord {
  id: string; // timestamp ms
  question: string;
  questionType: 'Multiple Choice' | 'Fill-in-the-blank' | 'Proof';
  options: string[]; // A.. variable length, default 5
  answer: string; // could be JSON for multi answers or proof latex
  subfield: string; // semicolon joined
  source: string;
  image: string; // images/<ts>.jpg or ''
  imageDependency: 0 | 1;
  academicLevel: string;
  difficulty: string;
}

type ImageBindings = Record<string, string[]>;

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;
  llmAgents: Record<AgentId, LLMAgentSettings>;
  saveAgentSettings: (id: AgentId, settings: LLMAgentSettings) => void;
  copyAgentConfig: (target: AgentId, source: AgentId) => void;
  problems: ProblemRecord[];
  currentId: string | null;
  upsertProblem: (p: Partial<ProblemRecord>) => void;
  patchProblem: (id: string, patch: Partial<ProblemRecord>) => void;
  newProblem: () => void;
  deleteProblem: (id: string) => void;
  imageBindings: ImageBindings;
  // Defaults and maintenance
  defaults: DefaultSettings;
  setDefaults: (p: Partial<DefaultSettings>) => void;
  applyOptionsCountToExisting: (count: number) => void;
  clearAllProblems: () => void;
  overallDraftConfig: LLMConfigState;
  setOverallDraftConfig: (cfg: Partial<LLMConfigState>) => void;
}

const initialMode: Mode = 'agent';

const initialDefaults: DefaultSettings = (() => {
  const raw = localStorage.getItem('defaults');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const sanitized = sanitizeDefaults(parsed as any);
      localStorage.setItem('defaults', JSON.stringify(sanitized));
      return sanitized;
    } catch {}
  }
  const sanitized = sanitizeDefaults();
  localStorage.setItem('defaults', JSON.stringify(sanitized));
  return sanitized;
})();

const initialLLMAgents: Record<AgentId, LLMAgentSettings> = (() => {
  const raw = localStorage.getItem('llm-agents');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, any>;
        const sanitized: Record<AgentId, LLMAgentSettings> = {
          ocr: sanitizeAgentSettings(parsed?.ocr, DEFAULT_AGENT_PROMPTS.ocr),
          latex: sanitizeAgentSettings(parsed?.latex, DEFAULT_AGENT_PROMPTS.latex),
          generator: sanitizeAgentSettings(parsed?.generator, DEFAULT_AGENT_PROMPTS.generator),
          reviewer: sanitizeAgentSettings(parsed?.reviewer, DEFAULT_AGENT_PROMPTS.reviewer),
          translator: sanitizeAgentSettings(parsed?.translator, DEFAULT_AGENT_PROMPTS.translator),
          qa: sanitizeAgentSettings(parsed?.qa, DEFAULT_AGENT_PROMPTS.qa)
        };
      localStorage.setItem('llm-agents', JSON.stringify(sanitized));
      return sanitized;
    } catch {}
  }
  let legacyConfig: LLMConfigState | undefined;
  const legacyRaw = localStorage.getItem('llm-config');
  if (legacyRaw) {
    try { legacyConfig = sanitizeLLMConfig(JSON.parse(legacyRaw)); } catch {}
  }
    const fallback: Record<AgentId, LLMAgentSettings> = {
      ocr: { config: sanitizeLLMConfig(legacyConfig), prompt: DEFAULT_AGENT_PROMPTS.ocr },
      latex: { config: sanitizeLLMConfig(legacyConfig), prompt: DEFAULT_AGENT_PROMPTS.latex },
      generator: { config: sanitizeLLMConfig(legacyConfig), prompt: DEFAULT_AGENT_PROMPTS.generator },
      reviewer: { config: sanitizeLLMConfig(legacyConfig), prompt: DEFAULT_AGENT_PROMPTS.reviewer },
      translator: { config: sanitizeLLMConfig(legacyConfig), prompt: DEFAULT_AGENT_PROMPTS.translator },
      qa: { config: sanitizeLLMConfig(legacyConfig), prompt: DEFAULT_AGENT_PROMPTS.qa }
    };
  localStorage.setItem('llm-agents', JSON.stringify(fallback));
  return fallback;
})();

const initialOverallDraftConfig: LLMConfigState = (() => {
  const raw = localStorage.getItem('llm-overall-draft');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const sanitized = sanitizeLLMConfig(parsed);
      localStorage.setItem('llm-overall-draft', JSON.stringify(sanitized));
      return sanitized;
    } catch {}
  }
  const fallbackSource =
    initialLLMAgents.generator?.config ||
    initialLLMAgents.ocr?.config ||
    sanitizeLLMConfig();
  const sanitized = sanitizeLLMConfig(fallbackSource);
  localStorage.setItem('llm-overall-draft', JSON.stringify(sanitized));
  return sanitized;
})();

const createEmptyProblem = (defaults: DefaultSettings): ProblemRecord => ({
  id: `${Date.now()}`,
  question: '',
  questionType: 'Multiple Choice',
  options: Array.from({ length: defaults.optionsCount }, () => ''),
  answer: '',
  subfield: '',
  source: '',
  image: '',
  imageDependency: 0,
  academicLevel: defaults.academicLevels[0] ?? '',
  difficulty: defaults.difficultyOptions[0] ?? ''
});

const sanitizeProblemImage = (value?: string | null) => {
  const image = normalizeImagePath(value ?? '');
  const imageDependency: 0 | 1 = image ? 1 : 0;
  return { image, imageDependency };
};

const sanitizeProblemPatch = (patch: Partial<ProblemRecord>): Partial<ProblemRecord> => {
  if (Object.prototype.hasOwnProperty.call(patch, 'image')) {
    const { image, imageDependency } = sanitizeProblemImage(patch.image ?? '');
    return { ...patch, image, imageDependency };
  }
  return patch;
};

const buildImageBindings = (problems: ProblemRecord[]): ImageBindings => {
  const bindings: ImageBindings = {};
  problems.forEach((problem) => {
    const key = normalizeImagePath(problem.image);
    if (!key) return;
    if (!bindings[key]) bindings[key] = [];
    bindings[key].push(problem.id);
  });
  return bindings;
};

const persistImageBindings = (problems: ProblemRecord[]): ImageBindings => {
  const bindings = buildImageBindings(problems);
  localStorage.setItem('image-bindings', JSON.stringify(bindings));
  return bindings;
};

const normalizeProblem = (raw: any, defaults: DefaultSettings): ProblemRecord => {
  const id = typeof raw?.id === 'string' ? raw.id : `${Date.now()}`;
  const question = typeof raw?.question === 'string' ? raw.question : '';
  const questionType: ProblemRecord['questionType'] = raw?.questionType === 'Fill-in-the-blank'
    ? 'Fill-in-the-blank'
    : raw?.questionType === 'Proof'
      ? 'Proof'
      : 'Multiple Choice';
  const options = Array.isArray(raw?.options) ? raw.options.map((o: any) => (typeof o === 'string' ? o : '')) : [];
  const answer = typeof raw?.answer === 'string' ? raw.answer : (Array.isArray(raw?.answer) ? JSON.stringify(raw.answer) : '');
  const subfield = typeof raw?.subfield === 'string' ? raw.subfield : '';
  const source = typeof raw?.source === 'string' ? raw.source : '';
  const imageValue = typeof raw?.image === 'string' ? raw.image : '';
  const { image, imageDependency } = sanitizeProblemImage(imageValue);
  const academicLevel = typeof raw?.academicLevel === 'string' ? raw.academicLevel : (defaults.academicLevels[0] ?? '');
  const difficulty = typeof raw?.difficulty === 'string'
    ? raw.difficulty
    : typeof raw?.difficulty === 'number'
      ? String(raw.difficulty)
      : (defaults.difficultyOptions[0] ?? '');
  return { id, question, questionType, options, answer, subfield, source, image, imageDependency, academicLevel, difficulty };
};

const initialProblems: ProblemRecord[] = (() => {
  const raw = localStorage.getItem('problems');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as any[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.map((p) => normalizeProblem(p, initialDefaults));
        localStorage.setItem('problems', JSON.stringify(normalized));
        return normalized;
      }
    } catch {}
  }
  const first = createEmptyProblem(initialDefaults);
  localStorage.setItem('problems', JSON.stringify([first]));
  localStorage.setItem('currentId', first.id);
  return [first];
})();

const initialImageBindings: ImageBindings = persistImageBindings(initialProblems);

export const useAppStore = create<AppState>((set, get) => ({
  mode: initialMode,
  setMode: (m) => {
    // Mode switching disabled; always agent
    localStorage.setItem('mode', 'agent');
    set({ mode: 'agent' });
  },
  llmAgents: initialLLMAgents,
  saveAgentSettings: (id, settings) => {
    const sanitized = sanitizeAgentSettings(settings, DEFAULT_AGENT_PROMPTS[id]);
    const next = { ...get().llmAgents, [id]: sanitized };
    localStorage.setItem('llm-agents', JSON.stringify(next));
    set({ llmAgents: next });
  },
  copyAgentConfig: (target, source) => {
    if (target === source) return;
    const agents = get().llmAgents;
    const from = agents[source];
    if (!from) return;
    const to = agents[target] || { config: sanitizeLLMConfig(), prompt: DEFAULT_AGENT_PROMPTS[target] };
    const next = {
      ...agents,
      [target]: { ...to, config: { ...from.config } }
    } as Record<AgentId, LLMAgentSettings>;
    localStorage.setItem('llm-agents', JSON.stringify(next));
    set({ llmAgents: next });
  },
  // Defaults
  defaults: initialDefaults,
  setDefaults: (partial) => {
    const next = sanitizeDefaults({ ...get().defaults, ...partial });
    localStorage.setItem('defaults', JSON.stringify(next));
    set({ defaults: next });
  },
  problems: initialProblems,
  currentId: localStorage.getItem('currentId'),
  imageBindings: initialImageBindings,
  upsertProblem: (partial) => {
    const state = get();
    const { problems, currentId, defaults } = state;
    const id = partial.id || currentId || `${Date.now()}`;
    const sanitizedPartial = sanitizeProblemPatch(partial);
    let found = false;
    const next = problems.map((p) => {
      if (p.id !== id) return p;
      found = true;
      const nextImage = sanitizedPartial.image ?? p.image;
      const merged: ProblemRecord = {
        ...p,
        ...sanitizedPartial,
        image: nextImage,
        imageDependency: nextImage ? 1 : 0,
        academicLevel: typeof (sanitizedPartial as any)?.academicLevel === 'string' ? (sanitizedPartial as any).academicLevel : p.academicLevel,
        difficulty: typeof (sanitizedPartial as any)?.difficulty === 'string' ? (sanitizedPartial as any).difficulty : p.difficulty
      } as ProblemRecord;
      return merged;
    });
    if (!found) {
      const base = createEmptyProblem(defaults);
      const nextImage = sanitizedPartial.image ?? base.image;
      const merged: ProblemRecord = {
        ...base,
        ...sanitizedPartial,
        id,
        image: nextImage,
        imageDependency: nextImage ? 1 : 0,
        academicLevel: typeof (sanitizedPartial as any)?.academicLevel === 'string' ? (sanitizedPartial as any).academicLevel : base.academicLevel,
        difficulty: typeof (sanitizedPartial as any)?.difficulty === 'string' ? (sanitizedPartial as any).difficulty : base.difficulty
      } as ProblemRecord;
      next.push(merged);
    }
    localStorage.setItem('problems', JSON.stringify(next));
    localStorage.setItem('currentId', id);
    const imageBindings = persistImageBindings(next);
    set({ problems: next, currentId: id, imageBindings });
  },
  patchProblem: (id, patch) => {
    const problems = get().problems;
    const sanitizedPatch = sanitizeProblemPatch(patch);
    const next = problems.map((p) => {
      if (p.id !== id) return p;
      const nextImage = sanitizedPatch.image ?? p.image;
      return {
        ...p,
        ...sanitizedPatch,
        image: nextImage,
        imageDependency: nextImage ? 1 : 0,
        academicLevel: typeof (sanitizedPatch as any)?.academicLevel === 'string' ? (sanitizedPatch as any).academicLevel : p.academicLevel,
        difficulty: typeof (sanitizedPatch as any)?.difficulty === 'string' ? (sanitizedPatch as any).difficulty : p.difficulty
      };
    });
    localStorage.setItem('problems', JSON.stringify(next));
    const imageBindings = persistImageBindings(next);
    set({ problems: next, imageBindings });
  },
  newProblem: () => {
    const defaults = get().defaults;
    const p = createEmptyProblem(defaults);
    const next = [p, ...get().problems];
    localStorage.setItem('problems', JSON.stringify(next));
    localStorage.setItem('currentId', p.id);
    const imageBindings = persistImageBindings(next);
    set({ problems: next, currentId: p.id, imageBindings });
  },
  deleteProblem: (id) => {
    const problems = get().problems;
    const idx = problems.findIndex((p) => p.id === id);
    if (idx === -1) return;

    const next = problems.filter((p) => p.id !== id);
    localStorage.setItem('problems', JSON.stringify(next));

    let nextId: string | null = get().currentId;
    if (get().currentId === id) {
      const fallback =
        next[idx] !== undefined
          ? next[idx].id
          : next[idx - 1] !== undefined
            ? next[idx - 1].id
            : null;
      nextId = fallback;
      if (nextId) {
        localStorage.setItem('currentId', nextId);
      } else {
        localStorage.removeItem('currentId');
      }
    }

    const imageBindings = persistImageBindings(next);
    set({ problems: next, currentId: nextId, imageBindings });
  },
  applyOptionsCountToExisting: (count: number) => {
    const next = get().problems.map((p) => {
      if (p.questionType !== 'Multiple Choice') return p;
      const opts = Array.from({ length: count }, (_, i) => p.options?.[i] ?? '');
      let answer = p.answer;
      // If answer is a single letter beyond range, clear it
      if (/^[A-Z]$/.test(answer)) {
        const idx = answer.charCodeAt(0) - 65;
        if (idx < 0 || idx >= count) answer = '';
      }
      return { ...p, options: opts, answer };
    });
    localStorage.setItem('problems', JSON.stringify(next));
    const imageBindings = persistImageBindings(next);
    set({ problems: next, imageBindings });
  },
  clearAllProblems: () => {
    // Remove all problems and related pointers
    localStorage.removeItem('problems');
    localStorage.removeItem('currentId');
    // Remove per-problem image blocks cache, if any
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('image-blocks-')) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch {}
    const first = createEmptyProblem(get().defaults);
    localStorage.setItem('problems', JSON.stringify([first]));
    localStorage.setItem('currentId', first.id);
    const imageBindings = persistImageBindings([first]);
    set({ problems: [first], currentId: first.id, imageBindings });
  },
  overallDraftConfig: initialOverallDraftConfig,
  setOverallDraftConfig: (partial) => {
    set((state) => {
      const merged = sanitizeLLMConfig({ ...state.overallDraftConfig, ...partial });
      localStorage.setItem('llm-overall-draft', JSON.stringify(merged));
      return { overallDraftConfig: merged };
    });
  }
}));
