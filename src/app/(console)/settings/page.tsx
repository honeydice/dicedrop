import { SettingsView } from '@/components/console/SettingsView';
import { createClient } from '@/lib/supabase/server';
import type { ContaboStatus, OpsAccounts } from '@/lib/types';

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
  let error = '';
  let contabo: ContaboStatus | null = null;
  let twoStep: { id: string; label: string; totp_enabled: boolean; totp_set_at: string | null }[] = [];
  try {
    const supabase = createClient();
    const [s, o, p, c, a] = await Promise.all([
      supabase.from('selectors').select('key, value, description').order('key', { ascending: true }),
      supabase.from('platform_admins').select('email').order('created_at', { ascending: true }),
      supabase.from('platform_settings').select('timezone').eq('id', 1).maybeSingle(),
      supabase.rpc('dd_ops_contabo_status'),
      supabase.rpc('dd_ops_accounts'),
    ]);
    twoStep = ((a.data as OpsAccounts | null)?.accounts ?? []).map((x) => ({ id: x.id, label: x.label, totp_enabled: x.totp_enabled, totp_set_at: x.totp_set_at }));
    contabo = (c.data as ContaboStatus | null) ?? null;
    selectors = (s.data as SelectorRow[] | null) ?? [];
    operators = (o.data as { email: string | null }[] | null) ?? [];
    timezone = (p.data as { timezone: string } | null)?.timezone ?? timezone;
    error = s.error?.message ?? o.error?.message ?? p.error?.message ?? '';
  } catch {
    error = 'Could not load settings. Refresh to try again.';
  }

  return <SettingsView selectors={selectors} operators={operators.map((x) => x.email ?? '')} timezone={timezone} initialError={error} contabo={contabo} twoStep={twoStep} />;
}
