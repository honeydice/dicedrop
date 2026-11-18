import { LoginForm } from '@/components/LoginForm';
import { SetupNotice } from '@/components/SetupNotice';
import { hasSupabaseEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;
  return <LoginForm />;
}
