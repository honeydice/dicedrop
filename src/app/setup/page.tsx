import { redirect } from 'next/navigation';
import { SetupNotice } from '@/components/SetupNotice';
import { WorkspaceForm } from '@/components/WorkspaceForm';
import { getSessionContext } from '@/lib/context';
import { hasSupabaseEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (ctx.workspace) redirect('/');

  return <WorkspaceForm email={ctx.email} />;
}
