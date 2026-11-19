import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/ping
 * A stand-in receiver for trying out pulses: point a key's webhook URL here and it answers 200.
 * It stores nothing and reads nothing back.
 */
export async function POST(req: Request) {
  const signed = Boolean(req.headers.get('dicedrop-signature'));
  return NextResponse.json({ ok: true, signed, event: req.headers.get('dicedrop-event') }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
