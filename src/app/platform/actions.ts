'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/** Pause or resume a workspace. The database checks that the caller is a platform owner. */
export async function setWorkspaceStatus(formData: FormData): Promise<void> {
  try {
    const id = String(formData.get('id') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!id || (status !== 'active' && status !== 'paused')) return;
    const supabase = createClient();
    await supabase.rpc('dd_platform_set_workspace_status', { p_workspace: id, p_status: status });
    revalidatePath('/platform');
  } catch {
    // The page shows the workspace's current state either way.
  }
}
