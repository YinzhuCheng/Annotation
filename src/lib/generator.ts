import { DefaultSettings, LLMAgentSettings, ProblemRecord } from '../state/store';
import { chatStream } from './llmAdapter';

type RawValueType = 'string' | 'array' | 'object' | 'primitive';

interface RawValueResult {
  type: RawValueType;
  value?: string;
  raw?: string;
  endIndex: number;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const decodeEscapeSequence = (char: string): string => {
  switch (char) {
    case '"':
      return '"';
    case '\\':
      return '\\';
    case '/':
      return '/';
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    default:
      return char;
  }
};

const readStringLiteral = (
  text: string,
  startIndex: number
): { value: string; endIndex: number; raw: string } => {
  let i = startIndex + 1;
  let value = '';
  let raw = '"';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      if (i + 1 >= text.length) break;
      const next = text[i + 1];
      raw += '\\' + next;
      if (next === 'u' && i + 5 < text.length) {
        const hex = text.substr(i + 2, 4);
        raw += hex;
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          value += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      value += decodeEscapeSequence(next);
      i += 2;
      continue;
    }
    if (ch === '"') {
      raw += '"';
      return { value, endIndex: i + 1, raw };
    }
    raw += ch;
    value += ch;
    i++;
  }
  return { value, endIndex: startIndex + 1, raw };
};

const readCollection = (
  text: string,
  startIndex: number,
  openChar: string,
  closeChar: string
): { raw: string; endIndex: number } => {
  let i = startIndex;
  let depth = 0;
  let raw = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const str = readStringLiteral(text, i);
      raw += str.raw;
      i = str.endIndex;
      continue;
    }
    raw += ch;
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      i++;
      if (depth === 0) {
        break;
      }
      continue;
    }
    i++;
  }
  return { raw, endIndex: i };
};

const findRawValue = (source: string, key: string): RawValueResult | null => {
  const keyRegex = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*`, 'i');
  const match = keyRegex.exec(source);
  if (!match) return null;
  let idx = match.index + match[0].length;
  const len = source.length;
  while (idx < len && /\s/.test(source[idx])) idx++;
  if (idx >= len) return null;
  const first = source[idx];
  if (first === '"') {
    const result = readStringLiteral(source, idx);
    return { type: 'string', value: result.value, endIndex: result.endIndex };
  }
  if (first === '[') {
    const collection = readCollection(source, idx, '[', ']');
    return { type: 'array', raw: collection.raw, endIndex: collection.endIndex };
  }
  if (first === '{') {
    const collection = readCollection(source, idx, '{', '}');
    return { type: 'object', raw: collection.raw, endIndex: collection.endIndex };
  }
  let end = idx;
  while (end < len && !/[,}\n\r]/.test(source[end])) end++;
  const value = source.slice(idx, end).trim();
  return { type: 'primitive', value, endIndex: end };
};

const decodeEscapedString = (input: string): string => {
  const synthetic = `"${input}"`;
  const result = readStringLiteral(synthetic, 0);
  return result.value;
};

const extractStringValueLoose = (source: string, key: string): string => {
  const found = findRawValue(source, key);
  if (!found) return '';
  if (found.type === 'string') {
    return (found.value ?? '').trim();
  }
  if (found.type === 'primitive') {
    return (found.value ?? '').trim().replace(/,$/, '');
  }
  return (found.raw ?? '').trim();
};

const parseArrayStrings = (raw: string): string[] => {
  const text = raw.trim();
  if (!text.startsWith('[')) return [];
  const values: string[] = [];
  let i = 1;
  const len = text.length;
  while (i < len - 1) {
    while (i < len && /[\s,]/.test(text[i])) i++;
    if (i >= len - 1) break;
    const ch = text[i];
    if (ch === '"') {
      const str = readStringLiteral(text, i);
      values.push(str.value.trim());
      i = str.endIndex;
      continue;
    }
    if (ch === '[' || ch === '{') {
      const nested = readCollection(text, i, ch, ch === '[' ? ']' : '}');
      i = nested.endIndex;
      continue;
    }
    let j = i;
    while (j < len && text[j] !== ',' && text[j] !== ']') j++;
    const token = text.slice(i, j).trim();
    if (token) values.push(token);
    i = j;
  }
  return values;
};

const parseObjectStringValues = (raw: string): string[] => {
  const text = raw.trim();
  if (!text.startsWith('{')) return [];
  const values: string[] = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    values.push(decodeEscapedString(match[2]).trim());
  }
  return values;
};

const extractOptionsLoose = (source: string): string[] => {
  const found = findRawValue(source, 'options');
  if (!found) return [];
  if (found.type === 'array' && found.raw) {
    return parseArrayStrings(found.raw);
  }
  if (found.type === 'object' && found.raw) {
    return parseObjectStringValues(found.raw);
  }
  if (found.type === 'string' && found.value) {
    return [found.value.trim()];
  }
  if (found.type === 'primitive' && found.value) {
    return [found.value.trim()];
  }
  return [];
};

const extractFieldsFromJsonLike = (text: string) => ({
  question: extractStringValueLoose(text, 'question'),
  questionType: extractStringValueLoose(text, 'questionType'),
  options: extractOptionsLoose(text),
  answer: extractStringValueLoose(text, 'answer'),
  subfield: extractStringValueLoose(text, 'subfield'),
  academicLevel: extractStringValueLoose(text, 'academicLevel'),
  difficulty: extractStringValueLoose(text, 'difficulty')
});

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
  user += '   - Always present your reply in two blocks: first "Analysis:" with your reasoning, then "JSON:" with the object.\n';
  user += '   - All JSON strings must escape backslashes, quotes, and control characters using standard JSON escaping (e.g., \\theta, \\n).\n';
  user += '   - Do not wrap the JSON or any string fields in LaTeX math delimiters such as $...$ or \\(...\\). Provide raw JSON only.\n';
  user += '   - Example: write the LaTeX fraction 1/2 as "\\\\frac{1}{2}" inside the JSON; writing "\\frac{1}{2}" will be rejected as invalid JSON.\n';

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

  const extracted = extractFieldsFromJsonLike(jsonText);

  const sanitizeText = (value: string): string => {
    if (!value) return '';
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) return '';
    return trimmed;
  };

  const allowedQuestionTypes: ProblemRecord['questionType'][] = ['Multiple Choice', 'Fill-in-the-blank', 'Proof'];
  const llmQuestionTypeRaw = sanitizeText(extracted.questionType);
  const questionType: ProblemRecord['questionType'] = allowedQuestionTypes.includes(llmQuestionTypeRaw as ProblemRecord['questionType'])
    ? (llmQuestionTypeRaw as ProblemRecord['questionType'])
    : targetType;

  const questionCandidate = sanitizeText(extracted.question);
  const question = questionCandidate || existingQuestion || baseInput;

  const llmOptions = extracted.options
    .map((option) => sanitizeText(option))
    .filter((option) => option.length > 0);

  const normalizedOptions = questionType === 'Multiple Choice'
    ? Array.from({ length: expectedOptionsCount }, (_, idx) => {
        const llmValue = llmOptions[idx];
        if (llmValue) return llmValue;
        const existingValue = existingOptionsNormalized[idx]?.trim();
        return existingValue || '';
      })
    : [];

  let answer = sanitizeText(extracted.answer);
  if (!answer) {
    answer = existingAnswer || '';
  }

  const fallbackSubfield = defaults.subfieldOptions[0] ?? 'Others';
  const subfield = sanitizeText(extracted.subfield) || existingSubfield || fallbackSubfield;

  const fallbackAcademic = defaults.academicLevels[0] ?? 'K12';
  const academicLevel = sanitizeText(extracted.academicLevel) || existingAcademic || fallbackAcademic;

  const fallbackDifficulty = defaults.difficultyOptions[0] ?? '1';
  const difficultyCandidate = sanitizeText(extracted.difficulty);
  const difficulty = difficultyCandidate || existingDifficulty || fallbackDifficulty;

  const patch: Partial<ProblemRecord> = {
    question,
    questionType,
    options: normalizedOptions,
    answer,
    subfield,
    academicLevel,
    difficulty
  };
  const missing: string[] = [];
  if (!question) missing.push('question');
  if (!questionType) missing.push('questionType');
  if (!answer) missing.push('answer');
  if (!subfield) missing.push('subfield');
  if (!academicLevel) missing.push('academicLevel');
  if (!difficulty) missing.push('difficulty');
  if (questionType === 'Multiple Choice' && normalizedOptions.some((opt) => !opt || !opt.trim())) {
    missing.push('options');
  }
  if (missing.length > 0) {
    const message = `Failed to parse LLM response: missing or invalid fields: ${missing.join(', ')}`;
    throw new LLMGenerationError(message, jsonText);
  }

  return { patch, raw };
}
