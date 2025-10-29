import { create } from 'zustand';

export type Mode = 'manual' | 'agent';

export interface LLMConfigState {
  provider: 'openai' | 'gemini' | 'claude';
  apiKey: string;
  baseUrl: string; // for openai-compatible
  model: string;
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
  academicLevel: 'K12' | 'Professional';
  difficulty: 1 | 2 | 3;
}

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;
  llm: LLMConfigState;
  setLLM: (p: Partial<LLMConfigState>) => void;
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

const initialLLM: LLMConfigState = (() => {
  const raw = localStorage.getItem('llm-config');
  if (raw) return JSON.parse(raw);
  return { provider: 'openai', apiKey: '', baseUrl: '', model: '' };
})();

const initialMode: Mode = 'agent';

export interface DefaultSettings {
  subfield: string;
  source: string;
  academicLevel: 'K12' | 'Professional';
  difficulty: 1 | 2 | 3;
  optionsCount: number; // default 5
}

const initialDefaults: DefaultSettings = (() => {
  const raw = localStorage.getItem('defaults');
  if (raw) {
    try { return JSON.parse(raw) as DefaultSettings; } catch {}
  }
  return { subfield: '', source: '', academicLevel: 'K12', difficulty: 1, optionsCount: 5 };
})();

const emptyProblem = (): ProblemRecord => ({
  id: `${Date.now()}`,
  question: '',
  questionType: 'Multiple Choice',
  options: Array.from({ length: initialDefaults.optionsCount }, () => ''),
  answer: '',
  subfield: initialDefaults.subfield,
  source: initialDefaults.source,
  image: '',
  imageDependency: 0,
  academicLevel: initialDefaults.academicLevel,
  difficulty: initialDefaults.difficulty,
});

export const useAppStore = create<AppState>((set, get) => ({
  mode: initialMode,
  setMode: (m) => {
    // Mode switching disabled; always agent
    localStorage.setItem('mode', 'agent');
    set({ mode: 'agent' });
  },
  llm: initialLLM,
  setLLM: (p) => {
    const next = { ...get().llm, ...p };
    localStorage.setItem('llm-config', JSON.stringify(next));
    set({ llm: next });
  },
  // Defaults
  defaults: initialDefaults,
  setDefaults: (p) => {
    const prev = get().defaults;
    const next: DefaultSettings = { ...prev, ...p };
    localStorage.setItem('defaults', JSON.stringify(next));
    set({ defaults: next });
  },
  problems: (() => {
    const raw = localStorage.getItem('problems');
    if (raw) return JSON.parse(raw) as ProblemRecord[];
    const first = emptyProblem();
    localStorage.setItem('problems', JSON.stringify([first]));
    localStorage.setItem('currentId', first.id);
    return [first];
  })(),
  currentId: localStorage.getItem('currentId'),
  upsertProblem: (partial) => {
    const { problems, currentId } = get();
    const id = partial.id || currentId || `${Date.now()}`;
    let found = false;
    const next = problems.map((p) => {
      if (p.id === id) {
        found = true;
        const merged = { ...p, ...partial } as any;
        merged.imageDependency = merged.image ? 1 : 0;
        return merged;
      }
      return p;
    });
    if (!found) next.push({ ...emptyProblem(), ...partial, id });
    localStorage.setItem('problems', JSON.stringify(next));
    localStorage.setItem('currentId', id);
    set({ problems: next, currentId: id });
  },
  newProblem: () => {
    const p = emptyProblem();
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
    const first = emptyProblem();
    localStorage.setItem('problems', JSON.stringify([first]));
    localStorage.setItem('currentId', first.id);
    set({ problems: [first], currentId: first.id });
  }
}));
