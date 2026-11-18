import { NextResponse } from 'next/server';
import { hasSupabaseEnv } from '@/lib/env';
import { VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, version: VERSION, configured: hasSupabaseEnv() });
}
