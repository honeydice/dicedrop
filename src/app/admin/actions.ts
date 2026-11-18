'use server';

import { createHash, randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { getSessionContext } from '@/lib/context';
import { createClient } from '@/lib/supabase/server';

export interface KeyResult {
  error: string;
  key: string;
  secret: string;
  name: string;
}

const NO_KEY: KeyResult = { error: '', key: '', secret: '', name: '' };

export async function createApiKey(_prev: KeyResult, formData: FormData): Promise<KeyResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.workspace || ctx.role !== 'owner') {
      return { ...NO_KEY, error: 'Only the workspace owner can create API keys.' };
    }

    const name = String(formData.get('name') ?? '').trim();
    const webhookUrl = String(formData.get('webhook_url') ?? '').trim();
    if (!name) return { ...NO_KEY, error: 'Give the key a name, like "DiceOps".' };
    if (webhookUrl && !/^https:\/\//i.test(webhookUrl)) {
      return { ...NO_KEY, error: 'The webhook URL needs to start with https://' };
    }

    const key = 'dd_live_' + randomBytes(32).toString('base64url');
    const secret = 'whsec_' + randomBytes(24).toString('base64url');

    const supabase = createClient();
    const { error } = await supabase.from('api_keys').insert({
      workspace_id: ctx.workspace.id,
      name,
      key_prefix: key.slice(0, 14),
      key_hash: createHash('sha256').update(key).digest('hex'),
      webhook_url: webhookUrl || null,
      webhook_secret: secret,
      created_by: ctx.email,
    });
    if (error) return { ...NO_KEY, error: error.message };

    revalidatePath('/admin');
    return { error: '', key, secret, name };
  } catch {
    return { ...NO_KEY, error: 'Could not create the key. Try again.' };
  }
}

export async function revokeApiKey(formData: FormData): Promise<void> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.workspace || ctx.role !== 'owner') return;
    const id = String(formData.get('id') ?? '');
    if (!id) return;
    const supabase = createClient();
    await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id);
    revalidatePath('/admin');
  } catch {
    // Leave the key as it was; the page shows its current state.
  }
}

export interface AccountResult {
  error: string;
  ok: boolean;
}

export async function addBuyerAccount(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.workspace || ctx.role !== 'owner') {
      return { ok: false, error: 'Only the workspace owner can add buyer accounts.' };
    }

    const label = String(formData.get('label') ?? '').trim();
    const loginEmail = String(formData.get('login_email') ?? '').trim();
    const cap = Math.floor(Number(formData.get('daily_order_cap') ?? 5));
    const cardBank = String(formData.get('card_bank') ?? '').trim();
    const cardLast4 = String(formData.get('card_last4') ?? '').trim();
    const proxy = String(formData.get('proxy_label') ?? '').trim();

    if (!label) return { ok: false, error: 'Give the account a label, like "AMZ-01".' };
    if (!Number.isFinite(cap) || cap < 1) return { ok: false, error: 'Daily order cap must be 1 or more.' };
    if (cardLast4 && !/^[0-9]{4}$/.test(cardLast4)) {
      return { ok: false, error: 'Card last 4 should be exactly four digits.' };
    }

    const supabase = createClient();
    const { error } = await supabase.from('buyer_accounts').insert({
      workspace_id: ctx.workspace.id,
      label,
      login_email: loginEmail || null,
      daily_order_cap: cap,
      card_bank: cardBank || null,
      card_last4: cardLast4 || null,
      proxy_label: proxy || null,
    });
    if (error) {
      return { ok: false, error: error.code === '23505' ? 'That label is already in use.' : error.message };
    }

    revalidatePath('/admin');
    return { ok: true, error: '' };
  } catch {
    return { ok: false, error: 'Could not add the account. Try again.' };
  }
}
