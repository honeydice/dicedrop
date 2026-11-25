import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/ip-gate
 * One dispatch endpoint for the IP-quality gate. Body: { op, ... }.
 *   op "ctx"       { account }                      -> gate config + the account's IP home/target
 *   op "consume"   {}                               -> count one ipapi.is call against today's budget
 *   op "cache_get" { key }                          -> 6h cache hit for this proxy session
 *   op "cache_put" { key, pass, result }            -> store a check result
 *   op "result"    { account, result, outcome }     -> save the gate outcome on the account
 * Auth: "Authorization: Bearer ddbox_...".
 */
export async function POST(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;
    let body: Record<string, unknown> = {};
    try {
      const parsed = (await req.json()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      // empty body is fine
    }
    const op = String(body.op || '');
    let rpc: string;
    let args: Record<string, unknown>;
    if (op === 'ctx') {
      rpc = 'dd_worker_ip_gate_ctx';
      args = { p_token: auth.key, p_label: String(body.account || '') };
    } else if (op === 'consume') {
      rpc = 'dd_worker_ip_gate_consume';
      args = { p_token: auth.key };
    } else if (op === 'cache_get') {
      rpc = 'dd_worker_ip_cache_get';
      args = { p_token: auth.key, p_key: String(body.key || '') };
    } else if (op === 'cache_put') {
      rpc = 'dd_worker_ip_cache_put';
      args = { p_token: auth.key, p_key: String(body.key || ''), p_pass: body.pass === true, p_result: body.result ?? {} };
    } else if (op === 'result') {
      rpc = 'dd_worker_ip_gate_result';
      args = { p_token: auth.key, p_label: String(body.account || ''), p_result: body.result ?? {}, p_outcome: String(body.outcome || '') };
    } else if (op === 'checked') {
      rpc = 'dd_worker_ip_checked';
      args = { p_token: auth.key, p_label: String(body.account || ''), p_result: body.result ?? {} };
    } else {
      return apiError(400, 'bad_op', 'Unknown ip-gate op.');
    }
    const { data, error } = await auth.db.rpc(rpc, args);
    if (error) return fromDbError(error);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
