'use client';

import { useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { addBuyerAccount, type AccountResult } from '@/app/admin/actions';

const START: AccountResult = { ok: false, error: '' };
const field = 'mt-1.5 h-11 w-full rounded-[10px] border border-edge bg-raised px-3.5 text-sm text-[#E6EDF3]';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 rounded-[10px] bg-accent px-5 text-sm font-semibold text-[#141413] disabled:opacity-60"
    >
      {pending ? 'Adding' : 'Add account'}
    </button>
  );
}

export function AccountForm() {
  const [state, action] = useFormState(addBuyerAccount, START);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <div>
      <form ref={ref} action={action} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 basis-32">
          <label htmlFor="acct-label" className="text-[13px] font-medium text-soft">
            Label
          </label>
          <input id="acct-label" name="label" required maxLength={40} placeholder="AMZ-01" className={field} />
        </div>
        <div className="flex-[2] basis-56">
          <label htmlFor="acct-email" className="text-[13px] font-medium text-soft">
            Amazon login email
          </label>
          <input id="acct-email" name="login_email" type="email" placeholder="buyer01@yourdomain.com" className={field} />
        </div>
        <div className="basis-28">
          <label htmlFor="acct-cap" className="text-[13px] font-medium text-soft">
            Orders / day
          </label>
          <input id="acct-cap" name="daily_order_cap" type="number" min={1} defaultValue={5} className={field} />
        </div>
        <div className="flex-1 basis-32">
          <label htmlFor="acct-bank" className="text-[13px] font-medium text-soft">
            Card bank
          </label>
          <input id="acct-bank" name="card_bank" maxLength={30} placeholder="AMEX" className={field} />
        </div>
        <div className="basis-24">
          <label htmlFor="acct-last4" className="text-[13px] font-medium text-soft">
            Last 4
          </label>
          <input id="acct-last4" name="card_last4" inputMode="numeric" maxLength={4} placeholder="1003" className={field} />
        </div>
        <div className="flex-1 basis-32">
          <label htmlFor="acct-proxy" className="text-[13px] font-medium text-soft">
            Proxy label
          </label>
          <input id="acct-proxy" name="proxy_label" maxLength={40} placeholder="proxy-01" className={field} />
        </div>
        <Submit />
      </form>
      {state.error ? (
        <div role="alert" className="mt-3 rounded-lg border border-[#5A2626] bg-[#2A1414] px-3.5 py-2.5 text-[13px] text-bad">
          {state.error}
        </div>
      ) : null}
    </div>
  );
}
