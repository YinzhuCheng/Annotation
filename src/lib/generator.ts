import { DefaultSettings, LLMAgentSettings, ProblemRecord } from '../state/store';
import { chatStream } from './llmAdapter';
import { jsonrepair } from 'jsonrepair';

const JSON_STRING_REGEX = /"([^"\\]*(?:\\.[^"\\]*)*)"/gs;

const escapeBareBackslashes = (text: string): string =>
  text.replace(/(?<!\\)\\(?!["\\\/bfnrtu])/g, '\\\\');

const escapeStringControlCharacters = (text: string): string =>
  text.replace(JSON_STRING_REGEX, (match, inner) => {
    const sanitized = inner.replace(/[\u0000-\u001F]/g, (char) => {
      switch (char) {
        case '\b':
          return '\\b';
        case '\f':
          return '\\f';
        case '\n':
          return '\\n';
        case '\r':
          return '\\r';
        case '\t':
          return '\\t';
        default: {
          const code = char.charCodeAt(0).toString(16).padStart(4, '0');
          return `\\u${code}`;
        }
      }
    });
    return `"${sanitized}"`;
  });

const buildJsonRepairCandidates = (original: string): string[] => {
  const candidates = new Set<string>();
  const push = (value: string) => {
    if (value && !candidates.has(value)) candidates.add(value);
  };

  push(original);
  const backslashEscaped = escapeBareBackslashes(original);
  push(backslashEscaped);
  push(escapeStringControlCharacters(original));
  push(escapeStringControlCharacters(backslashEscaped));
  const trimmed = original.trim();
  if (trimmed !== original) push(trimmed);

  return Array.from(candidates);
};

const decodeBase64ToString = (input: string): string => {
  const normalized = input.replace(/\s+/g, '');
  if (!normalized) return '';
  try {
    if (typeof atob === 'function') {
      const binary = atob(normalized);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch (error) {
    console.warn('Base64 decode via atob failed, attempting Buffer fallback', error);
  }
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(normalized, 'base64').toString('utf-8');
    }
  } catch (error) {
    console.warn('Base64 decode via Buffer failed', error);
  }
  return input;
};

const decodeTextField = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const decoded = decodeBase64ToString(trimmed);
  return decoded || trimmed;
};

export interface GeneratorConversationTurn {
  prompt: string;
  response: string;
  feedback?: string;
}

export class LLMGenerationError extends Error {
  raw: string;

  constructor(message: string, raw: string, cause?: unknown) {
    super(message);
    this.name = 'LLMGenerationError';
    this.raw = raw;
    if (cause !== undefined) {
      (this as any).cause = cause;
    }
  }
}

export async function generateProblemFromText(
  input: string,
  existing: ProblemRecord,
  agent: LLMAgentSettings,
  defaults: DefaultSettings,
  options?: {
    onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void;
    conversation?: GeneratorConversationTurn[];
  }
): Promise<{ patch: Partial<ProblemRecord>; raw: string }> {
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
  user += '1. Begin with a section labeled "Analysis:" where you reason step by step about the source problem, explore relevant properties, and decide how to adapt it to the target question type. Do not skip this analysis.\n';
  user += '2. Using the insights from your analysis, rewrite the problem so it fully conforms to the target question type while preserving the core idea and making the prompt self-contained.\n';
  user += '3. Populate every field (question, questionType, options, answer, subfield, academicLevel, difficulty) from your rewritten statement; treat the draft above only as optional hints. Avoid empty strings?if a field seems intrinsically unsuitable, explain why in the analysis before choosing the closest valid value.\n';
  user += `   - Set "questionType" in the JSON output to "${targetType}" exactly.\n`;
  user += '   - Select subfield, academicLevel, and difficulty from the allowed lists (use "Others: ..." only when no option fits).\n';
  if (targetType === 'Multiple Choice') {
    user += `   - Multiple Choice: create ${expectedOptionsCount} options labeled ${optionLabels.join(', ')} and ensure exactly one option is correct and identified in "answer".\n`;
  } else {
    user += '   - Non-multiple-choice question types must set "options" to an empty array [].\n';
  }
  user += '   - Fill-in-the-blank: insert exactly one explicit blank such as "___". When the source only asserts existence, ask for a single concrete witness or numerical property that fills that blank, and return the answer as a single consistent string (e.g., "4").\n';
  user += '   - Proof: phrase the question as a proof request and provide a concise, coherent proof outline in "answer".\n';
  user += '4. After the analysis, output a section labeled "JSON:" on a new line, followed immediately by only the JSON object containing the seven keys specified in the system message. Do not add Markdown fences, language tags, prefixes like "json", backticks, comments, or any other text before or after the JSON object. Violating this will be treated as an incorrect response.\n';
  user += '   - All JSON strings must escape backslashes, quotes, and control characters using standard JSON escaping (e.g., \\theta, \\n).\n';
  user += '   - Do not wrap the JSON or any string fields in LaTeX math delimiters such as $...$ or \\(...\\). Provide raw JSON only.\n';
  user += '   - Example: write the LaTeX fraction 1/2 as "\\\\frac{1}{2}" inside the JSON; writing "\\frac{1}{2}" will be rejected as invalid JSON.\n';
  user += '   - Encode the values of "question", "answer", "subfield", "academicLevel", "difficulty", and every entry inside "options" using standard Base64 (UTF-8) before placing them in the JSON.\n';
  user += '   - Generate the Base64 from the original LaTeX/plaintext without adding extra escapes, so that decoding the Base64 yields the exact wording you intend the user to see.\n';

  const conversation = options?.conversation ?? [];
  if (conversation.length > 0) {
    user += '\nConversation history (oldest first). Use prior feedback to refine the next draft.\n';
    conversation.forEach((turn, idx) => {
      const prompt = turn.prompt?.trim() || '(empty)';
      const response = turn.response?.trim() || '(empty)';
      const feedback = turn.feedback?.trim();
      user += `Round ${idx + 1}:\n`;
      user += `Prompt:\n${prompt}\n`;
      user += `Model reply:\n${response}\n`;
      if (feedback) {
        user += `User feedback:\n${feedback}\n`;
      }
      user += '\n';
    });
    user += 'Incorporate all constructive feedback points while keeping improvements cumulative.\n';
  }

  const raw = await chatStream([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user }
  ], agent.config, { temperature: 0.2 }, options?.onStatus ? { onStatus: options.onStatus } : undefined);

  const jsonMarker = raw.indexOf('JSON:');
  if (jsonMarker === -1) {
    console.error('LLM response missing JSON section', raw);
    throw new LLMGenerationError('LLM response missing JSON section', raw);
  }
  let jsonText = raw.slice(jsonMarker + 5).trim();
  const CODE_FENCES = ['```json', '```JSON', '```'];
  for (const fence of CODE_FENCES) {
    if (jsonText.startsWith(fence)) {
      const fenceEnd = jsonText.indexOf('```', fence.length);
      if (fenceEnd !== -1) {
        jsonText = jsonText.slice(fence.length, fenceEnd).trim();
      }
    }
  }
  if (jsonText.toLowerCase().startsWith('json')) {
    jsonText = jsonText.slice(4).trim();
  }
  if (!jsonText) {
    console.error('LLM response JSON section empty', raw);
    throw new LLMGenerationError('LLM response JSON section empty', raw);
  }

  let obj: any;
  try {
    obj = JSON.parse(jsonText);
  } catch (initialError) {
    const candidates = buildJsonRepairCandidates(jsonText);
    let lastError: unknown = initialError;
    for (const candidate of candidates) {
      try {
        obj = JSON.parse(candidate);
        if (candidate !== jsonText) {
          console.warn('Recovered JSON using auto-escape repair');
          jsonText = candidate;
        }
        lastError = undefined;
        break;
      } catch (candidateError) {
        lastError = candidateError;
      }
    }
    if (typeof obj === 'undefined') {
      try {
        const repairedText = jsonrepair(jsonText);
        obj = JSON.parse(repairedText);
        jsonText = repairedText;
        console.warn('Recovered JSON via jsonrepair fallback');
        lastError = undefined;
      } catch (repairError) {
        lastError = repairError;
      }
    }
    if (typeof obj === 'undefined') {
      console.error('Failed to parse repaired LLM JSON response', lastError, candidates);
      throw new LLMGenerationError('Failed to parse repaired LLM JSON response', raw, lastError);
    }
  }

  const allowedQuestionTypes: ProblemRecord['questionType'][] = ['Multiple Choice', 'Fill-in-the-blank', 'Proof'];
  const llmQuestionTypeRaw = typeof obj.questionType === 'string' ? obj.questionType.trim() : '';
  const questionType: ProblemRecord['questionType'] = allowedQuestionTypes.includes(llmQuestionTypeRaw as ProblemRecord['questionType'])
    ? (llmQuestionTypeRaw as ProblemRecord['questionType'])
    : targetType;

  const questionDecoded = decodeTextField(obj.question);
  const question = questionDecoded || existingQuestion || baseInput;

  const rawOptions = (obj as any)?.options;
  const llmOptions: string[] = (() => {
    if (Array.isArray(rawOptions)) {
      return rawOptions.map((o: any) => decodeTextField(o).trim());
    }
    if (rawOptions && typeof rawOptions === 'object') {
      return Object.entries(rawOptions as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        .map(([, value]) => decodeTextField(value).trim());
    }
    if (typeof rawOptions === 'string') {
      const lines = rawOptions
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length > 0) {
        return lines.map((line) => decodeTextField(line.replace(/^[A-Z][\.\)]?\s*/i, '').trim()));
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
    answer = decodeTextField(obj.answer);
  } else if (Array.isArray(obj.answer)) {
    answer = obj.answer.map((entry: unknown) => decodeTextField(entry)).filter((entry) => entry.length > 0).join('\n');
  }
  if (!answer) {
    answer = existingAnswer || '';
  }

  const fallbackSubfield = defaults.subfieldOptions[0] ?? 'Others';
  const subfield = decodeTextField(obj.subfield) || existingSubfield || fallbackSubfield;

  const fallbackAcademic = defaults.academicLevels[0] ?? 'K12';
  const academicLevel = decodeTextField(obj.academicLevel) || existingAcademic || fallbackAcademic;

  const fallbackDifficulty = defaults.difficultyOptions[0] ?? '1';
  const difficulty = typeof obj.difficulty === 'string'
    ? decodeTextField(obj.difficulty) || existingDifficulty || fallbackDifficulty
    : typeof obj.difficulty === 'number'
      ? String(obj.difficulty)
      : existingDifficulty || fallbackDifficulty;

  const patch: Partial<ProblemRecord> = {
    question,
    questionType,
    options: normalizedOptions,
    answer,
    subfield,
    academicLevel,
    difficulty
  };
  return { patch, raw };
}
