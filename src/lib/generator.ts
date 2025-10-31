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

  const systemPrompt = agent.prompt?.trim() || `You are a mathematics problem polishing assistant. Given a raw prompt and a target question type, rewrite the problem text so it fully conforms to that type, then construct all associated structured fields. Reply with a JSON object containing exactly the keys: question, questionType, options, answer, subfield, academicLevel, difficulty.`;

  let user = `Original source text (blank means none):\n${sanitizedInput}\n\n`;
  user += 'Current draft for reference (existing values may be overwritten):\n';
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
  user += '- Rewrite or polish the problem statement so it fully conforms to the target question type while preserving the core idea.\n';
  user += '- Add concise context or definitions whenever needed so the rewritten problem is self-contained and unambiguous.\n';
  user += '- Generate every field (question, questionType, options, answer, subfield, academicLevel, difficulty) from your rewritten statement; treat the reference draft above purely as optional hints.\n';
  user += `- Set "questionType" in the output to "${targetType}" exactly.\n`;
  user += `- Select subfield, academicLevel, and difficulty from the allowed lists (use "Others: ..." only when no option fits).\n`;
  if (targetType === 'Multiple Choice') {
    user += `- Multiple Choice: produce "options" as an array of strings labeled ${optionLabels.join(', ')} with length ${expectedOptionsCount}, and ensure "answer" names the single correct choice.\n`;
  } else {
    user += '- Non-multiple-choice question types must set "options" to an empty array [].\n';
  }
  if (targetType === 'Fill-in-the-blank') {
    user += '- Fill-in-the-blank: insert explicit blanks such as "___" and convert proof-style prompts into concrete fill-in requests (e.g., a specific value, count, or example).\n';
    user += '- If the source only asserts existence, design blanks that capture concrete witnesses or numerical properties and supply those exact values in the answer.\n';
    user += 'Example transformations:\n';
    user += 'Original: "Let x + 3 = 7. Solve for x." -> "Solve for x: ___ + 3 = 7."\n';
    user += 'Original: "Prove there are infinitely many pairwise coprime composite good numbers." -> "A positive integer n is called a good number if {n^2/5} = 3/5. Provide one composite good number whose distinct prime factors multiply to ___."\n';
    user += '- Provide the answer as the exact value(s) that fill the blank(s); when multiple blanks exist, use an ordered JSON array such as ["4","9"].\n';
  }
  if (targetType === 'Proof') {
    user += '- Proof: phrase the question as a proof request and give a concise outline of a valid proof strategy in the "answer" field.\n';
  }
  user += '- Verify internal consistency: the answer must satisfy the rewritten question and every blank or option must align with it.\n';
  user += '- Return format: output a single JSON object containing exactly the keys required in the system message, with no additional commentary or trailing text.\n';

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
