import { LLMConfigState, LLMAgentSettings } from '../state/store';

type ImageUrlContent = { type: 'image_url'; image_url: { url: string } };
type TextContent = { type: 'text'; text: string };
export type ChatContent = string | Array<TextContent | ImageUrlContent>;
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: ChatContent };

export async function chatStream(
  messages: ChatMessage[],
  llm: LLMConfigState,
  extra?: { temperature?: number; maxTokens?: number },
  handlers?: { onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void; onToken?: (t: string) => void }
): Promise<string> {
  handlers?.onStatus?.('waiting_response');
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ messages, llm, extra })
  });
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`LLM error ${res.status}: ${text}`);
  }
  const reader = res.body?.getReader();
  if (!reader) {
    // Fallback: try parse as JSON once
    const data = await res.json().catch(() => ({} as any));
    const text = (data?.text ?? '') as string;
    handlers?.onStatus?.('done');
    return text;
  }
  let full = '';
  const decoder = new TextDecoder();
  let buffer = '';
  let sawAnyChunk = false;
  handlers?.onStatus?.('thinking');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    // Parse SSE lines
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() || '';
    for (const part of parts) {
      const lines = part.split(/\n/);
      for (const line of lines) {
        const m = line.match(/^data:\s*(.*)$/);
        if (!m) continue;
        const data = m[1];
        if (data === '[DONE]') { handlers?.onStatus?.('done'); break; }
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta || j?.choices?.[0]?.message || {};
          const content = delta?.content || '';
          if (content) {
            if (!sawAnyChunk) { handlers?.onStatus?.('responding'); sawAnyChunk = true; }
            full += content;
            handlers?.onToken?.(content);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    }
  }
  handlers?.onStatus?.('done');
  return full.trim();
}

export async function chat(messages: ChatMessage[], llm: LLMConfigState, extra?: { temperature?: number; maxTokens?: number }): Promise<string> {
  return chatStream(messages, llm, extra);
}

export async function latexCorrection(
  input: string,
  agent: LLMAgentSettings,
  handlers?: { onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void }
): Promise<string> {
  const system = agent.prompt?.trim() || 'You are a LaTeX normalizer. Convert nonstandard math symbols into valid LaTeX macros with minimal changes. Return only the corrected text.';

  const examples: ChatMessage[] = [
    { role: 'user', content: 'x≤y, α→β, and ∑_i^n f(i)' },
    { role: 'assistant', content: 'x \\le y, \\alpha \\to \\beta, and \\sum_{i}^{n} f(i)' },
    { role: 'user', content: 'Let ϵ→0 and ℝ^n be the real vector space.' },
    { role: 'assistant', content: 'Let \\epsilon \\to 0 and \\mathbb{R}^n be the real vector space.' }
  ];

  const out = await chatStream([
    { role: 'system', content: system },
    ...examples,
    { role: 'user', content: input }
  ], agent.config, { temperature: 0 }, handlers);

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

export async function ocrWithLLM(
  imageBlob: Blob,
  agent: LLMAgentSettings,
  handlers?: { onStatus?: (s: 'waiting_response' | 'thinking' | 'responding' | 'done') => void }
): Promise<string> {
  const dataUrl = await blobToDataUrl(imageBlob);
  const system = agent.prompt?.trim() || 'You are an OCR engine. Transcribe all readable text from the image into plain UTF-8 text. Preserve math expressions as text (no LaTeX unless present), keep line breaks where meaningful, and do not add commentary.';
  const out = await chatStream([
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Extract all readable text from this image. Return plain text only.' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ], agent.config, { temperature: 0 }, handlers);
  return out.trim();
}
