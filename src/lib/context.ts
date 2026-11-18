import { createClient } from '@/lib/supabase/server';

export interface Operator {
  userId: string;
  email: string;
  /** True for the people who run DiceDrop. Only operators can use the console. */
  isOperator: boolean;
}

/** Who is signed in. Null when signed out. */
export async function getOperator(): Promise<Operator | null> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  const { data: flag } = await supabase.rpc('dd_is_platform_admin');
  return { userId: user.id, email: user.email ?? '', isOperator: flag === true };
}
