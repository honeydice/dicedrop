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
  /** A short human note about what happened (e.g. which browsers were created). */
  note?: string;
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

/** A fresh API key for an existing key entry. The webhook URL and signing secret stay as they are; the old key stops working. */
export async function rotateKey(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const key = 'dd_live_' + randomBytes(32).toString('base64url');
    const { error } = await ctx.db.from('api_keys').update({ key_prefix: key.slice(0, 14), key_hash: sha256(key) }).eq('id', id).is('revoked_at', null);
    if (error) return done(error);
    return { ok: true, error: '', secret: key };
  } catch {
    return FAILED;
  }
}

export async function setClientAutoOrder(clientId: string, on: boolean): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_client_auto_order', { p_client: clientId, p_on: on });
    return done(error);
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

export interface PulseLine {
  id: string;
  event: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  response_code: number | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  url: string;
  dd_number: string | null;
  order_number: string | null;
  key_name: string | null;
}

/** The last 20 pulses sent to this client: what, when, and whether it landed. */
export async function getPulseLog(clientId: string): Promise<PulseLine[] | null> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return null;
    const { data, error } = await ctx.db.rpc('dd_ops_webhook_log', { p_client: clientId, p_limit: 20 });
    if (error) return null;
    return (data as PulseLine[] | null) ?? [];
  } catch {
    return null;
  }
}

export async function setKeyWebhook(keyId: string, url: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_key_webhook', { p_key: keyId, p_url: url });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** The webhook signing secret for one key, for the operator to copy into the receiving app. */
export async function getSigningSecret(keyId: string): Promise<string | null> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return null;
    const { data, error } = await ctx.db.rpc('dd_ops_key_signing_secret', { p_key: keyId });
    if (error) return null;
    return typeof data === 'string' && data ? data : null;
  } catch {
    return null;
  }
}

export async function sendTestPulse(keyId: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_test_pulse', { p_key: keyId });
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function resendPulse(deliveryId: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_resend_pulse', { p_delivery: deliveryId });
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
  /** 'multilogin' for every new account; 'kameleo' only on an account that already runs there. */
  engine: string;
  /** The name (or id) of the account's browser profile in Multilogin. */
  mlx_profile: string;
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
  /** Which lane a brand-new account starts in: 'warmup' (browse-only) or 'live'. Ignored when editing. */
  stage?: 'live' | 'warmup';
}

/** Creates (id null) or updates a buyer account. The password and two-step key are stored encrypted in the database vault. */
export async function saveAccount(id: string | null, input: AccountForm): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    if (!input.label.trim()) return { ok: false, error: 'Give the account a label, like "AMZ-01".' };
    // The Amazon email can be added later: an account can start as just its computer (VPS + proxy).
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
    if (savedId && input.engine !== 'kameleo') {
      if (!input.mlx_profile.trim()) return { ok: false, error: 'The account was saved, but it has no Multilogin profile name yet.' };
      const { error: engineError } = await ctx.db.rpc('dd_ops_set_engine', { p_account: savedId, p_engine: 'multilogin', p_profile: input.mlx_profile.trim() });
      if (engineError) return { ok: false, error: `The account was saved, but the Multilogin profile was not linked. ${engineError.message}` };
    }
    if (savedId && input.engine === 'kameleo') {
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

export interface AccessLine {
  at: string;
  reason: string;
  ok: boolean;
  result: string | null;
  exit_ip: string | null;
  seconds: number | null;
  box: string | null;
}

/** Ordering on or off for one account. Off: it stays signed in and its orders are still checked, but it gets no new orders. */
export async function setOrdering(id: string, on: boolean): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_ordering', { p_account: id, p_on: on });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Removes an account with its saved secrets, logs and screenshots. Its orders stay. */
export async function removeAccount(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_delete_account', { p_account: id });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Saves the Multilogin sign-in the boxes use to open Multilogin profiles (kept encrypted in the database vault). */
export async function saveMultilogin(email: string, password: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_multilogin_save', { p_email: email, p_password: password });
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function clearMultilogin(): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_multilogin_clear');
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Sets which browser an account runs in. For Multilogin, `profile` is the name (or id) of its existing Multilogin profile. */
export async function setAccountEngine(id: string, engine: 'kameleo' | 'multilogin', profile: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_engine', { p_account: id, p_engine: engine, p_profile: profile || null });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Opens (or closes) the account's own VPS browser, to use by hand in a tab. */
export async function setLiveBrowser(id: string, open: boolean): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_browser', { p_account: id, p_open: open });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Clears "on hold" on an account after it has been verified on Amazon, so it can take orders again. */
export async function clearHold(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_clear_hold', { p_account: id });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** IP-quality gate settings: master on/off, whether it also runs before orders, and the daily ipapi.is budget. */
export async function setIpGate(enabled: boolean, beforeOrders: boolean, budget: number): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_ip_gate', { p_enabled: enabled, p_before_orders: beforeOrders, p_budget: budget });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Turns the automatic IP gate on/off for a single account (checked before its warm-up / first launch). */
export async function setAccountIpGate(id: string, on: boolean): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_account_ipgate', { p_account: id, p_on: on });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Queues a one-off on-demand proxy IP check for an account (no browser opens) — e.g. before creating the Amazon account. */
export async function requestIpCheck(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_request_ip_check', { p_account: id });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Sets an account's optional IP target location (state or "City, State") used to steer its first mobile IP. */
export async function setIpTarget(id: string, target: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_ip_target', { p_account: id, p_target: target });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** Moves an account between lanes: 'live' (order-eligible, on the main page) or 'warmup' (browse-only, on the Warm up tab). */
export async function setAccountStage(id: string, stage: 'live' | 'warmup' | 'archived'): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_stage', { p_account: id, p_stage: stage });
    return done(error);
  } catch {
    return FAILED;
  }
}

/**
 * Bulk-creates warm-up browsers: mints AA### names from the highest seen, resolves a random carrier per
 * browser (or a chosen one), spreads them across the available boxes, and queues each for Multilogin
 * profile creation (macOS + mobile proxy, US/California/Los Angeles). They start guest-warming once built.
 */
export async function createBrowsers(count: number, spec: { carrier?: string } = {}): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const n = Math.max(1, Math.min(50, Math.round(count || 0)));
    const { data, error } = await ctx.db.rpc('dd_ops_create_browsers', { p_count: n, p_spec: spec });
    if (error) return done(error);
    const created = (((data as { created?: { label: string }[] } | null)?.created) ?? []).map((c) => c.label);
    const note = created.length
      ? `Queued ${created.length} browser${created.length === 1 ? '' : 's'}: ${created[0]}${created.length > 1 ? `–${created[created.length - 1]}` : ''}. They’ll build one by one, then start warming.`
      : 'No browsers were created.';
    return { ok: true, error: '', note };
  } catch {
    return FAILED;
  }
}

/** Arms every warm-up-stage account to browse now (unpauses, spreads start times over ~20 min). */
export async function setAllWarmup(): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { data, error } = await ctx.db.rpc('dd_ops_warmup_all');
    if (error) return done(error);
    const armed = ((data as { armed?: number } | null)?.armed) ?? 0;
    return { ok: true, error: '', note: `Warming all ${armed} warm-up account${armed === 1 ? '' : 's'} — they’ll browse on a rotating, staggered schedule.` };
  } catch {
    return FAILED;
  }
}

/** Turns warm-up on for an account for a number of days (0 turns it off). While warming up it only browses. */
export async function setWarmup(id: string, days: number): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_warmup', { p_account: id, p_days: Math.max(0, Math.round(days)) });
    return done(error);
  } catch {
    return FAILED;
  }
}

/** The saved Amazon password for one account, for the operator to sign in by hand. Each view is written to the account's log. */
export async function getAccountPassword(id: string): Promise<string | null> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return null;
    const { data, error } = await ctx.db.rpc('dd_ops_account_password', { p_account: id });
    if (error) return null;
    return typeof data === 'string' && data ? data : null;
  } catch {
    return null;
  }
}

export interface AllAccessLine extends AccessLine {
  account: string;
}

/** Every account's sessions in one list, newest first. `reason` narrows it ("warm-up", "sign-in", "order check", "place order"). */
export async function getAllAccountLogs(reason: string): Promise<AllAccessLine[] | null> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return null;
    const { data, error } = await ctx.db.rpc('dd_ops_access_log_all', { p_limit: 200, p_reason: reason || null });
    if (error) return null;
    return (data ?? []) as AllAccessLine[];
  } catch {
    return null;
  }
}

/** The last 20 times a box opened this account: when, why, and how it went. */
export async function getAccountLog(id: string): Promise<AccessLine[] | null> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return null;
    const { data, error } = await ctx.db.rpc('dd_ops_account_log', { p_account: id, p_limit: 20 });
    if (error) return null;
    return (data as AccessLine[] | null) ?? [];
  } catch {
    return null;
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

export interface CardDetails {
  number: string;
  exp_month: string;
  exp_year: string;
  cvv: string;
  name: string;
  zip: string;
}

/** Saves the card details used to answer Amazon's "Verify payment" page. Stored in the vault; never read back to the console. */
export async function saveCardDetails(id: string, card: CardDetails): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_set_card_details', { p_account: id, p: card });
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function clearCardDetails(id: string): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const { error } = await ctx.db.rpc('dd_ops_clear_card_details', { p_account: id });
    return done(error);
  } catch {
    return FAILED;
  }
}

export async function cardStatus(id: string): Promise<{ set: boolean; set_at: string | null }> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return { set: false, set_at: null };
    const { data } = await ctx.db.rpc('dd_ops_card_status', { p_account: id });
    return (data as { set: boolean; set_at: string | null } | null) ?? { set: false, set_at: null };
  } catch {
    return { set: false, set_at: null };
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

/** How many orders one VPS works on at the same time (each on its own account). */
export async function setOrdersAtOnce(count: number): Promise<Result> {
  try {
    const ctx = await operatorDb();
    if (!ctx) return DENIED;
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1 || n > 8) return { ok: false, error: 'Orders at once should be between 1 and 8.' };
    const { error } = await ctx.db.rpc('dd_ops_set_orders_at_once', { p_count: n });
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
