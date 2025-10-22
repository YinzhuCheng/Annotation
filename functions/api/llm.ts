// Cloudflare Pages Function: /api/llm
export const onRequestPost: PagesFunction = async (context) => {
  try {
    const body = await context.request.json();
    const { messages, llm, extra } = body as {
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      llm: { provider: 'openai' | 'gemini' | 'claude'; apiKey: string; model: string; baseUrl?: string };
      extra?: { temperature?: number; maxTokens?: number };
    };

    if (!llm?.apiKey || !llm?.model || !llm?.provider) {
      return new Response(JSON.stringify({ error: 'Missing LLM configuration (provider, apiKey, model)' }), { status: 400 });
    }

    // Require a user-provided Base URL; do not use provider defaults
    const baseUrl = (llm.baseUrl || '').trim();
    const isOpenAICompatible = baseUrl.length > 0;
    if (!isOpenAICompatible) {
      return new Response(
        JSON.stringify({ error: 'Base URL required; default endpoints are disabled' }),
        { status: 400 }
      );
    }

    if (isOpenAICompatible) {
      const base = baseUrl.replace(/\/+$/, '');
      const url = `${base}/chat/completions`;
      const payload = {
        model: llm.model,
        messages,
        temperature: extra?.temperature ?? 0,
        max_tokens: extra?.maxTokens ?? 1024,
        stream: false
      } as any;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${llm.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        return new Response(JSON.stringify({ error: errText || `HTTP ${r.status}` }), { status: r.status });
      }
      // Try to parse JSON; if it fails, surface the raw text for debugging
      let j: any;
      try {
        j = await r.json();
      } catch (e: any) {
        const raw = await r.text().catch(() => '');
        return new Response(JSON.stringify({ error: raw || (e?.message || 'Non-JSON response from OpenAI-compatible endpoint') }), { status: 500 });
      }
      const text = j?.choices?.[0]?.message?.content || '';
      return new Response(JSON.stringify({ text }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Fallbacks to provider defaults are intentionally disabled.
    return new Response(
      JSON.stringify({ error: 'Base URL required; provider default endpoints are disabled' }),
      { status: 400 }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500 });
  }
};
