import type { IncomingRequestCf } from 'worker-types';

// Cloudflare Pages Function: /api/llm
export const onRequestPost: PagesFunction = async (context) => {
  try {
    const body = await context.request.json();
    const { messages, llm, extra } = body;
    const provider: 'openai'|'gemini'|'claude' = llm.provider;

    if (provider === 'openai') {
      const url = (llm.baseUrl?.trim() || 'https://api.openai.com/v1') + '/chat/completions';
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${llm.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: llm.model,
          messages,
          temperature: extra?.temperature ?? 0,
          max_tokens: extra?.maxTokens ?? 1024
        })
      });
      if (!r.ok) return new Response(JSON.stringify({ error: await r.text() }), { status: r.status });
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content || '';
      return new Response(JSON.stringify({ text }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (provider === 'claude') {
      const url = 'https://api.anthropic.com/v1/messages';
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': llm.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: llm.model,
          max_tokens: extra?.maxTokens ?? 1024,
          messages,
        })
      });
      if (!r.ok) return new Response(JSON.stringify({ error: await r.text() }), { status: r.status });
      const j = await r.json();
      const text = j.content?.[0]?.text || '';
      return new Response(JSON.stringify({ text }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(llm.model)}:generateContent?key=${encodeURIComponent(llm.apiKey)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [ { parts: [ { text: messages.map((m:any)=> `${m.role}: ${m.content}`).join('\n') } ] } ]
        })
      });
      if (!r.ok) return new Response(JSON.stringify({ error: await r.text() }), { status: r.status });
      const j = await r.json();
      const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return new Response(JSON.stringify({ text }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unsupported provider' }), { status: 400 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500 });
  }
};
