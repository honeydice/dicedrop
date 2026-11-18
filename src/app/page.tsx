import { redirect } from 'next/navigation';
import { Board } from '@/components/Board';
import { Header } from '@/components/Header';
import { SetupNotice } from '@/components/SetupNotice';
import { getSessionContext } from '@/lib/context';
import { hasSupabaseEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import type { BoardData } from '@/lib/types';
import { VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

const EMPTY: BoardData = {
  orders: [],
  total_orders: 0,
  spent_today: 0,
  spent_count: 0,
  pending_count: 0,
  pending_missing_cost: 0,
  pending_cogs: 0,
  pending_tax: 0,
  tax_states: [],
};

export default async function OrdersPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!ctx.workspace) redirect('/setup');

  let initial = EMPTY;
  let loadError = '';
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('dd_board', { p_workspace: ctx.workspace.id });
    if (error) loadError = error.message;
    else if (data) initial = data as BoardData;
  } catch {
    loadError = 'Could not load orders. Refresh to try again.';
  }

  return (
    <div className="min-h-screen">
      <Header
        workspaceName={ctx.workspace.name}
        email={ctx.email}
        current="orders"
        isPlatformAdmin={ctx.isPlatformAdmin}
      />
      <Board
        workspaceId={ctx.workspace.id}
        initial={initial}
        initialError={loadError}
        canWrite={ctx.role === 'owner' || ctx.role === 'staff'}
      />
      <footer className="mx-auto max-w-[1440px] px-5 pb-10 text-xs text-muted sm:px-8">DiceDrop v{VERSION}</footer>
    </div>
  );
}
