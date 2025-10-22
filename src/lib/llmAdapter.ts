import { LLMConfigState } from '../state/store';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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
  const system = 'You are a LaTeX normalizer. Convert any nonstandard math symbols into valid LaTeX macros with minimal changes. Return only the corrected text.';
  const out = await chat([
    { role: 'system', content: system },
    { role: 'user', content: input }
  ], llm, { temperature: 0 });
  return out.trim();
}
