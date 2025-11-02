const extractTagContent = (source, rawTag) => {
  const tagPattern = rawTag.replace(/\s+/g, '\\s+');
  const regex = new RegExp(`<${tagPattern}>\\s*{{([\\s\\S]*?)}}`, 'i');
  const match = regex.exec(source);
  return match ? match[1].trim() : null;
};

const normalizeKey = (input) => input
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const cleanOptionText = (fragment) => {
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

const addOptionFragment = (fragment, target) => {
  const option = cleanOptionText(fragment);
  if (option) target.push(option);
};

const parseOptionValue = (value, target) => {
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

const parseGeneratedQuestionContent = (content) => {
  const result = {
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
  const sections = {};
  const headers = {};
  const bodySectionKeys = new Set([
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

  let currentSection = null;

  while (idx < lines.length) {
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();
    if (trimmed === '') {
      idx += 1;
      break;
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
    const sectionMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 _-]*)\s*:\s*(.*)$/);
    if (sectionMatch) {
      const key = normalizeKey(sectionMatch[1]);
      currentSection = key;
      sections[key] = sections[key] || [];
      const remainder = sectionMatch[2];
      if (remainder) {
        sections[key].push(remainder.trim());
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(rawLine);
    }
  }

  const getSectionText = (key) => {
    const payload = sections[key];
    if (!payload || payload.length === 0) return '';
    return payload.join('\n').trim();
  };

  const getHeader = (key) => headers[key.toLowerCase()]?.trim() ?? '';

  const optionsSection = sections['options'] ?? [];
  const options = [];
  if (optionsSection.length === 1 && /^\s*\(none\)\s*$/i.test(optionsSection[0])) {
    // explicit none
  } else if (optionsSection.length > 0) {
    optionsSection.forEach((line) => parseOptionValue(line, options));
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
  result.answer = getSectionText('answer') || answerHeader;
  result.subfield = getSectionText('subfield') || getSectionText('subfields') || subfieldHeader;
  result.academicLevel = getSectionText('academic_level') || getSectionText('academic') || getSectionText('academiclevel') || academicHeader;
  result.difficulty = getSectionText('difficulty') || difficultyHeader;

  return result;
};

const fs = require('fs');
const input = fs.readFileSync(0, 'utf8');
const generated = extractTagContent(input, 'Generated Question');
const parsed = parseGeneratedQuestionContent(generated || '');
console.log(parsed);
