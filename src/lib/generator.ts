import { DefaultSettings, LLMAgentSettings, ProblemRecord } from '../state/store';
import { chatStream } from './llmAdapter';

export async function generateProblemFromText(
  input: string,
  targetType: ProblemRecord['questionType'],
  agent: LLMAgentSettings,
  defaults: DefaultSettings,
  handlers?: { onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void }
): Promise<Partial<ProblemRecord>> {
  const optionsCount = Math.max(2, Math.min(10, Math.floor(defaults.optionsCount || 5)));
  const systemPrompt = agent.prompt?.trim() || `You are an expert math problem generator and formatter.
Output strictly a compact JSON object with keys: question, questionType, options, answer, subfield, academicLevel, difficulty.
Rules:
- question: rewritten to the target type preserving core meaning.
- questionType: exactly one of ["Multiple Choice","Fill-in-the-blank","Proof"] matching the requested type.
- options: if questionType is Multiple Choice, provide exactly ${optionsCount} LaTeX-capable strings labeled A..${String.fromCharCode(65 + optionsCount - 1)}; otherwise []
- answer: For MC: a single letter (e.g., "C") or array like ["A","C"]; FITB: the correct content string; Proof: full proof steps in LaTeX.
- subfield: one from the given list if possible, else "Others".
- academicLevel: choose from the supplied list.
- difficulty: choose from the supplied list.
Return compact JSON only.`;

  const subfieldList = defaults.subfieldOptions.join('; ') || 'Others';
  const academicList = defaults.academicLevels.join('; ') || 'K12; Professional';
  const difficultyList = defaults.difficultyOptions.join('; ') || '1; 2; 3';

  const user = `Original problem text:\n${input}\n\nTarget type: ${targetType}\nSubfields list: ${subfieldList}.\nAcademic levels list: ${academicList}.\nDifficulty options: ${difficultyList}.\nIf Multiple Choice, output exactly ${optionsCount} options.`;

  const raw = await chatStream([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user }
  ], agent.config, { temperature: 0.2, maxTokens: 800 }, handlers);

  let obj: any = {};
  try { obj = JSON.parse(raw); } catch {
    // best effort: try to extract JSON substring
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { obj = JSON.parse(m[0]); } catch {}
    }
  }

  const normalizedOptions = (() => {
    if (Array.isArray(obj.options) && obj.options.length > 0) {
      const mapped = obj.options.map((o: any) => String(o ?? ''));
      if (targetType === 'Multiple Choice') {
        return Array.from({ length: optionsCount }, (_, idx) => mapped[idx] ?? '');
      }
      return mapped;
    }
    return targetType === 'Multiple Choice' ? Array.from({ length: optionsCount }, () => '') : [];
  })();

  const partial: Partial<ProblemRecord> = {
    question: String(obj.question || '').trim() || input,
    questionType: (obj.questionType as any) || targetType,
    options: normalizedOptions,
    answer: typeof obj.answer === 'string' || Array.isArray(obj.answer) ? (typeof obj.answer === 'string' ? obj.answer : JSON.stringify(obj.answer)) : '',
    subfield: typeof obj.subfield === 'string' ? obj.subfield : 'Others',
    academicLevel: typeof obj.academicLevel === 'string' ? obj.academicLevel : (defaults.academicLevels[0] ?? ''),
    difficulty: typeof obj.difficulty === 'string'
      ? obj.difficulty
      : typeof obj.difficulty === 'number'
        ? String(obj.difficulty)
        : (defaults.difficultyOptions[0] ?? ''),
  };
  return partial;
}
