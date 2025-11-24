import { DefaultSettings, LLMAgentSettings, ProblemRecord } from '../state/store';
import { chatStream } from './llmAdapter';

const FORMAT_FIX_RETRY_LIMIT = 3;

export interface ParsedGeneratedQuestion {
  question: string;
  questionType: string;
  options: string[];
  answer: string;
  subfield: string;
  academicLevel: string;
  difficulty: string;
}

const extractTagContent = (source: string, rawTag: string): string | null => {
  if (!source) return null;

  const openTag = `<${rawTag}>`;
  const closeTag = `</${rawTag}>`;
  const lowerSource = source.toLowerCase();
  const lowerOpen = openTag.toLowerCase();
  const lowerClose = closeTag.toLowerCase();

  const openIndex = lowerSource.indexOf(lowerOpen);
  if (openIndex === -1) return null;

  const contentStart = openIndex + openTag.length;
  const closeIndex = lowerSource.indexOf(lowerClose, contentStart);
  if (closeIndex === -1) return null;

  const inner = source.slice(contentStart, closeIndex).trim();
  if (!inner) return null;

  const cleanResult = (value: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withoutTrailing = trimmed.replace(/\s*}+\s*$/, '').trim();
    return withoutTrailing || null;
  };

  const extractBetween = (input: string, openSequence: string): string | null => {
    const openIdx = input.indexOf(openSequence);
    if (openIdx === -1) return null;
    let depth = openSequence.length;
    for (let i = openIdx + openSequence.length; i < input.length; i += 1) {
      const ch = input[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return input.slice(openIdx + openSequence.length, i);
        }
      }
    }
    return input.slice(openIdx + openSequence.length);
  };

  const fromDouble = cleanResult(extractBetween(inner, '{{'));
  if (fromDouble !== null) return fromDouble;

  const fromSingle = cleanResult(extractBetween(inner, '{'));
  if (fromSingle !== null) return fromSingle;

  return cleanResult(inner) || null;
};

const normalizeKey = (input: string): string => input
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const cleanOptionText = (fragment: string): string | null => {
  if (!fragment) return null;
  let text = fragment.trim();
  if (!text) return null;
  text = text.replace(/^[-?*?]+\s*/, '').trim();
  if (/^\(none\)$/i.test(text) || /^none$/i.test(text)) return null;
  if (/<option text>/i.test(text) || /<value>/i.test(text)) return null;
  const labeled = text.match(/^([A-Z])[)\.-:]\s*([\s\S]*)$/);
  if (labeled) {
    const body = labeled[2].trim();
    return body || labeled[1];
  }
  return text;
};

const addOptionFragment = (fragment: string, target: string[]) => {
  if (!fragment) return;
  let text = fragment.trim();
  if (!text) return;

  if (/^\(none\)$/i.test(text) || /^none$/i.test(text)) return;
  if (/<option text>/i.test(text) || /<value>/i.test(text)) return;

  const labeled = text.match(/^([A-Z])[)\.-:]\s*([\s\S]*)$/);
  if (labeled) {
    const body = cleanOptionText(text);
    if (body) target.push(body);
    return;
  }

  text = text.replace(/^[-*]+\s*/, '').trim();
  if (!text) return;

  if (target.length === 0) {
    target.push(text);
  } else {
    const combined = `${target[target.length - 1]}\n${text}`.trim();
    target[target.length - 1] = combined;
  }
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

  if (!content) {
    return result;
  }

  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return result;

  const lines = normalized.split('\n').map((line) => line.replace(/\r$/, ''));
  const sections: Record<string, string[]> = {};
  const headers: Record<string, string> = {};
  const bodySectionKeys = new Set<string>([
    'question',
    'question_type',
    'questiontype',
    'type',
    'options',
    'answer',
    'subfield',
    'subfields',
    'academic',
    'academic_level',
    'academiclevel',
    'difficulty'
  ]);

  let idx = 0;

  const firstLine = lines[0]?.trim();
  if (firstLine && /^HTTP\/\d+(?:\.\d+)?\s+\d{3}/i.test(firstLine)) {
    idx = 1;
  }

  let currentSection: string | null = null;

  while (idx < lines.length) {
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();
    if (!trimmed) {
      idx += 1;
      break;
    }
    if (/^}+$/.test(trimmed)) {
      idx += 1;
      continue;
    }

    const kvMatch = trimmed.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!kvMatch) {
      break;
    }

    const rawKey = kvMatch[1];
    const normalizedKey = normalizeKey(rawKey);
    const value = kvMatch[2]?.trim() ?? '';

    if (bodySectionKeys.has(normalizedKey)) {
      currentSection = normalizedKey;
      sections[normalizedKey] = sections[normalizedKey] || [];
      if (value) {
        sections[normalizedKey].push(value);
      }
      idx += 1;
      break;
    }

    headers[rawKey.toLowerCase()] = value;
    idx += 1;
  }

  while (idx < lines.length && lines[idx].trim() === '') {
    idx += 1;
  }

  for (; idx < lines.length; idx += 1) {
    const rawLine = lines[idx].replace(/\r$/, '');
    const trimmed = rawLine.trimEnd();
    if (/^}+$/.test(trimmed.trim())) {
      if (currentSection === 'answer') {
        currentSection = null;
      }
      continue;
    }
    const sectionMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 _-]*)\s*:\s*(.*)$/);
    if (sectionMatch) {
      const key = normalizeKey(sectionMatch[1]);
      currentSection = key;
      sections[key] = sections[key] || [];
      const remainder = sectionMatch[2];
      if (remainder) {
        sections[key].push(remainder.trim());
        if (key === 'answer') {
          currentSection = null;
        }
      } else if (key === 'answer') {
        currentSection = 'answer';
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(rawLine);
      continue;
    }
  }

  const getSectionText = (key: string): string => {
    const payload = sections[key];
    if (!payload || payload.length === 0) return '';
    return payload.join('\n').trim();
  };

  const getHeader = (key: string): string => headers[key.toLowerCase()]?.trim() ?? '';

  const optionsSection = sections['options'] ?? [];
  const options: string[] = [];
  if (optionsSection.length === 1 && /^\s*\(none\)\s*$/i.test(optionsSection[0])) {
    // explicit none
  } else if (optionsSection.length > 0) {
    const block = optionsSection.join('\n').replace(/\r/g, '').trim();
    if (block && !/^\(none\)$/i.test(block)) {
      const segments = block.split(/(?=[A-Z][)\.-:])/).map((part) => part.trim()).filter(Boolean);
      segments.forEach((segment) => addOptionFragment(segment, options));
      if (options.length === 0) {
        parseOptionValue(block, options);
      }
    }
  }

  const typeHeader = getHeader('x-question-type')
    || getHeader('x-questiontype')
    || getHeader('question-type')
    || getSectionText('question_type')
    || getSectionText('questiontype')
    || getSectionText('type');

  const subfieldHeader = getHeader('x-subfield') || getHeader('subfield');
  const academicHeader = getHeader('x-academic-level') || getHeader('x-academic') || getHeader('academic-level');
  const difficultyHeader = getHeader('x-difficulty') || getHeader('difficulty');
  const answerHeader = getHeader('x-answer') || getHeader('answer');

  result.question = getSectionText('question');
  result.questionType = typeHeader;
  result.options = options;
  const answerBlock = getSectionText('answer') || answerHeader;
  result.answer = answerBlock.replace(/\s*}+\s*$/, '').trim();
  result.subfield = getSectionText('subfield') || getSectionText('subfields') || subfieldHeader;
  result.academicLevel = getSectionText('academic_level') || getSectionText('academic') || getSectionText('academiclevel') || academicHeader;
  result.difficulty = getSectionText('difficulty') || difficultyHeader;

  return result;
};

export interface GeneratorConversationTurn {
  prompt: string;
  response: string;
  feedback?: string;
}

export class LLMGenerationError extends Error {
  raw: string;
  displayMessage: string;

  constructor(message: string, raw: string, cause?: unknown) {
    super(message);
    this.name = 'LLMGenerationError';
    const normalizedRaw = typeof raw === 'string' ? raw : '';
    const trimmedRaw = normalizedRaw.trim();
    this.raw = normalizedRaw;
    this.displayMessage = trimmedRaw ? `${message}\n\n${normalizedRaw}` : message;
    if (cause !== undefined) {
      (this as any).cause = cause;
    }
  }
}

const buildFormatFixPrompt = (errorMessage: string, rawResponse: string): string => {
  const lines: string[] = [];
  lines.push('Your previous reply could not be parsed by our structured data validator.');
  lines.push('');
  lines.push('### Parser error');
  lines.push(errorMessage.trim() || '(unspecified)');
  lines.push('');
  lines.push('### Your previous reply (for reference)');
  lines.push(rawResponse.trim() || '(empty)');
  lines.push('');
  lines.push('Please resend the full output in the exact format described earlier: include both the <Thinking> and <Generated Question> blocks, fill every required field, and ensure the Generated Question block lists Question, Options (or "(none)" only for non-multiple-choice), and Answer with valid content. Do not add extra commentary.');
  return lines.join('\n');
};

export async function generateProblemFromText(
  input: string,
  existing: ProblemRecord,
  agent: LLMAgentSettings,
  defaults: DefaultSettings,
  options?: {
    onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void;
    conversation?: GeneratorConversationTurn[];
  }
): Promise<{ patch: Partial<ProblemRecord>; raw: string; generatedBlock: string; parsed: ParsedGeneratedQuestion }> {
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

  const systemPrompt = agent.prompt?.trim() || [
    'You are an expert mathematics assessment authoring assistant.',
    'Follow the user instructions precisely and focus on mathematical soundness.',
    'Every reply must contain exactly the <Thinking> and <Generated Question> blocks described by the user.'
  ].join(' ');

  const conversation = options?.conversation ?? [];
  const feedbackItems: string[] = [];
  conversation.forEach((turn, idx) => {
    const feedback = turn.feedback?.trim();
    if (feedback) {
      const normalized = feedback.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
      if (normalized) {
        feedbackItems.push(`- Round ${idx + 1}: ${normalized}`);
      }
    }
  });

  const userLines: string[] = [];

  userLines.push('## Objective');
  userLines.push('Refine the mathematics problem using the provided context while ensuring every required field is valid and aligned with the target question type.');
  userLines.push('');
  userLines.push(`Target question type: ${targetType}`);
  userLines.push('');

  userLines.push('## Source Context');
  userLines.push('Original source text (blank means none):');
  userLines.push(sanitizedInput);
  userLines.push('');
  userLines.push('Existing draft values (you may replace any of them if needed):');
  userLines.push(`- questionType: ${targetType}`);
  userLines.push(`- question: ${existingQuestion || '<missing>'}`);
  if (targetType === 'Multiple Choice') {
    userLines.push(`- options (expected ${expectedOptionsCount}):`);
    userLines.push(...optionLabels.map((label, idx) => {
      const value = existingOptionsNormalized[idx]?.trim();
      return `  ${label}: ${value || '<missing>'}`;
    }));
  } else {
    userLines.push('- options: (none expected)');
  }
  userLines.push(`- answer: ${existingAnswer || '<missing>'}`);
  userLines.push(`- subfield: ${existingSubfield || '<missing>'}`);
  userLines.push(`- academicLevel: ${existingAcademic || '<missing>'}`);
  userLines.push(`- difficulty: ${existingDifficulty || '<missing>'}`);
  userLines.push('');

  userLines.push('## Allowed Field Values');
  userLines.push(`- subfields: ${subfieldList} (you may reply with "Others: <short descriptor>" if none fit)`);
  userLines.push(`- academic levels: ${academicList}`);
  userLines.push(`- difficulty options: ${difficultyList}`);
  userLines.push('');

  if (conversation.length > 0) {
    userLines.push('## Feedback Summary');
    if (feedbackItems.length > 0) {
      userLines.push(...feedbackItems);
    } else {
      userLines.push('- No explicit feedback so far; maintain prior improvements and refine them further.');
    }
    userLines.push('');
  }

  userLines.push('## Workflow Requirements');
  userLines.push('1. Structure the <Thinking> block with three numbered steps exactly in this order:');
  userLines.push('   - 1. Feedback alignment - reference each bullet from the Feedback Summary (or explicitly state that none exists) and describe how you will address it.');
  userLines.push('   - 2. Mathematical study - analyze the source problem like a teacher, noting key concepts, invariants, and solution strategies.');
  userLines.push('   - 3. Adaptation plan - explain how you will reshape the problem to fit the target question type while preserving the core mathematical idea.');
  userLines.push('2. Produce the final version based on that plan and fill every required field (question, questionType, options, answer, subfield, academicLevel, difficulty). All narrative text and labels must be written in English even if the source materials are in other languages. If any selection is ambiguous, justify it in the analysis before choosing the closest valid value.');
  userLines.push('   - Keep questionType exactly equal to the target type.');
  userLines.push('   - Choose subfield, academicLevel, and difficulty from the allowed lists (use "Others: ..." only when nothing fits).');
  userLines.push('   - Multiple Choice: output exactly the expected number of options labeled sequentially (A, B, C, ...), with one correct option clearly reflected in the final answer.');
  userLines.push('   - Fill-in-the-blank: include exactly one blank such as "___" and provide a single definitive answer string.');
  userLines.push('   - Proof: phrase the prompt as a proof request and summarize a concise, logically ordered proof in the answer.');
  userLines.push('3. Ensure every mathematical expression you provide renders without errors in MathJax, which powers our UI preview. Prefer MathJax-supported commands and avoid syntax that requires additional packages or extensions; do not wrap math in Markdown fences.');
  userLines.push('4. Preserve LaTeX syntax using raw TeX (single backslashes) without additional escaping or Markdown fences.');
  userLines.push('5. Integrate insights from all prior rounds instead of restarting from scratch.');
  userLines.push('');

  userLines.push('## Output Contract');
  userLines.push('Reply with exactly the two blocks shown below and no extra commentary. Leave a blank line between </Thinking> and <Generated Question>. Replace every placeholder with real content.');
  userLines.push('<Thinking>{{');
  userLines.push('Analysis:');
  userLines.push('1. Feedback alignment - <list how each feedback item will be satisfied, or state that there is no prior feedback>');
  userLines.push('2. Mathematical study - <summarize the core ideas, invariants, and solution path of the source problem>');
  userLines.push('3. Adaptation plan - <describe how the final task will match the target type while preserving the key concept>');
  userLines.push('}}</Thinking>');
  userLines.push('');
  userLines.push('<Generated Question>{{');
  userLines.push(`questionType: ${targetType}`);
  userLines.push('subfield: <value from allowed list or "Others: ...">');
  userLines.push('academicLevel: <value from allowed list>');
  userLines.push('difficulty: <value from allowed list>');
  userLines.push('');
  userLines.push('Question:');
  userLines.push('<final question text>');
  userLines.push('');
  if (targetType === 'Multiple Choice') {
    userLines.push('Options:');
    optionLabels.forEach((label) => {
      userLines.push(`${label}) <option text>`);
    });
  } else {
    userLines.push('Options: (none)');
  }
  userLines.push('');
  userLines.push('Answer:');
  userLines.push('<final answer (letter for Multiple Choice, full text otherwise)>');
  userLines.push('}}</Generated Question>');
  userLines.push('Formatting notes: replace all <...> placeholders, keep option labels sequential when required, and do not add any text after </Generated Question>.');

  if (conversation.length > 0) {
    userLines.push('');
    userLines.push('## Conversation History (oldest first)');
    userLines.push('Use the earlier attempts and feedback to refine the next draft. Keep improvements cumulative.');
    conversation.forEach((turn, idx) => {
      const prompt = turn.prompt?.trim() || '(empty)';
      const response = turn.response?.trim() || '(empty)';
      const feedback = turn.feedback?.trim();
      userLines.push(`Round ${idx + 1} Prompt:`);
      userLines.push(prompt);
      userLines.push(`Round ${idx + 1} Model Reply:`);
      userLines.push(response);
      if (feedback) {
        userLines.push(`Round ${idx + 1} User Feedback:`);
        userLines.push(feedback);
      }
      userLines.push('');
    });
    userLines.push('Incorporate all constructive feedback points while keeping improvements cumulative.');
  }

  const user = userLines.join('\n');

  const baseMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user }
  ];

  const handlers = options?.onStatus ? { onStatus: options.onStatus } : undefined;

  const tryBuildResult = (rawResponse: string) => {
    const generatedSection = extractTagContent(rawResponse, 'Generated Question');
    if (!generatedSection) {
      console.error('Generated Question block missing', rawResponse);
      throw new LLMGenerationError('Generated Question block missing', rawResponse);
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
      throw new LLMGenerationError(message, rawResponse);
    }

    return { patch, raw: rawResponse, generatedBlock: generatedSection, parsed: extracted };
  };

  let raw = await chatStream(baseMessages, agent.config, { temperature: 0.2 }, handlers);

  for (let fixAttempt = 0; fixAttempt <= FORMAT_FIX_RETRY_LIMIT; fixAttempt += 1) {
    try {
      return tryBuildResult(raw);
    } catch (err) {
      const isParseError = err instanceof LLMGenerationError;
      const hasRetriesLeft = fixAttempt < FORMAT_FIX_RETRY_LIMIT;
      if (!isParseError || !hasRetriesLeft) {
        throw err;
      }
      const fixPrompt = buildFormatFixPrompt(err.message, raw);
      const fixMessages = [
        ...baseMessages,
        { role: 'assistant', content: raw },
        { role: 'user', content: fixPrompt }
      ];
      raw = await chatStream(fixMessages, agent.config, { temperature: 0 }, handlers);
    }
  }

  throw new LLMGenerationError('Failed to repair malformed LLM response after multiple attempts.', raw);
}

const parseReviewerJson = (raw: string): { status?: string; issues?: unknown; feedback?: unknown } | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const attempt = (payload: string) => {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  };
  const direct = attempt(trimmed);
  if (direct) return direct;
  const firstIdx = trimmed.indexOf('{');
  const lastIdx = trimmed.lastIndexOf('}');
  if (firstIdx !== -1 && lastIdx !== -1 && lastIdx > firstIdx) {
    const slice = trimmed.slice(firstIdx, lastIdx + 1);
    return attempt(slice);
  }
  return null;
};

const normalizeIssues = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : String(item))).filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value.split(/\n|;/).map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return [];
};

export interface ReviewAuditResult {
  status: 'pass' | 'fail';
  issues: string[];
  feedback: string;
  raw: string;
}

export async function reviewGeneratedQuestion(
  draft: {
    raw: string;
    generatedBlock: string;
    parsed: ParsedGeneratedQuestion;
    patch: Partial<ProblemRecord>;
    targetType: ProblemRecord['questionType'];
  },
  agent: LLMAgentSettings,
  options?: {
    onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void;
  }
): Promise<ReviewAuditResult> {
  const effectiveType: ProblemRecord['questionType'] = (draft.patch.questionType as ProblemRecord['questionType']) || draft.targetType;
  const questionText = draft.patch.question || draft.parsed.question;
  const answerText = draft.patch.answer || draft.parsed.answer;
  const subfieldText = draft.patch.subfield || draft.parsed.subfield;
  const academicText = draft.patch.academicLevel || draft.parsed.academicLevel;
  const difficultyText = draft.patch.difficulty || draft.parsed.difficulty;
  const optionsSource = Array.isArray(draft.patch.options) && draft.patch.options.length > 0
    ? draft.patch.options
    : draft.parsed.options;
  const normalizedOptions = effectiveType === 'Multiple Choice'
    ? optionsSource
      .map((opt) => (typeof opt === 'string' ? opt.trim() : ''))
      .filter((opt) => opt.length > 0)
    : [];

  const optionLines = normalizedOptions.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`);

  const guidelines: string[] = [];
  guidelines.push('1. Clarity: the question must be understandable, contain no undefined terminology, and avoid ambiguous phrasing.');
  guidelines.push('2. Multiple Choice validation: ensure options are distinct, the stated answer maps to exactly one option label, and no other option obviously shares the same truth value.');
  guidelines.push('3. Formatting & MathJax: the <Generated Question> block must include all required fields exactly once (questionType, subfield, academicLevel, difficulty, Question, Options/none, Answer), and every mathematical expression must be valid MathJax (no unsupported environments or Markdown fences).');
  guidelines.push('4. Language: all narrative content, labels, and explanations must be written in English; flag any non-English words (aside from standard mathematical symbols).');
  guidelines.push('If any criterion fails, respond with status="fail" and describe each problem in "issues". Otherwise respond with status="pass".');

  const lines: string[] = [];
  lines.push('## Review Goals');
  lines.push(...guidelines);
  lines.push('');
  lines.push('## Parsed Fields');
  lines.push(`questionType: ${effectiveType}`);
  lines.push(`subfield: ${subfieldText || '<missing>'}`);
  lines.push(`academicLevel: ${academicText || '<missing>'}`);
  lines.push(`difficulty: ${difficultyText || '<missing>'}`);
  lines.push('');
  lines.push('Question:');
  lines.push(questionText || '<missing>');
  lines.push('');
  if (effectiveType === 'Multiple Choice') {
    lines.push('Options:');
    if (optionLines.length === 0) {
      lines.push('<missing>');
    } else {
      lines.push(...optionLines);
    }
    lines.push('');
  } else {
    lines.push('Options: (none expected)');
    lines.push('');
  }
  lines.push('Answer:');
  lines.push(answerText || '<missing>');
  lines.push('');
  lines.push('## Generated Question Block');
  lines.push(draft.generatedBlock);
  lines.push('');
  lines.push('## Full Model Response');
  lines.push(draft.raw);

  const system = agent.prompt?.trim() || DEFAULT_AGENT_PROMPTS.reviewer;
  const rawReview = await chatStream([
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') }
  ], agent.config, { temperature: 0 }, options?.onStatus ? { onStatus: options.onStatus } : undefined);

  const parsed = parseReviewerJson(rawReview);
  const status: 'pass' | 'fail' = parsed?.status === 'pass' ? 'pass' : 'fail';
  const issues = normalizeIssues(parsed?.issues);
  const feedback = typeof parsed?.feedback === 'string' ? parsed.feedback.trim() : '';
  const normalizedRaw = rawReview.trim();
  const finalIssues = status === 'fail'
    ? (issues.length > 0 ? issues : ['Reviewer marked status as fail but did not provide specific issues.'])
    : issues;
  return {
    status,
    issues: finalIssues,
    feedback: feedback || (status === 'pass' ? 'All checks passed.' : ''),
    raw: normalizedRaw || rawReview
  };
}
