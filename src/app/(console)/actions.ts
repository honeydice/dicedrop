'use server';

import { createHash, randomBytes } from 'crypto';
import { getOperator } from '@/lib/context';
import { createClient } from '@/lib/supabase/server';
import type { OpsProxy } from '@/lib/types';

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
  /** Optional Amazon two-step key. When given, code generation starts right away. */
  totp_secret?: string;
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

    const { data: created, error } = await ctx.db
      .from('buyer_accounts')
      .insert({
        label: labelText,
        login_email: input.login_email.trim() || null,
        daily_order_cap: cap,
        card_bank: input.card_bank.trim() || null,
        card_last4: last4 || null,
        proxy_label: input.proxy_label.trim() || null,
        box_id: input.box_id || null,
      })
      .select('id')
      .single();
    const key = (input.totp_secret ?? '').trim();
    if (!error && created && key) {
      const { error: totpError } = await ctx.db.rpc('dd_ops_set_totp', { p_account: created.id, p_secret: key });
      if (totpError) return { ok: false, error: `The account was saved, but the two-step key was not accepted. ${totpError.message}` };
    }
    return done(error, 'That label is already in use.');
  } catch {
    return FAILED;
  }
}

export interface AccountPatch {
  status?: 'warming' | 'active' | 'paused' | 'locked';
  box_id?: string | null;
  daily_order_cap?: number;
}

export async function updateAccount(id: string, patch: AccountPatch): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const clean: Record<string, unknown> = {};
    if (patch.status) clean.status = patch.status;
    if (patch.box_id !== undefined) clean.box_id = patch.box_id || null;
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

/** Everything on the Add account form. Blank password or two-step key on an edit leaves the saved one as it is. */
export interface AccountForm {
  label: string;
  login_email: string;
  password: string;
  billing_name: string;
  billing_zip: string;
  billing_phone: string;
  totp_secret: string;
  card_id: string;
  box_id: string;
  proxy_label: string;
  /** The dedicated proxy from the proxy library. Blank means none. */
  proxy_id: string;
  visibility: 'public' | 'private';
  allowed_clients: string[];
  max_pending_orders: string;
  daily_spend_cap: string;
  daily_order_cap: string;
  auto_tracking: boolean;
  order_scan: boolean;
}

/** Creates (id null) or updates a buyer account. The password and two-step key are stored encrypted in the database vault. */
export async function saveAccount(id: string | null, input: AccountForm): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    if (!input.label.trim()) return { ok: false, error: 'Give the account a label, like "AMZ-01".' };
    if (!input.login_email.trim()) return { ok: false, error: 'The Amazon sign-in email is required.' };
    for (const [name, value] of [
      ['Max pending orders', input.max_pending_orders],
      ['Daily orders price limit', input.daily_spend_cap],
      ['Orders per day', input.daily_order_cap],
    ] as const) {
      if (value.trim() && !(Number(value) > 0)) return { ok: false, error: `${name} must be a number above 0, or left blank.` };
    }
    const { data, error } = await ctx.db.rpc('dd_ops_save_account', { p_id: id, p: { ...input, supplier: 'amazon', region: 'US' } });
    if (error) return done(error, 'That label is already in use.');
    const savedId = (data as { id?: string } | null)?.id ?? id;
    if (savedId) {
      const { error: proxyError } = await ctx.db.rpc('dd_ops_set_account_proxy', { p_account: savedId, p_proxy: input.proxy_id || null });
      if (proxyError) return { ok: false, error: `The account was saved, but the proxy was not attached. ${proxyError.message}` };
    }
    return { ok: true, error: '' };
  } catch {
    return FAILED;
  }
}

/** Asks the account's box to sign it in to Amazon. The box picks this up on its next check-in. */
export async function requestSignin(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_request_signin', { p_account: id });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** The last screenshot the worker took on this account, as a base64 JPEG. */
export async function getSnapshot(id: string): Promise<{ taken_at: string; note: string | null; image: string } | null> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return null;
    const { data } = await ctx.db.rpc('dd_ops_account_snapshot', { p_account: id });
    return (data as { taken_at: string; note: string | null; image: string } | null) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Proxies

/** Imports proxies from pasted or uploaded lines shaped host:port:username:password. Passwords go to the vault. */
export async function importProxies(text: string, provider: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    if (!text.trim()) return { ok: false, error: 'Choose a file or paste the proxy lines first.' };
    const { data, error } = await ctx.db.rpc('dd_ops_import_proxies', { p_text: text, p_provider: provider });
    if (error) return done(error);
    const r = (data ?? {}) as { added?: number; updated?: number; invalid?: number };
    const parts = [`${r.added ?? 0} added`, `${r.updated ?? 0} updated`];
    if (r.invalid) parts.push(`${r.invalid} lines skipped (expected host:port:username:password)`);
    return { ok: true, error: '', secret: parts.join(', ') };
  } catch {
    return FAILED;
  }
}

export async function removeProxies(ids: string[]): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_remove_proxies', { p_ids: ids });
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function listProxies(): Promise<OpsProxy[]> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return [];
    const { data } = await ctx.db.rpc('dd_ops_proxies');
    return (data as OpsProxy[] | null) ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- Cards

/** The card library holds the bank and last 4 only, so accounts can be tagged with the card they pay with. */
export async function addCard(bank: string, last4: string, nickname: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const cleanBank = bank.trim().toUpperCase();
    const digits = last4.trim();
    if (!cleanBank) return { ok: false, error: 'Add the bank, like "AMEX".' };
    if (!/^[0-9]{4}$/.test(digits)) return { ok: false, error: 'Last 4 should be exactly four digits.' };
    const { error } = await ctx.db.from('cards').insert({ bank: cleanBank, last4: digits, nickname: nickname.trim() || null });
    return done(error, 'That card is already in the library.');
  } catch {
    return FAILED;
  }
}

export async function removeCard(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.from('cards').delete().eq('id', id);
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Stores an account's Amazon two-step key (encrypted) and starts generating codes. */
export async function setTotp(accountId: string, secret: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    if (!secret.trim()) return { ok: false, error: 'Paste the two-step key first.' };
    const { error } = await ctx.db.rpc('dd_ops_set_totp', { p_account: accountId, p_secret: secret });
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function clearTotp(accountId: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_clear_totp', { p_account: accountId });
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

/** Saves the Kameleo personal access token to the vault. Boxes fetch it when they install. */
export async function saveKameleo(token: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    if (token.trim().length < 10) return { ok: false, error: 'Paste the full Kameleo personal access token.' };
    const { error } = await ctx.db.rpc('dd_ops_kameleo_save', { p_token: token });
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function clearKameleo(): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_kameleo_clear');
    return done(error);
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

/** How often each account's placed orders are looked up on Amazon. */
export async function setCheckInterval(minutes: number): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const n = Math.floor(Number(minutes));
    if (!Number.isFinite(n) || n < 5 || n > 1440) return { ok: false, error: 'Use a number of minutes between 5 and 1440.' };
    const { error } = await ctx.db.from('platform_settings').update({ tracking_interval_minutes: n }).eq('id', 1);
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function setAccountsPerBox(count: number): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1 || n > 50) return { ok: false, error: 'Accounts per VPS should be between 1 and 50.' };
    const { error } = await ctx.db.from('platform_settings').update({ accounts_per_box: n }).eq('id', 1);
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
