import { DefaultSettings, LLMAgentSettings, ProblemRecord } from '../state/store';
import { chatStream } from './llmAdapter';

interface ParsedGeneratedQuestion {
  question: string;
  questionType: string;
  options: string[];
  answer: string;
  subfield: string;
  academicLevel: string;
  difficulty: string;
}

const extractTagContent = (source: string, rawTag: string): string | null => {
  const tagPattern = rawTag.replace(/\s+/g, '\\s+');
  const regex = new RegExp(`<${tagPattern}>\\s*{{([\\s\\S]*?)}}`, 'i');
  const match = regex.exec(source);
  return match ? match[1].trim() : null;
};

const cleanOptionText = (fragment: string): string | null => {
  if (!fragment) return null;
  let text = fragment.trim();
  if (!text) return null;
  text = text.replace(/^[-?*?]+\s*/, '').trim();
  if (/^\(none\)$/i.test(text) || /^none$/i.test(text)) return null;
  if (/<option text>/i.test(text) || /<value>/i.test(text)) return null;
  const labeled = text.match(/^([A-Z])[)\.-:]\s*(.*)$/);
  if (labeled) {
    const body = labeled[2].trim();
    return body || labeled[1];
  }
  return text;
};

const addOptionFragment = (fragment: string, target: string[]) => {
  const option = cleanOptionText(fragment);
  if (option) target.push(option);
};

const parseOptionValue = (value: string, target: string[]) => {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (/^\(none\)$/i.test(trimmed) || /^none$/i.test(trimmed)) return;
  const splitByLabel = trimmed.split(/(?=[A-Z][)\.-:])/).map((part) => part.trim()).filter(Boolean);
  if (splitByLabel.length > 0) {
    splitByLabel.forEach((part) => addOptionFragment(part, target));
    return;
  }
  trimmed.split(/;|\|/).forEach((part) => addOptionFragment(part, target));
  if (!trimmed.includes(';') && !trimmed.includes('|')) {
    addOptionFragment(trimmed, target);
  }
};

const parseGeneratedQuestionContent = (content: string): ParsedGeneratedQuestion => {
  const result: ParsedGeneratedQuestion = {
    question: '',
    questionType: '',
    options: [],
    answer: '',
    subfield: '',
    academicLevel: '',
    difficulty: ''
  };

  const lines = content.split(/\r?\n/).map((line) => line.trim());
  let currentField: 'question' | 'options' | null = null;

  for (const line of lines) {
    if (!line) continue;

    const kvMatch = line.match(/^([A-Za-z ]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().toLowerCase().replace(/\s+/g, '');
      const value = kvMatch[2].trim();

      switch (key) {
        case 'question':
          result.question = value;
          currentField = 'question';
          break;
        case 'questiontype':
        case 'type':
          result.questionType = value;
          currentField = null;
          break;
        case 'options':
          if (/^\(none\)$/i.test(value) || /^none$/i.test(value)) {
            currentField = null;
          } else {
            currentField = 'options';
            if (value) parseOptionValue(value, result.options);
          }
          break;
        case 'answer':
          result.answer = value;
          currentField = null;
          break;
        case 'subfield':
        case 'subfields':
          result.subfield = value;
          currentField = null;
          break;
        case 'academiclevel':
        case 'academic':
          result.academicLevel = value;
          currentField = null;
          break;
        case 'difficulty':
          result.difficulty = value;
          currentField = null;
          break;
        default:
          currentField = null;
      }
      continue;
    }

    if (currentField === 'question') {
      result.question = `${result.question} ${line}`.trim();
      continue;
    }

    if (currentField === 'options' || /^[A-Z][)\.-:]/.test(line)) {
      addOptionFragment(line, result.options);
      currentField = 'options';
    }
  }

  return result;
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
  user += `   - Set "questionType" in the Generated Question block to "${targetType}" exactly.\n`;
  user += '   - Select subfield, academicLevel, and difficulty from the allowed lists (use "Others: ..." only when no option fits).\n';
  if (targetType === 'Multiple Choice') {
    user += `   - Multiple Choice: create ${expectedOptionsCount} options labeled ${optionLabels.join(', ')} and ensure exactly one option is correct and identified in "answer".\n`;
  } else {
    user += '   - Non-multiple-choice question types must output "options: (none)" in the Generated Question block.\n';
  }
  user += '   - Fill-in-the-blank: insert exactly one explicit blank such as "___". When the source only asserts existence, ask for a single concrete witness or numerical property that fills that blank, and return the answer as a single consistent string (e.g., "4").\n';
  user += '   - Proof: phrase the question as a proof request and provide a concise, coherent proof outline in "answer".\n';
  user += '4. After the analysis, emit the final answer strictly in the template below (no extra text before or after it).\n';
  user += '   Output Format:\n';
  user += '   <Thinking>{{<analysis text>}}</Thinking>\n';
  user += '   <Generated Question>{{\n';
  user += '   questionType: <value>\n';
  user += '   question: <value>\n';
  user += '   options:\n';
  user += '   A) <option text>\n';
  user += '   B) <option text>\n';
  user += '   answer: <value>\n';
  user += '   subfield: <value>\n';
  user += '   academicLevel: <value>\n';
  user += '   difficulty: <value>\n';
  user += '   }}</Generated Question>\n';
  user += '   - Additional requirements:\n';
  user += '     ? Keep the field names exactly as shown (case-sensitive).\n';
  user += '     ? Use raw LaTeX (single backslashes) inside values; do not add extra escaping or Markdown fences.\n';
  user += '     ? Replace all placeholder text (e.g., <value>, A) <option text>) with the actual content and remove example lines you do not need.\n';
  user += '     ? If the question type is not Multiple Choice, write "options: (none)" on that line and do not list option lines.\n';
  user += '     ? When the question type is Multiple Choice, put each option on its own line starting with "A)", "B)", etc. (add C), D), ... as required).\n';
  user += '     ? Do not output any commentary outside the <Thinking> and <Generated Question> tags.\n';

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

  const generatedSection = extractTagContent(raw, 'Generated Question');
  if (!generatedSection) {
    console.error('Generated Question block missing', raw);
    throw new LLMGenerationError('Generated Question block missing', raw);
  }

  const extracted = parseGeneratedQuestionContent(generatedSection);

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
    throw new LLMGenerationError(message, raw);
  }

  return { patch, raw };
}
