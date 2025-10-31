import { DefaultSettings, LLMAgentSettings, ProblemRecord } from '../state/store';
import { chatStream } from './llmAdapter';

export async function generateProblemFromText(
  input: string,
  existing: ProblemRecord,
  agent: LLMAgentSettings,
  defaults: DefaultSettings,
  handlers?: { onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void }
): Promise<Partial<ProblemRecord>> {
  const baseInput = input.trim();
  const sanitizedInput = baseInput || '(no additional source text)';
  const targetType = existing.questionType;
  const baseOptionsCount = Math.max(2, Math.min(10, Math.floor(defaults.optionsCount || 5)));
  const existingOptionsArray = Array.isArray(existing.options) ? existing.options : [];
  const expectedOptionsCount = targetType === 'Multiple Choice'
    ? Math.max(existingOptionsArray.length || 0, baseOptionsCount)
    : existingOptionsArray.length;
  const optionLabels = Array.from({ length: expectedOptionsCount }, (_, idx) => String.fromCharCode(65 + idx));
  const existingOptionsNormalized = Array.from({ length: expectedOptionsCount }, (_, idx) => {
    const value = existingOptionsArray[idx];
    return typeof value === 'string' ? value : '';
  });

  const existingQuestion = (existing.question ?? '').trim();
  const existingAnswer = (existing.answer ?? '').trim();
  const existingSubfield = (existing.subfield ?? '').trim();
  const existingAcademic = (existing.academicLevel ?? '').trim();
  const existingDifficulty = (existing.difficulty ?? '').trim();

  const subfieldList = defaults.subfieldOptions.join('; ') || 'Others';
  const academicList = defaults.academicLevels.join('; ') || 'K12; Professional';
  const difficultyList = defaults.difficultyOptions.join('; ') || '1; 2; 3';

  const systemPrompt = agent.prompt?.trim() || `You are an expert math problem assistant. You receive partial structured data for a math problem and must reply with a single compact JSON object containing exactly the keys: question, questionType, options, answer, subfield, academicLevel, difficulty.`;

  let user = `Original source text (blank means none):\n${sanitizedInput}\n\n`;
  user += 'Current record snapshot (blank means missing):\n';
  user += `- questionType: ${targetType}\n`;
  user += `- question: ${existingQuestion || '<missing>'}\n`;
  if (targetType === 'Multiple Choice') {
    user += `- options (expected ${expectedOptionsCount}):\n`;
    user += optionLabels.map((label, idx) => {
      const value = existingOptionsNormalized[idx]?.trim();
      return `  ${label}: ${value || '<missing>'}`;
    }).join('\n');
    user += '\n';
  }
  user += `- answer: ${existingAnswer || '<missing>'}\n`;
  user += `- subfield: ${existingSubfield || '<missing>'}\n`;
  user += `- academicLevel: ${existingAcademic || '<missing>'}\n`;
  user += `- difficulty: ${existingDifficulty || '<missing>'}\n\n`;

  user += 'Allowed values:\n';
  user += `- subfields: ${subfieldList} (you may reply with "Others: <short descriptor>" if none fit)\n`;
  user += `- academic levels: ${academicList}\n`;
  user += `- difficulty options: ${difficultyList}\n\n`;

  user += 'Instructions:\n';
  user += '- Preserve supplied information; light wording improvements are fine but do not contradict provided facts.\n';
  user += '- Fill every "<missing>" entry using the source text and allowed values.\n';
  user += `- Keep questionType as "${targetType}".\n`;
  if (targetType === 'Multiple Choice') {
    user += `- Produce exactly ${expectedOptionsCount} options labeled ${optionLabels.join(', ')}. Keep existing non-empty options unless you are making them clearer.\n`;
  } else {
    user += '- The options array must be empty [] for this question type.\n';
  }
  if (targetType === 'Fill-in-the-blank') {
    user += '- Edit the question text so the unknown value is explicitly shown as one or more blanks (e.g., "___"). Do not leave the question unchanged if it lacks blanks.\n';
    user += 'Example (ICL):\n';
    user += 'Original: "Let x + 3 = 7. Solve for x."\n';
    user += 'Output question: "Solve for x: ___ + 3 = 7."\n';
    user += '- Return the answer as the concrete value that fills the blank (e.g., "4"), not a narrative sentence.\n';
    user += 'Answer example: question "Solve for x: ___ + 3 = 7." -> answer "4".\n';
  }
  user += '- Ensure the answer matches the completed problem statement.\n';
  user += '- Return a single JSON object with keys question, questionType, options, answer, subfield, academicLevel, difficulty and no extra commentary.\n';

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

  const allowedQuestionTypes: ProblemRecord['questionType'][] = ['Multiple Choice', 'Fill-in-the-blank', 'Proof'];
  const llmQuestionTypeRaw = typeof obj.questionType === 'string' ? obj.questionType.trim() : '';
  const questionType: ProblemRecord['questionType'] = allowedQuestionTypes.includes(llmQuestionTypeRaw as ProblemRecord['questionType'])
    ? (llmQuestionTypeRaw as ProblemRecord['questionType'])
    : targetType;

  const llmQuestion = typeof obj.question === 'string' ? obj.question.trim() : '';
  const question = llmQuestion || existingQuestion || baseInput;

  const rawOptions = (obj as any)?.options;
  const llmOptions: string[] = (() => {
    if (Array.isArray(rawOptions)) {
      return rawOptions.map((o: any) => String(o ?? '').trim());
    }
    if (rawOptions && typeof rawOptions === 'object') {
      return Object.entries(rawOptions as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        .map(([, value]) => String(value ?? '').trim());
    }
    if (typeof rawOptions === 'string') {
      const lines = rawOptions
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length > 0) {
        return lines.map((line) => line.replace(/^[A-Z][\.\)]?\s*/i, '').trim());
      }
    }
    return [];
  })();
  const normalizedOptions = questionType === 'Multiple Choice'
    ? Array.from({ length: expectedOptionsCount }, (_, idx) => {
        const llmValue = llmOptions[idx]?.trim();
        if (llmValue) return llmValue;
        const existingValue = existingOptionsNormalized[idx]?.trim();
        return existingValue || '';
      })
    : [];

  let answer = '';
  if (typeof obj.answer === 'string') {
    answer = obj.answer.trim();
  } else if (Array.isArray(obj.answer)) {
    answer = JSON.stringify(obj.answer);
  }
  if (!answer) {
    answer = existingAnswer || '';
  }

  const fallbackSubfield = defaults.subfieldOptions[0] ?? 'Others';
  const subfield = (typeof obj.subfield === 'string' ? obj.subfield.trim() : '') || existingSubfield || fallbackSubfield;

  const fallbackAcademic = defaults.academicLevels[0] ?? 'K12';
  const academicLevel = (typeof obj.academicLevel === 'string' ? obj.academicLevel.trim() : '') || existingAcademic || fallbackAcademic;

  const fallbackDifficulty = defaults.difficultyOptions[0] ?? '1';
  const difficulty = typeof obj.difficulty === 'string'
    ? obj.difficulty.trim() || existingDifficulty || fallbackDifficulty
    : typeof obj.difficulty === 'number'
      ? String(obj.difficulty)
      : existingDifficulty || fallbackDifficulty;

  const partial: Partial<ProblemRecord> = {
    question,
    questionType,
    options: normalizedOptions,
    answer,
    subfield,
    academicLevel,
    difficulty
  };
  return partial;
}
