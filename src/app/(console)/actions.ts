'use server';

import { createHash, randomBytes } from 'crypto';
import { getOperator } from '@/lib/context';
import { createClient } from '@/lib/supabase/server';

export interface Result {
  ok: boolean;
  error: string;
  /** A secret shown once (an API key or a box token). */
  secret?: string;
  /** A second secret shown once (a webhook signing secret). */
  secret2?: string;
}

const DENIED: Result = { ok: false, error: 'Operators only.' };
const FAILED: Result = { ok: false, error: 'That did not go through. Try again.' };

async function operatorDb() {
  const me = await getOperator();
  if (!me?.isOperator) return null;
  return { me, db: createClient() };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function done(error: { message: string; code?: string } | null, duplicate = 'That name is already in use.'): Result {
  if (!error) return { ok: true, error: '' };
  return { ok: false, error: error.code === '23505' ? duplicate : error.message };
}

// ---------------------------------------------------------------- Clients

export async function createClientRecord(name: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const clean = name.trim();
    if (!clean) return { ok: false, error: 'Give the client a name.' };
    const { error } = await ctx.db.from('workspaces').insert({ name: clean });
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function setClientStatus(id: string, status: 'active' | 'paused'): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.from('workspaces').update({ status }).eq('id', id);
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function createKey(clientId: string, name: string, webhookUrl: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const clean = name.trim();
    const hook = webhookUrl.trim();
    if (!clean) return { ok: false, error: 'Give the key a name, like "DiceOps".' };
    if (hook && !/^https:\/\//i.test(hook)) return { ok: false, error: 'The webhook URL needs to start with https://' };

    const key = 'dd_live_' + randomBytes(32).toString('base64url');
    const secret = 'whsec_' + randomBytes(24).toString('base64url');
    const { error } = await ctx.db.from('api_keys').insert({
      workspace_id: clientId,
      name: clean,
      key_prefix: key.slice(0, 14),
      key_hash: sha256(key),
      webhook_url: hook || null,
      webhook_secret: secret,
      created_by: ctx.me.email,
    });
    if (error) return done(error);
    return { ok: true, error: '', secret: key, secret2: secret };
  } catch {
    return FAILED;
  }
}

export async function revokeKey(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    return done(error);
  } catch {
    return FAILED;
  }
}

// ---------------------------------------------------------------- Accounts

export interface AccountInput {
  label: string;
  login_email: string;
  daily_order_cap: number;
  card_bank: string;
  card_last4: string;
  proxy_label: string;
  box_id: string;
}

export async function addAccount(input: AccountInput): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const labelText = input.label.trim();
    const cap = Math.floor(Number(input.daily_order_cap));
    const last4 = input.card_last4.trim();
    if (!labelText) return { ok: false, error: 'Give the account a label, like "AMZ-01".' };
    if (!Number.isFinite(cap) || cap < 1) return { ok: false, error: 'Daily order cap must be 1 or more.' };
    if (last4 && !/^[0-9]{4}$/.test(last4)) return { ok: false, error: 'Card last 4 should be exactly four digits.' };

    const { error } = await ctx.db.from('buyer_accounts').insert({
      label: labelText,
      login_email: input.login_email.trim() || null,
      daily_order_cap: cap,
      card_bank: input.card_bank.trim() || null,
      card_last4: last4 || null,
      proxy_label: input.proxy_label.trim() || null,
      box_id: input.box_id || null,
    });
    return done(error, 'That label is already in use.');
  } catch {
    return FAILED;
  }
}

export interface AccountPatch {
  status?: 'warming' | 'active' | 'paused' | 'locked';
  box_id?: string | null;
  daily_order_cap?: number;
  reserved_for?: string | null;
}

export async function updateAccount(id: string, patch: AccountPatch): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const clean: Record<string, unknown> = {};
    if (patch.status) clean.status = patch.status;
    if (patch.box_id !== undefined) clean.box_id = patch.box_id || null;
    if (patch.reserved_for !== undefined) clean.reserved_for = patch.reserved_for || null;
    if (patch.daily_order_cap !== undefined) {
      const cap = Math.floor(Number(patch.daily_order_cap));
      if (!Number.isFinite(cap) || cap < 1) return { ok: false, error: 'Daily order cap must be 1 or more.' };
      clean.daily_order_cap = cap;
    }
    if (Object.keys(clean).length === 0) return { ok: true, error: '' };
    const { error } = await ctx.db.from('buyer_accounts').update(clean).eq('id', id);
    return done(error);
  } catch {
    return FAILED;
  }
}

// ---------------------------------------------------------------- VPS boxes

function newBoxToken(): string {
  return 'ddbox_' + randomBytes(32).toString('base64url');
}

export async function createBox(name: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const clean = name.trim();
    if (!clean) return { ok: false, error: 'Give the box a name, like "box-01".' };
    const token = newBoxToken();
    const { error } = await ctx.db
      .from('boxes')
      .insert({ name: clean, token_hash: sha256(token), token_prefix: token.slice(0, 12) });
    if (error) return done(error, 'A box with that name already exists.');
    return { ok: true, error: '', secret: token };
  } catch {
    return FAILED;
  }
}

export async function setBoxState(id: string, state: 'run' | 'pause' | 'drain'): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.from('boxes').update({ desired_state: state }).eq('id', id);
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function rotateBoxToken(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const token = newBoxToken();
    const { error } = await ctx.db
      .from('boxes')
      .update({ token_hash: sha256(token), token_prefix: token.slice(0, 12) })
      .eq('id', id);
    if (error) return done(error);
    return { ok: true, error: '', secret: token };
  } catch {
    return FAILED;
  }
}

export async function deleteBox(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    // Removes the box. A Contabo server is also remembered as "not a worker" so the next sync leaves it out.
    const { error } = await ctx.db.rpc('dd_ops_remove_box', { p_box: id });
    return done(error);
  } catch {
    return FAILED;
  }
}

// ---------------------------------------------------------------- Contabo

export interface ContaboInput {
  client_id: string;
  client_secret: string;
  api_user: string;
  api_password: string;
}

function syncResult(data: unknown, error: { message: string } | null): Result {
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { ok?: boolean; error?: string; count?: number };
  if (!r.ok) return { ok: false, error: r.error || 'Contabo did not respond as expected.' };
  return { ok: true, error: '', secret: String(r.count ?? 0) };
}

/** Saves the four Contabo API values (encrypted in the database vault) and runs a first sync. */
export async function saveContabo(input: ContaboInput): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { data, error } = await ctx.db.rpc('dd_ops_contabo_save', {
      p_client_id: input.client_id,
      p_client_secret: input.client_secret,
      p_api_user: input.api_user,
      p_api_password: input.api_password,
    });
    return syncResult(data, error);
  } catch {
    return FAILED;
  }
}

export async function syncContabo(): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { data, error } = await ctx.db.rpc('dd_ops_contabo_sync');
    return syncResult(data, error);
  } catch {
    return FAILED;
  }
}

export async function restoreContaboServers(): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { data, error } = await ctx.db.rpc('dd_ops_contabo_restore_ignored');
    return syncResult(data, error);
  } catch {
    return FAILED;
  }
}

export async function disconnectContabo(): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_contabo_disconnect');
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function serverPower(boxId: string, action: 'start' | 'restart' | 'shutdown' | 'stop'): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_contabo_action', { p_box: boxId, p_action: action });
    return done(error);
  } catch {
    return FAILED;
  }
}

// ---------------------------------------------------------------- Settings

export async function updateSelector(key: string, value: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const clean = value.trim();
    if (!clean) return { ok: false, error: 'A selector cannot be empty.' };
    const { error } = await ctx.db
      .from('selectors')
      .update({ value: clean, updated_at: new Date().toISOString() })
      .eq('key', key);
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function setTimezone(timezone: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.from('platform_settings').update({ timezone }).eq('id', 1);
    return done(error);
  } catch {
    return FAILED;
  }
}
