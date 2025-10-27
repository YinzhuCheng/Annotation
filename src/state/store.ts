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
  options: string[]; // A-E
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
}

const initialLLM: LLMConfigState = (() => {
  const raw = localStorage.getItem('llm-config');
  if (raw) return JSON.parse(raw);
  return { provider: 'openai', apiKey: '', baseUrl: '', model: '' };
})();

const initialMode: Mode = 'agent';

const emptyProblem = (): ProblemRecord => ({
  id: `${Date.now()}`,
  question: '',
  questionType: 'Multiple Choice',
  options: ['', '', '', '', ''],
  answer: '',
  subfield: '',
  source: '',
  image: '',
  imageDependency: 0,
  academicLevel: 'K12',
  difficulty: 1,
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
  }
}));
