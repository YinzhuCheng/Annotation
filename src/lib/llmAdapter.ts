import { LLMConfigState } from '../state/store';

type ImageUrlContent = { type: 'image_url'; image_url: { url: string } };
type TextContent = { type: 'text'; text: string };
export type ChatContent = string | Array<TextContent | ImageUrlContent>;
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: ChatContent };

export async function chat(messages: ChatMessage[], llm: LLMConfigState, extra?: { temperature?: number; maxTokens?: number }): Promise<string> {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, llm, extra })
  });
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`LLM error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.text ?? '';
}

export async function latexCorrection(input: string, llm: LLMConfigState): Promise<string> {
  const system = 'You are a LaTeX normalizer. Convert nonstandard math symbols into valid LaTeX macros with minimal changes. Return only the corrected text.';

  const examples: ChatMessage[] = [
    { role: 'user', content: 'x≤y, α→β, and ∑_i^n f(i)' },
    { role: 'assistant', content: 'x \\le y, \\alpha \\to \\beta, and \\sum_{i}^{n} f(i)' },
    { role: 'user', content: 'Let ϵ→0 and ℝ^n be the real vector space.' },
    { role: 'assistant', content: 'Let \\epsilon \\to 0 and \\mathbb{R}^n be the real vector space.' }
  ];

  const out = await chat([
    { role: 'system', content: system },
    ...examples,
    { role: 'user', content: input }
  ], llm, { temperature: 0 });

  return out.trim();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function ocrWithLLM(imageBlob: Blob, llm: LLMConfigState): Promise<string> {
  const dataUrl = await blobToDataUrl(imageBlob);
  const system = 'You are an OCR engine. Transcribe all readable text from the image into plain UTF-8 text. Preserve math expressions as text (no LaTeX unless present), keep line breaks where meaningful, and do not add commentary.';
  const out = await chat([
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Extract all readable text from this image. Return plain text only.' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ], llm, { temperature: 0 });
  return out.trim();
}
