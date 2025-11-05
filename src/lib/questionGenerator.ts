import type { DefaultSettings, LLMAgentSettings, ProblemRecord } from '../state/store';
import { chatStream } from './llmAdapter';

export interface CandidateForGeneration {
  id: string;
  text: string;
  classification?: string;
  confidence?: number;
  notes?: string;
}

export interface CandidateGenerationOutcome {
  status: 'converted' | 'skipped' | 'error';
  chosenCandidateId: string | null;
  patch?: Partial<ProblemRecord>;
  raw: string;
  reason?: string;
  message?: string;
}

interface LlmGenerationPayload {
  chosenCandidateId?: string;
  reason?: string;
  problem?: {
    question?: string;
    options?: string[];
    answer?: string;
    subfield?: string;
    academicLevel?: string;
    difficulty?: string;
  };
}

const sanitize = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.replace(/\s+/g, ' ');
};

const safeParseJson = (raw: string): LlmGenerationPayload => {
  if (!raw) {
    return {};
  }
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const snippet = start !== -1 && end !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  try {
    return JSON.parse(snippet);
  } catch (error) {
    throw Object.assign(new Error('Failed to parse LLM JSON output'), { cause: error });
  }
};

const buildCandidateBlock = (candidate: CandidateForGeneration, index: number): string => {
  const details: string[] = [];
  details.push(`Candidate ${index + 1}`);
  details.push(`id: ${candidate.id}`);
  if (candidate.classification) {
    details.push(`classification: ${candidate.classification}`);
  }
  if (typeof candidate.confidence === 'number') {
    details.push(`confidence: ${candidate.confidence.toFixed(2)}`);
  }
  if (candidate.notes) {
    details.push(`notes: ${candidate.notes}`);
  }
  return `${details.join(' | ')}\n---\n${candidate.text.trim()}`;
};

const buildPrompt = (
  candidates: CandidateForGeneration[],
  defaults: DefaultSettings,
  optionCount: number,
  meta?: { blockId?: string }
): string => {
  const lines: string[] = [];
  if (meta?.blockId) {
    lines.push(`Block ID: ${meta.blockId}`);
    lines.push('');
  }
  lines.push('## Candidate Pool');
  candidates.forEach((candidate, index) => {
    lines.push(buildCandidateBlock(candidate, index));
    lines.push('');
  });
  lines.push('## Output Requirements');
  lines.push('Respond with pure JSON only, no commentary.');
  lines.push('Schema: {');
  lines.push('  "chosenCandidateId": string (use "none" if skipping),');
  lines.push('  "reason": string,');
  lines.push('  "problem": {');
  lines.push('    "question": string,');
  lines.push(`    "options": string[${optionCount}] (exactly ${optionCount} options, ordered A, B, C, ...),`);
  lines.push('    "answer": string (for multiple choice, provide the correct option letter),');
  lines.push('    "subfield": string (from allowed list),');
  lines.push('    "academicLevel": string (from allowed list),');
  lines.push('    "difficulty": string (from allowed list)');
  lines.push('  } | null');
  lines.push('}');
  lines.push('If chosenCandidateId is "none", set problem to null and provide a clear reason.');
  lines.push('');
  lines.push('Allowed subfields: ' + defaults.subfieldOptions.join('; '));
  lines.push('Allowed academic levels: ' + defaults.academicLevels.join('; '));
  lines.push('Allowed difficulties: ' + defaults.difficultyOptions.join('; '));
  lines.push('');
  lines.push('Guidelines:');
  lines.push('- Pick at most one candidate.');
  lines.push('- Skip definitions/theorems/summaries that lack a direct question.');
  lines.push('- Skip anything that clearly references figures or diagrams.');
  lines.push('- When converting, keep the mathematical intent intact and ensure the solution is unique and consistent.');
  lines.push('- Produce concise, MathJax-compatible expressions (no Markdown code fences).');
  lines.push('- Answer must be the capital letter of the correct option.');
  return lines.join('\n');
};

const normalizeOptions = (options: unknown, expected: number): string[] => {
  const array = Array.isArray(options) ? options : [];
  const mapped = array.map((option) => sanitize(option)).filter((option) => option.length > 0);
  const padded = [...mapped];
  while (padded.length < expected) {
    padded.push('');
  }
  return padded.slice(0, expected);
};

const validatePatch = (patch: Partial<ProblemRecord>): string[] => {
  const issues: string[] = [];
  if (!patch.question || !patch.question.trim()) {
    issues.push('question');
  }
  if (!patch.answer || !patch.answer.trim()) {
    issues.push('answer');
  }
  if (!patch.subfield || !patch.subfield.trim()) {
    issues.push('subfield');
  }
  if (!patch.academicLevel || !patch.academicLevel.trim()) {
    issues.push('academicLevel');
  }
  if (!patch.difficulty || !patch.difficulty.trim()) {
    issues.push('difficulty');
  }
  if (patch.questionType === 'Multiple Choice') {
    const options = Array.isArray(patch.options) ? patch.options : [];
    if (options.length === 0 || options.some((opt) => !opt || !opt.trim())) {
      issues.push('options');
    }
    if (!/^[A-Z]$/.test(patch.answer || '')) {
      issues.push('answerLetter');
    } else {
      const index = (patch.answer || '').charCodeAt(0) - 65;
      if (index < 0 || index >= options.length || !options[index] || !options[index]?.trim()) {
        issues.push('answerIndex');
      }
    }
  }
  return issues;
};

export const generateProblemFromCandidates = async (
  candidates: CandidateForGeneration[],
  agent: LLMAgentSettings,
  defaults: DefaultSettings,
  meta?: { blockId?: string }
): Promise<CandidateGenerationOutcome> => {
  const pool = candidates.filter((candidate) => candidate.text.trim().length > 0);
  if (pool.length === 0) {
    return {
      status: 'skipped',
      chosenCandidateId: null,
      raw: '',
      reason: 'No usable candidates to convert.'
    };
  }

  const optionCount = Math.max(2, Math.min(10, Math.floor(defaults.optionsCount || 5)));
  const systemPrompt = agent.prompt?.trim() || 'You author rigorous mathematics assessment items.';
  const userContent = buildPrompt(pool, defaults, optionCount, meta);

  const raw = await chatStream([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ], agent.config, { temperature: 0.2 });

  let parsed: LlmGenerationPayload;
  try {
    parsed = safeParseJson(raw);
  } catch (error: any) {
    return {
      status: 'error',
      chosenCandidateId: null,
      raw,
      message: error?.message || 'Invalid JSON output from LLM.'
    };
  }

  const chosenIdRaw = sanitize(parsed.chosenCandidateId || '');
  const chosenCandidateId = chosenIdRaw.length > 0 ? chosenIdRaw : null;
  const reason = sanitize(parsed.reason || '');

  if (!chosenCandidateId || chosenCandidateId.toLowerCase() === 'none') {
    return {
      status: 'skipped',
      chosenCandidateId: null,
      raw,
      reason: reason || 'Model indicated no suitable candidate.'
    };
  }

  const exists = pool.some((candidate) => candidate.id === chosenCandidateId);
  if (!exists) {
    return {
      status: 'error',
      chosenCandidateId,
      raw,
      message: 'Chosen candidate ID not found in pool.'
    };
  }

  const problem = parsed.problem;
  if (!problem) {
    return {
      status: 'error',
      chosenCandidateId,
      raw,
      message: 'LLM omitted problem payload despite selecting a candidate.'
    };
  }

  const question = sanitize(problem.question);
  const answer = sanitize(problem.answer);
  const subfield = sanitize(problem.subfield);
  const academicLevel = sanitize(problem.academicLevel);
  const difficulty = sanitize(problem.difficulty);
  const options = normalizeOptions(problem.options, optionCount);

  const patch: Partial<ProblemRecord> = {
    questionType: 'Multiple Choice',
    question,
    options,
    answer,
    subfield,
    academicLevel,
    difficulty
  };

  const issues = validatePatch(patch);
  if (issues.length > 0) {
    return {
      status: 'error',
      chosenCandidateId,
      raw,
      message: `Missing or invalid fields: ${issues.join(', ')}`
    };
  }

  return {
    status: 'converted',
    chosenCandidateId,
    patch,
    raw,
    reason: reason || undefined
  };
};
