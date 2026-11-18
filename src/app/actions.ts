'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function createWorkspace(_prev: { error: string }, formData: FormData): Promise<{ error: string }> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Give your workspace a name.' };

  try {
    const supabase = createClient();
    const { error } = await supabase.rpc('dd_create_workspace', { p_name: name });
    if (error) return { error: error.message };
  } catch {
    return { error: 'Could not create the workspace. Try again.' };
  }
  redirect('/');
}
