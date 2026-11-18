'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createApiKey, type KeyResult } from '@/app/admin/actions';

const START: KeyResult = { error: '', key: '', secret: '', name: '' };
const field = 'mt-1.5 h-11 w-full rounded-[10px] border border-edge bg-raised px-3.5 text-sm text-fg';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 rounded-[10px] bg-accent px-5 text-sm font-semibold text-onaccent disabled:opacity-60"
    >
      {pending ? 'Creating' : 'Create key'}
    </button>
  );
}

export function ApiKeyForm() {
  const [state, action] = useFormState(createApiKey, START);

  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 basis-48">
          <label htmlFor="key-name" className="text-[13px] font-medium text-soft">
            Key name
          </label>
          <input id="key-name" name="name" required maxLength={60} placeholder="DiceOps" className={field} />
        </div>
        <div className="flex-[2] basis-72">
          <label htmlFor="key-webhook" className="text-[13px] font-medium text-soft">
            Webhook URL (optional)
          </label>
          <input
            id="key-webhook"
            name="webhook_url"
            type="url"
            placeholder="https://your-app.com/api/dicedrop/webhook"
            className={field}
          />
        </div>
        <Submit />
      </form>

      {state.error ? (
        <div role="alert" className="mt-3 rounded-lg border border-dangerline bg-dangerbg px-3.5 py-2.5 text-[13px] text-bad">
          {state.error}
        </div>
      ) : null}

      {state.key ? (
        <div role="status" className="mt-4 rounded-xl border border-accent/50 bg-raised p-4">
          <div className="font-medium">Key created for {state.name}. Copy it now; it is shown only once.</div>
          <div className="mt-3 text-xs uppercase tracking-wider text-muted">API key</div>
          <code className="mt-1 block break-all font-mono text-[13px] text-accent">{state.key}</code>
          <div className="mt-3 text-xs uppercase tracking-wider text-muted">Webhook signing secret</div>
          <code className="mt-1 block break-all font-mono text-[13px] text-soft">{state.secret}</code>
        </div>
      ) : null}
    </div>
  );
}
