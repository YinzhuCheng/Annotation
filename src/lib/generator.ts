import { LLMConfigState, ProblemRecord } from '../state/store';
import { chatStream } from './llmAdapter';

export async function generateProblemFromText(
  input: string,
  targetType: ProblemRecord['questionType'],
  llm: LLMConfigState,
  handlers?: { onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void }
): Promise<Partial<ProblemRecord>> {
  let optionsCount = 5;
  try {
    const raw = localStorage.getItem('defaults');
    if (raw) {
      const j = JSON.parse(raw);
      if (typeof j?.optionsCount === 'number' && j.optionsCount >= 2 && j.optionsCount <= 10) optionsCount = Math.floor(j.optionsCount);
    }
  } catch {}
  const sys = `You are an expert math problem generator and formatter.
Output strictly a compact JSON object with keys: question, questionType, options, answer, subfield, academicLevel, difficulty.
Rules:
- question: rewritten to the target type preserving core meaning.
- questionType: exactly one of ["Multiple Choice","Fill-in-the-blank","Proof"] matching the requested type.
- options: if questionType is Multiple Choice, provide exactly ${optionsCount} LaTeX-capable strings labeled A..${String.fromCharCode(65 + optionsCount - 1)}; otherwise []
- answer: For MC: a single letter (e.g., "C") or array like ["A","C"]; FITB: the correct content string; Proof: full proof steps in LaTeX.
- subfield: one from the given list if possible, else "Others".
- academicLevel: "K12" or "Professional".
- difficulty: integer 1..3.
No markdown, no prose.`;

  const user = `Original problem text:\n${input}\n\nTarget type: ${targetType}\nSubfields list: Point-Set Topology; Algebraic Topology; Homotopy Theory; Homology Theory; Knot Theory; Low-Dimensional Topology; Geometric Topology; Differential Topology; Foliation Theory; Degree Theory.`;

  const raw = await chatStream([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], llm, { temperature: 0.2, maxTokens: 800 }, handlers);

  let obj: any = {};
  try { obj = JSON.parse(raw); } catch {
    // best effort: try to extract JSON substring
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { obj = JSON.parse(m[0]); } catch {}
    }
  }

  const partial: Partial<ProblemRecord> = {
    question: String(obj.question || '').trim() || input,
    questionType: (obj.questionType as any) || targetType,
    options: Array.isArray(obj.options) && obj.options.length > 0 ? obj.options.map(String) : (targetType === 'Multiple Choice' ? Array.from({ length: optionsCount }, () => '') : []),
    answer: typeof obj.answer === 'string' || Array.isArray(obj.answer) ? (typeof obj.answer === 'string' ? obj.answer : JSON.stringify(obj.answer)) : '',
    subfield: typeof obj.subfield === 'string' ? obj.subfield : 'Others',
    academicLevel: obj.academicLevel === 'Professional' ? 'Professional' : 'K12',
    difficulty: [1,2,3].includes(Number(obj.difficulty)) ? Number(obj.difficulty) as 1|2|3 : 1,
  };
  return partial;
}
