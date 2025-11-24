// Cloudflare Pages Function: /api/llm
type ApiChatContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>;

type ApiChatMessage = { role: 'system' | 'user' | 'assistant'; content: ApiChatContent };

export const onRequestPost: PagesFunction = async (context) => {
  try {
    const body = await context.request.json();
    const { messages, llm, extra } = body as {
      messages: ApiChatMessage[];
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
        max_tokens: extra?.maxTokens ?? 100000,
        stream: true
      } as any;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${llm.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        return new Response(JSON.stringify({ error: errText || `HTTP ${r.status}` }), { status: r.status });
      }
      const upstream = r.body;
      if (!upstream) {
        return new Response(JSON.stringify({ error: 'No response body from upstream' }), { status: 500 });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const reader = upstream.getReader();
          const pump = (): any => reader.read().then(({ done, value }) => {
            if (done) { controller.close(); return; }
            if (value) controller.enqueue(value);
            return pump();
          }).catch((err) => {
            try { controller.error(err); } catch {}
          });
          return pump();
        }
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive'
        }
      });
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
