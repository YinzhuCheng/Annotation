import { create } from 'zustand';

export type Mode = 'manual' | 'agent';

export interface LLMConfigState {
  provider: 'openai' | 'gemini' | 'claude';
  apiKey: string;
  baseUrl: string; // for openai-compatible
  model: string;
}

export type AgentId = 'ocr' | 'latex' | 'generator' | 'translator';

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

const DEFAULT_AGENT_PROMPTS: Record<AgentId, string> = {
  ocr: 'You are an OCR engine. Transcribe all readable text from the image into plain UTF-8 text. Preserve math expressions as text (no LaTeX unless present), keep line breaks where meaningful, and do not add commentary.',
  latex: `You are a LaTeX normalization assistant. Clean the input text by converting any unusual mathematical symbols into standard LaTeX commands while preserving meaning.

Examples:
Input: Let ϵ→0 in ℝ^n.
Output: Let \\epsilon \\to 0 in \\mathbb{R}^n.

Input: Solve ∑_{k=1}^n (k≤m).
Output: Solve \\sum_{k=1}^{n} (k \\le m).

Input: Matrix A=[1  0; −1  α].
Output: Matrix A=\\begin{bmatrix}1 & 0\\\\ -1 & \\alpha\\end{bmatrix}.

Guidelines:
- Leave plain-language sentences untouched.
- Keep existing valid LaTeX environments, delimiters, and spacing intact.
- Replace Unicode math symbols (e.g., ℤ, ≤, α) with the appropriate LaTeX macros.
- Do not wrap the result in additional environments or commentary; output only the corrected text.`,
  generator: `You are an expert math problem generator and formatter.\nOutput strictly a compact JSON object with keys: question, questionType, options, answer, subfield, academicLevel, difficulty.\nRules:\n- question: rewrite or polish the input to the requested type.\n- questionType: exactly one of ["Multiple Choice","Fill-in-the-blank","Proof"].\n- options: if Multiple Choice, provide the required count of LaTeX-ready strings labeled A..; otherwise [].\n- answer: For MC use a single letter or array of letters; FITB return the correct content string; Proof provide full proof steps.\n- subfield: choose from the supplied list when possible, else "Others".\n- academicLevel: choose from the supplied list.\n- difficulty: choose from the supplied list.\nReturn JSON only.`,
  translator: `You are a precise bilingual translator for mathematics education content. Maintain mathematical notation and LaTeX as-is, keep any bullet or numbered structure, and return only the translated text in the target language without additional commentary.`
};

const AGENT_IDS: AgentId[] = ['ocr', 'latex', 'generator', 'translator'];

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
  const difficultyPrompt = typeof partial?.difficultyPrompt === 'string' && partial.difficultyPrompt.trim().length > 0
    ? partial.difficultyPrompt.trim()
    : DEFAULT_DIFFICULTY_PROMPT;
  return {
    subfieldOptions: sanitizeList((partial as any)?.subfieldOptions, DEFAULT_SUBFIELD_OPTIONS),
    sourceOptions: sanitizeList((partial as any)?.sourceOptions, DEFAULT_SOURCE_OPTIONS),
    academicLevels: sanitizeList((partial as any)?.academicLevels, DEFAULT_ACADEMIC_LEVELS),
    difficultyOptions: sanitizeList((partial as any)?.difficultyOptions, DEFAULT_DIFFICULTY_OPTIONS),
    difficultyPrompt,
    optionsCount
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

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;
  llmAgents: Record<AgentId, LLMAgentSettings>;
  saveAgentSettings: (id: AgentId, settings: LLMAgentSettings) => void;
  copyAgentConfig: (target: AgentId, source: AgentId) => void;
  problems: ProblemRecord[];
  currentId: string | null;
  upsertProblem: (p: Partial<ProblemRecord>) => void;
  newProblem: () => void;
  deleteProblem: (id: string) => void;
  // Defaults and maintenance
  defaults: DefaultSettings;
  setDefaults: (p: Partial<DefaultSettings>) => void;
  applyOptionsCountToExisting: (count: number) => void;
  clearAllProblems: () => void;
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
        translator: sanitizeAgentSettings(parsed?.translator, DEFAULT_AGENT_PROMPTS.translator)
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
    translator: { config: sanitizeLLMConfig(legacyConfig), prompt: DEFAULT_AGENT_PROMPTS.translator }
  };
  localStorage.setItem('llm-agents', JSON.stringify(fallback));
  return fallback;
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
  const image = typeof raw?.image === 'string' ? raw.image : '';
  const academicLevel = typeof raw?.academicLevel === 'string' ? raw.academicLevel : (defaults.academicLevels[0] ?? '');
  const difficulty = typeof raw?.difficulty === 'string'
    ? raw.difficulty
    : typeof raw?.difficulty === 'number'
      ? String(raw.difficulty)
      : (defaults.difficultyOptions[0] ?? '');
  const imageDependency: 0 | 1 = image ? 1 : 0;
  return { id, question, questionType, options, answer, subfield, source, image, imageDependency, academicLevel, difficulty };
};

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
  problems: (() => {
    const raw = localStorage.getItem('problems');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as any[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((p) => normalizeProblem(p, initialDefaults));
        }
      } catch {}
    }
    const first = createEmptyProblem(initialDefaults);
    localStorage.setItem('problems', JSON.stringify([first]));
    localStorage.setItem('currentId', first.id);
    return [first];
  })(),
  currentId: localStorage.getItem('currentId'),
  upsertProblem: (partial) => {
    const state = get();
    const { problems, currentId, defaults } = state;
    const id = partial.id || currentId || `${Date.now()}`;
    let found = false;
    const next = problems.map((p) => {
      if (p.id === id) {
        found = true;
        const merged: ProblemRecord = {
          ...p,
          ...partial,
          imageDependency: (partial.image ?? p.image) ? 1 : 0,
          academicLevel: typeof (partial as any)?.academicLevel === 'string' ? (partial as any).academicLevel : p.academicLevel,
          difficulty: typeof (partial as any)?.difficulty === 'string' ? (partial as any).difficulty : p.difficulty
        } as ProblemRecord;
        return merged;
      }
      return p;
    });
    if (!found) {
      const base = createEmptyProblem(defaults);
      const merged: ProblemRecord = {
        ...base,
        ...partial,
        id,
        imageDependency: partial.image ? 1 : 0,
        academicLevel: typeof (partial as any)?.academicLevel === 'string' ? (partial as any).academicLevel : base.academicLevel,
        difficulty: typeof (partial as any)?.difficulty === 'string' ? (partial as any).difficulty : base.difficulty
      } as ProblemRecord;
      next.push(merged);
    }
    localStorage.setItem('problems', JSON.stringify(next));
    localStorage.setItem('currentId', id);
    set({ problems: next, currentId: id });
  },
  newProblem: () => {
    const defaults = get().defaults;
    const p = createEmptyProblem(defaults);
    const next = [p, ...get().problems];
    localStorage.setItem('problems', JSON.stringify(next));
    localStorage.setItem('currentId', p.id);
    set({ problems: next, currentId: p.id });
  },
  deleteProblem: (id) => {
    const next = get().problems.filter((p) => p.id !== id);
    localStorage.setItem('problems', JSON.stringify(next));
    if (get().currentId === id) {
      const nid = next[0]?.id || null;
      if (nid) localStorage.setItem('currentId', nid); else localStorage.removeItem('currentId');
      set({ problems: next, currentId: nid });
    } else {
      set({ problems: next });
    }
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
    set({ problems: next });
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
    set({ problems: [first], currentId: first.id });
  }
}));
