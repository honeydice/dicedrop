import { Landing } from '@/components/Landing';
import { getOperator } from '@/lib/context';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const me = await getOperator().catch(() => null);
  return <Landing isOperator={me?.isOperator === true} />;
}
