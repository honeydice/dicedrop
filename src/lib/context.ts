import { createClient } from '@/lib/supabase/server';
import type { Role, Workspace } from '@/lib/types';

export interface SessionContext {
  userId: string;
  email: string;
  workspace: Workspace | null;
  role: Role | null;
}

/** Who is signed in, and which workspace they belong to. Null when signed out. */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1);

  const membership = memberships?.[0];
  if (!membership) {
    return { userId: user.id, email: user.email ?? '', workspace: null, role: null };
  }

  const { data: ws } = await supabase
    .from('workspaces')
    .select('id, name, timezone')
    .eq('id', membership.workspace_id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? '',
    workspace: (ws as Workspace | null) ?? null,
    role: membership.role as Role,
  };
}
