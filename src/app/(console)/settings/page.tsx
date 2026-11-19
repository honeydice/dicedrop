import { SettingsView } from '@/components/console/SettingsView';
import { createClient } from '@/lib/supabase/server';
import type { ContaboStatus, OpsAccounts, OpsCard, OpsProxy } from '@/lib/types';

export const dynamic = 'force-dynamic';

export interface SelectorRow {
  key: string;
  value: string;
  description: string | null;
}

export default async function SettingsPage() {
  let selectors: SelectorRow[] = [];
  let operators: { email: string | null }[] = [];
  let timezone = 'America/Chicago';
  let perBox = 5;
  let kameleoSetAt: string | null = null;
  let gift = { enabled: true, from: 'DiceDrop', message: '' };
  let error = '';
  let contabo: ContaboStatus | null = null;
  let twoStep: { id: string; label: string; totp_enabled: boolean; totp_set_at: string | null }[] = [];
  let cards: OpsCard[] = [];
  let proxies: OpsProxy[] = [];
  try {
    const supabase = createClient();
    const [s, o, p, c, a, px] = await Promise.all([
      supabase.from('selectors').select('key, value, description').order('key', { ascending: true }),
      supabase.from('platform_admins').select('email').order('created_at', { ascending: true }),
      supabase.from('platform_settings').select('timezone, accounts_per_box, kameleo_set_at, gift_enabled, gift_from, gift_message').eq('id', 1).maybeSingle(),
      supabase.rpc('dd_ops_contabo_status'),
      supabase.rpc('dd_ops_accounts'),
      supabase.rpc('dd_ops_proxies'),
    ]);
    twoStep = ((a.data as OpsAccounts | null)?.accounts ?? []).map((x) => ({ id: x.id, label: x.label, totp_enabled: x.totp_enabled, totp_set_at: x.totp_set_at }));
    proxies = (px.data as OpsProxy[] | null) ?? [];
    cards = (a.data as OpsAccounts | null)?.cards ?? [];
    contabo = (c.data as ContaboStatus | null) ?? null;
    selectors = (s.data as SelectorRow[] | null) ?? [];
    operators = (o.data as { email: string | null }[] | null) ?? [];
    timezone = (p.data as { timezone: string } | null)?.timezone ?? timezone;
    perBox = (p.data as { accounts_per_box?: number } | null)?.accounts_per_box ?? perBox;
    kameleoSetAt = (p.data as { kameleo_set_at?: string | null } | null)?.kameleo_set_at ?? null;
    const g = p.data as { gift_enabled?: boolean; gift_from?: string; gift_message?: string } | null;
    if (g) gift = { enabled: g.gift_enabled ?? true, from: g.gift_from ?? '', message: g.gift_message ?? '' };
    error = s.error?.message ?? o.error?.message ?? p.error?.message ?? '';
  } catch {
    error = 'Could not load settings. Refresh to try again.';
  }

  return <SettingsView selectors={selectors} operators={operators.map((x) => x.email ?? '')} timezone={timezone} initialError={error} contabo={contabo} twoStep={twoStep} cards={cards} proxies={proxies} perBox={perBox} kameleoSetAt={kameleoSetAt} gift={gift} />;
}
