const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type OptionFragmentSource = 'labeled' | 'sequence' | 'fallback';

export interface OptionFragment {
  label: string;
  text: string;
  source: OptionFragmentSource;
}

export const DEFAULT_OPTION_PLACEHOLDER = '\\';

const toOptionLabel = (index: number): string => {
  const bounded = Math.max(0, Math.min(LETTERS.length - 1, index));
  return LETTERS.charAt(bounded);
};

const sanitizeText = (input: string): string => input.replace(/\s+/g, ' ').trim();

const stripQuotes = (input: string): string => input.replace(/^['"`\s]+|['"`\s]+$/g, '');

const normalizeLabel = (raw: string | undefined | null): string => {
  if (!raw) return '';
  const char = raw.trim().charAt(0).toUpperCase();
  return LETTERS.includes(char) ? char : '';
};

const splitInlineSegments = (token: string): string[] => {
  const pattern = /([A-Z])\s*[)\.\-:：、]\s*/gi;
  const segments: string[] = [];
  let match: RegExpExecArray | null;
  let currentLabel: string | null = null;
  let lastIndex = 0;
  while ((match = pattern.exec(token))) {
    if (currentLabel) {
      const chunk = token.slice(lastIndex, match.index).trim();
      segments.push(`${currentLabel}: ${chunk}`);
    }
    currentLabel = match[1].toUpperCase();
    lastIndex = match.index + match[0].length;
  }
  if (currentLabel) {
    const chunk = token.slice(lastIndex).trim();
    segments.push(`${currentLabel}: ${chunk}`);
  }
  return segments.length > 0 ? segments : [token];
};

const tryParseJsonArray = (raw: string): string[] | null => {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item ?? ''));
    }
  } catch {
    // ignore
  }
  return null;
};

const normalizeJsonLikeArray = (raw: string): string[] | null => {
  const parsed = tryParseJsonArray(raw);
  if (parsed) return parsed;
  if (!/'/.test(raw)) return null;
  const swapped = raw
    .replace(/\\'/g, '__SINGLE_QUOTE__')
    .replace(/'/g, '"')
    .replace(/__SINGLE_QUOTE__/g, "'");
  return tryParseJsonArray(swapped);
};

const extractQuotedSegments = (raw: string): string[] => {
  const matches = raw.match(/(['"])([\s\S]*?)\1/g);
  if (!matches) return [];
  return matches.map((segment) => stripQuotes(segment));
};

const tokenizeRawInput = (raw: string): string[] => {
  if (!raw.trim()) return [];
  const normalized = normalizeJsonLikeArray(raw);
  if (normalized) return normalized;
  const quoted = extractQuotedSegments(raw);
  if (quoted.length > 0) return quoted;
  const expanded = raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[;；|｜]/g, '\n')
    .replace(/[\[\]\(\)]/g, '\n');
  return expanded
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const coerceArrayInput = (raw: string | string[] | null | undefined): string[] => {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? ''));
  }
  if (typeof raw === 'string') {
    return tokenizeRawInput(raw);
  }
  return [];
};

export function extractOptionFragments(raw: string | string[] | null): OptionFragment[] {
  const tokens = coerceArrayInput(raw);
  const fragments: OptionFragment[] = [];
  let autoIndex = 0;

  const pushFragment = (
    label: string,
    text: string,
    source: OptionFragmentSource,
    advanceIndex = false,
  ) => {
    const normalizedLabel = normalizeLabel(label) || toOptionLabel(autoIndex);
    const cleaned = sanitizeText(text);
    fragments.push({ label: normalizedLabel, text: cleaned || normalizedLabel, source });
    if (advanceIndex) {
      autoIndex += 1;
    }
  };

  tokens.forEach((token) => {
    splitInlineSegments(token).forEach((segment) => {
      const cleaned = stripQuotes(segment);
      if (!cleaned.trim()) return;
      const labeledMatch = cleaned.match(/^([A-Z])\s*(?:[)\.\-:：、]\s*)(.*)$/i);
      if (labeledMatch) {
        const label = labeledMatch[1].toUpperCase();
        const body = labeledMatch[2] ?? '';
        const idx = label.charCodeAt(0) - 65;
        if (idx >= autoIndex) autoIndex = idx + 1;
        pushFragment(label, body.trim() || label, 'labeled');
      } else {
        pushFragment(toOptionLabel(autoIndex), cleaned, 'sequence', true);
      }
    });
  });

  return fragments;
}

export const formatOptionFragmentsSummary = (fragments: OptionFragment[]): string[] =>
  fragments.map((frag) => `${frag.label} -> ${frag.text || '<empty>'}`);

const ANSWER_REGEX = /[A-Z]/i;

const sanitizeAnswerLetter = (value: string | null | undefined): string => {
  if (!value) return '';
  const match = String(value).match(ANSWER_REGEX);
  return match ? match[0].toUpperCase() : '';
};

export function enforceOptionCount(
  fragments: OptionFragment[],
  answerRaw: string,
  desiredCount = 5,
  placeholder = DEFAULT_OPTION_PLACEHOLDER,
): { options: string[]; answer: string } {
  const count = Math.max(2, desiredCount);
  const labels = Array.from({ length: count }, (_, idx) => toOptionLabel(idx));
  const normalized = new Map<string, string>();
  const leftovers: OptionFragment[] = [];
  const seen = new Set<string>();

  fragments.forEach((fragment) => {
    const label = normalizeLabel(fragment.label);
    const body = sanitizeText(fragment.text || '');
    if (!body) return;
    if (label && labels.includes(label) && !seen.has(label)) {
      normalized.set(label, body);
      seen.add(label);
    } else {
      leftovers.push(fragment);
    }
  });

  let answer = sanitizeAnswerLetter(answerRaw);
  if (!answer) answer = labels[0];

  if (!labels.includes(answer)) {
    const candidate = fragments.find((fragment) => normalizeLabel(fragment.label) === answer);
    if (candidate) {
      const available = labels.filter((label) => !normalized.has(label));
      const target = available.length > 0
        ? available[Math.floor(Math.random() * available.length)]
        : labels[Math.floor(Math.random() * labels.length)];
      normalized.set(target, sanitizeText(candidate.text));
      answer = target;
    } else {
      answer = labels[0];
    }
  }

  labels.forEach((label) => {
    if (!normalized.has(label)) {
      const candidate = leftovers.shift();
      if (candidate?.text?.trim()) {
        normalized.set(label, sanitizeText(candidate.text));
      } else {
        normalized.set(label, placeholder);
      }
    }
  });

  const options = labels.map((label) => normalized.get(label) || placeholder);
  let answerIndex = labels.indexOf(answer);
  if (answerIndex === -1 || !options[answerIndex] || !options[answerIndex].trim()) {
    answerIndex = options.findIndex((option) => option && option.trim());
    answer = answerIndex === -1 ? labels[0] : labels[answerIndex];
  }

  return { options, answer };
}
