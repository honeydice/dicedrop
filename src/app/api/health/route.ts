import { NextResponse } from 'next/server';
import { hasSupabaseEnv } from '@/lib/env';
import { VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

let aiCheck: { at: number; ok: boolean; detail: string } | null = null;

/** One tiny call that proves the AI helper's key and model answer. Remembered for 30 minutes. */
async function checkAi() {
  if (aiCheck && Date.now() - aiCheck.at < 30 * 60 * 1000) return aiCheck;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { at: Date.now(), ok: false, detail: 'no key' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 60,
        tools: [{ name: 'act', description: 'Answer.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['done', 'stop'] } }, required: ['action'] } }],
        messages: [{ role: 'user', content: 'Call the act tool with the action done.' }],
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await res.json().catch(() => ({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const used = (j.content || []).find((c: any) => c.type === 'tool_use');
    aiCheck = { at: Date.now(), ok: res.ok && !!used, detail: res.ok ? String(used?.input?.action ?? 'no answer') : String(j?.error?.message || res.status).slice(0, 160) };
  } catch {
    aiCheck = { at: Date.now(), ok: false, detail: 'unreachable' };
  }
  return aiCheck;
}

export async function GET(req: Request) {
  const base = { ok: true, version: VERSION, configured: hasSupabaseEnv(), ai_helper: !!process.env.ANTHROPIC_API_KEY };
  if (new URL(req.url).searchParams.get('ai') === '1') {
    const ai = await checkAi();
    return NextResponse.json({ ...base, ai_check: { ok: ai.ok, detail: ai.detail } });
  }
  return NextResponse.json(base);
}
