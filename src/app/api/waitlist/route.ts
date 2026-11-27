import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** POST /api/waitlist  { email, marketplace?, monthly_orders?, comment? } — public early-access signup. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'The request body must be JSON.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !email.includes('@') || email.length > 200) {
    return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 422 });
  }

  try {
    const supabase = createClient();
    const { error } = await supabase.rpc('dd_waitlist_signup', {
      p_email: email,
      p_marketplace: typeof body.marketplace === 'string' ? body.marketplace.slice(0, 60) : null,
      p_monthly_orders: typeof body.monthly_orders === 'string' ? body.monthly_orders.slice(0, 60) : null,
      p_comment: typeof body.comment === 'string' ? body.comment.slice(0, 1000) : null,
    });
    if (error) return NextResponse.json({ ok: false, error: 'Could not sign up right now. Try again.' }, { status: 400 });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
  }
}
