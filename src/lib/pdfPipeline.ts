import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import type { LLMAgentSettings, DefaultSettings } from '../state/store';
import type { CoarseBlock, DetailedCandidate, PdfPageMeta } from '../state/importStore';
import { chatStream } from './llmAdapter';
import { generateProblemFromCandidates, type CandidateForGeneration, type CandidateGenerationOutcome } from './questionGenerator';

GlobalWorkerOptions.workerSrc = pdfWorker;

interface Matrix extends Array<number> {
  0: number;
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

interface LineSegment {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
}

interface LineGroup {
  items: LineSegment[];
  top: number;
  bottom: number;
}

export interface CoarseExtractionOptions {
  targetDpi?: number;
  minTextLength?: number;
  lineMergeThreshold?: number;
  blockGapThreshold?: number;
  spaceThreshold?: number;
}

export interface BlockAnalysisOptions {
  minConfidence?: number;
}

export interface RewriteOptions {
  topK: number;
  defaults: DefaultSettings;
}

const DEFAULT_COARSE_OPTIONS: Required<CoarseExtractionOptions> = {
  targetDpi: 144,
  minTextLength: 24,
  lineMergeThreshold: 6,
  blockGapThreshold: 18,
  spaceThreshold: 12
};

const MILLIMETRE_PER_INCH = 25.4;

const multiplyTransforms = (m1: Matrix, m2: Matrix): Matrix => {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ] as Matrix;
};

const convertItemToSegment = (item: TextItem, viewport: { transform: Matrix; width: number; height: number }): LineSegment => {
  const [a, b, c, d, e, f] = multiplyTransforms(viewport.transform, item.transform as unknown as Matrix);
  const scaleX = Math.sqrt(a * a + b * b) || 1;
  const scaleY = Math.sqrt(c * c + d * d) || 1;
  const width = item.width * scaleX;
  const height = item.height ? item.height * scaleY : scaleY;
  const left = e;
  const top = viewport.height - f;
  const right = left + width;
  const bottom = top + height;
  return {
    text: item.str,
    left,
    right,
    top,
    bottom,
    height
  };
};

const groupSegmentsIntoLines = (segments: LineSegment[], threshold: number): LineGroup[] => {
  const lines: LineGroup[] = [];
  for (const segment of segments) {
    const baseline = segment.top;
    const match = lines.find((line) => Math.abs(line.top - baseline) <= threshold);
    if (match) {
      match.items.push(segment);
      match.top = Math.min(match.top, segment.top);
      match.bottom = Math.max(match.bottom, segment.bottom);
    } else {
      lines.push({
        items: [segment],
        top: segment.top,
        bottom: segment.bottom
      });
    }
  }
  lines.sort((a, b) => a.top - b.top);
  lines.forEach((line) => {
    line.items.sort((x, y) => x.left - y.left);
  });
  return lines;
};

const buildLineText = (line: LineGroup, spaceThreshold: number): { text: string; rect: { left: number; right: number; top: number; bottom: number }; height: number } => {
  const pieces: string[] = [];
  let lastRight = line.items[0]?.left ?? 0;
  for (const item of line.items) {
    const gap = item.left - lastRight;
    if (gap > spaceThreshold) {
      pieces.push(' ');
    }
    pieces.push(item.text);
    lastRight = item.right;
  }
  const text = pieces.join('').replace(/\s+/g, ' ').trim();
  const left = Math.min(...line.items.map((segment) => segment.left));
  const right = Math.max(...line.items.map((segment) => segment.right));
  const top = Math.min(...line.items.map((segment) => segment.top));
  const bottom = Math.max(...line.items.map((segment) => segment.bottom));
  const height = Math.max(...line.items.map((segment) => segment.height));
  return { text, rect: { left, right, top, bottom }, height };
};

const blockFromLines = (pageId: string, pageNumber: number, blockIndex: number, lines: ReturnType<typeof buildLineText>[], options: Required<CoarseExtractionOptions>): CoarseBlock | null => {
  const combined = lines.map((line) => line.text).join('\n').trim();
  if (!combined || combined.length < options.minTextLength) {
    return null;
  }
  const left = Math.min(...lines.map((line) => line.rect.left));
  const right = Math.max(...lines.map((line) => line.rect.right));
  const top = Math.min(...lines.map((line) => line.rect.top));
  const bottom = Math.max(...lines.map((line) => line.rect.bottom));
  return {
    id: `${pageId}-b${blockIndex}`,
    pageId,
    pageNumber,
    index: blockIndex,
    rect: {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    },
    text: combined,
    stats: {
      lineCount: lines.length,
      textLength: combined.length
    },
    status: 'pending'
  };
};

const extractPageData = async (pdf: PDFDocumentProxy, pageNumber: number, options: Required<CoarseExtractionOptions>): Promise<{ pageMeta: PdfPageMeta; blocks: CoarseBlock[] }> => {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: options.targetDpi / 72 });
  const pageId = `${pdf.fingerprint || 'pdf'}-p${pageNumber}`;
  const textContent = await page.getTextContent();
  const items = textContent.items as TextItem[];
  const segments = items
    .filter((item) => typeof item.str === 'string' && item.str.trim().length > 0)
    .map((item) => convertItemToSegment(item, viewport));

  const lines = groupSegmentsIntoLines(segments, options.lineMergeThreshold)
    .map((group) => buildLineText(group, options.spaceThreshold))
    .filter((line) => line.text.length > 0);

  const blocks: CoarseBlock[] = [];
  let current: ReturnType<typeof buildLineText>[] = [];
  let blockIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (current.length === 0) {
      current.push(line);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = line.rect.top - prev.rect.bottom;
    if (gap > options.blockGapThreshold) {
      const block = blockFromLines(pageId, pageNumber, blockIndex, current, options);
      if (block) {
        blocks.push(block);
        blockIndex += 1;
      }
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    const block = blockFromLines(pageId, pageNumber, blockIndex, current, options);
    if (block) {
      blocks.push(block);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas rendering context unavailable.');
  }
  await page.render({ canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  canvas.width = canvas.height = 0;

  const pageMeta: PdfPageMeta = {
    id: pageId,
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    rotation: page.rotate,
    dpi: options.targetDpi,
    dataUrl
  };

  if (blocks.length === 0) {
    blocks.push({
      id: `${pageId}-img` as string,
      pageId,
      pageNumber,
      index: 0,
      rect: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height
      },
      text: '',
      stats: {
        lineCount: 0,
        textLength: 0
      },
      status: 'pending',
      requiresOcr: true,
      sourceImage: dataUrl
    });
  } else {
    blocks.forEach((block) => {
      block.sourceImage = dataUrl;
    });
  }

  return { pageMeta, blocks };
};

export const extractCoarseBlocksFromPdf = async (file: File, options?: CoarseExtractionOptions): Promise<{ pages: PdfPageMeta[]; blocks: CoarseBlock[] }> => {
  if (!file) {
    throw new Error('No PDF file provided.');
  }
  const mergedOptions: Required<CoarseExtractionOptions> = {
    ...DEFAULT_COARSE_OPTIONS,
    ...options
  };
  const data = await file.arrayBuffer();
  const pdf = await getDocument({ data }).promise;
  const pages: PdfPageMeta[] = [];
  const blocks: CoarseBlock[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const { pageMeta, blocks: pageBlocks } = await extractPageData(pdf, pageNumber, mergedOptions);
    pages.push(pageMeta);
    blocks.push(...pageBlocks);
  }
  return { pages, blocks };
};

interface SegmentationLLMResponse {
  problems?: Array<{
    id?: string;
    rawText?: string;
    classification?: string;
    hasImage?: boolean;
    confidence?: number;
    skipReason?: string;
    notes?: string;
  }>;
  discarded?: Array<{
    reason?: string;
    snippet?: string;
  }>;
}

const parseSegmentationResponse = (raw: string): SegmentationLLMResponse => {
  if (!raw) return {};
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error('LLM segmentation response is not valid JSON');
  }
  const snippet = trimmed.slice(jsonStart, jsonEnd + 1);
  return JSON.parse(snippet);
};

export const analyzeCoarseBlockWithLLM = async (
  block: CoarseBlock,
  agent: LLMAgentSettings,
  options?: BlockAnalysisOptions
): Promise<DetailedCandidate[]> => {
  const minConfidence = typeof options?.minConfidence === 'number' ? options.minConfidence : 0.4;
  const systemPrompt = agent.prompt?.trim() || 'You identify mathematics exercises from textbooks and ignore definitions or summaries.';
  const instructions = [
    'You will receive a chunk of text extracted from a mathematics textbook.',
    'Return only actual problems that require a learner response (exercise, question, ask, prove).',
    'Ignore pure definitions, theorems, summaries, or example discussions unless they include an explicit question to solve.',
    'If a problem references diagrams, figures, charts, or images, mark hasImage=true.',
    'Respond with JSON matching the schema: { "problems": [ { "id": string, "rawText": string, "classification": string, "hasImage": boolean, "confidence": number, "skipReason": string, "notes": string } ], "discarded": [ { "reason": string, "snippet": string } ] }. Include only actual problems inside "problems".',
    'Set confidence between 0 and 1. Use low confidence (<0.4) when unsure whether text is a standalone problem.',
    'Provide meaningful skipReason when a candidate is discarded inside "discarded".'
  ].join('\n');

  const payload = `Page ${block.pageNumber}, Candidate ${block.id}\n---\n${block.text}`;
  const response = await chatStream(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${instructions}\n\nText Block:\n${payload}` }
    ],
    agent.config,
    { temperature: 0 }
  );

  const parsed = parseSegmentationResponse(response);
  const candidates = (parsed.problems ?? []).filter((problem) => typeof problem?.rawText === 'string' && problem.rawText.trim().length > 0);
  return candidates.map((candidate, index) => ({
    id: candidate.id?.trim() || `${block.id}-q${index + 1}`,
    blockId: block.id,
    pageId: block.pageId,
    pageNumber: block.pageNumber,
    index,
    text: candidate.rawText?.trim() || '',
    classification: candidate.classification?.trim() || 'unspecified',
    hasImage: Boolean(candidate.hasImage),
    confidence: typeof candidate.confidence === 'number' ? Math.max(0, Math.min(1, candidate.confidence)) : minConfidence,
    skipReason: candidate.skipReason?.trim(),
    notes: candidate.notes?.trim()
  }));
};

export const rewriteCandidatesWithLLM = async (
  block: CoarseBlock,
  candidates: DetailedCandidate[],
  agent: LLMAgentSettings,
  { topK, defaults }: RewriteOptions
): Promise<CandidateGenerationOutcome> => {
  const eligible = candidates
    .filter((candidate) => candidate.hasImage !== true && candidate.text.trim().length > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(1, topK));
  if (eligible.length === 0) {
    return {
      status: 'skipped',
      reason: 'No text-only candidates available for conversion.',
      chosenCandidateId: null,
      raw: ''
    };
  }
  const pool: CandidateForGeneration[] = eligible.map((candidate) => ({
    id: candidate.id,
    text: candidate.text,
    classification: candidate.classification,
    confidence: candidate.confidence,
    notes: candidate.notes
  }));
  return generateProblemFromCandidates(pool, agent, defaults, { blockId: block.id });
};

export const dpiToScale = (dpi: number): number => dpi / 72;

export const scaleToDpi = (scale: number): number => scale * 72;

export const dpiToMillimetre = (dpi: number): number => MILLIMETRE_PER_INCH / dpi;
