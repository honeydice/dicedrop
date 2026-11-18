'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listProxies, saveAccount, type AccountForm } from '@/app/(console)/actions';
import type { OpsAccount, OpsAccounts, OpsProxy } from '@/lib/types';
import { btn, btnAccent, ErrorNote, field, label } from './ui';

type Tab = 'details' | 'payment' | 'assignment' | 'settings';
const TABS: { id: Tab; name: string }[] = [
  { id: 'details', name: 'Account Details' },
  { id: 'payment', name: 'Payment Method' },
  { id: 'assignment', name: 'VPS & Access' },
  { id: 'settings', name: 'Settings' },
];

function startingForm(a: OpsAccount | null): AccountForm {
  return {
    label: a?.label ?? '',
    login_email: a?.login_email ?? '',
    password: '',
    billing_name: a?.billing_name ?? '',
    billing_zip: a?.billing_zip ?? '',
    billing_phone: a?.billing_phone ?? '',
    totp_secret: '',
    card_id: a?.card_id ?? '',
    box_id: a?.box_id ?? '',
    proxy_label: a?.proxy_label ?? '',
    proxy_id: '',
    visibility: a?.visibility ?? 'public',
    allowed_clients: a?.allowed_clients ?? [],
    max_pending_orders: a?.max_pending_orders != null ? String(a.max_pending_orders) : '',
    daily_spend_cap: a?.daily_spend_cap != null ? String(a.daily_spend_cap) : '',
    daily_order_cap: String(a?.daily_order_cap ?? 5),
    auto_tracking: a?.auto_tracking ?? true,
    order_scan: a?.order_scan ?? false,
  };
}

function Check({ id, checked, onChange, title, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string }) {
  return (
    <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-start gap-3 py-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--accent))]" />
      <span>
        <span className="block text-sm text-fg">{title}</span>
        {hint ? <span className="block text-[13px] text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Add or edit a buyer account. Saving stores the details only; nothing here signs in to Amazon. */
export function AccountModal({ account, data, onClose, onSaved }: { account: OpsAccount | null; data: OpsAccounts; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>('details');
  const [form, setForm] = useState<AccountForm>(() => startingForm(account));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<AccountForm>) => setForm((f) => ({ ...f, ...p }));
  const editing = account !== null;
  const [proxies, setProxies] = useState<OpsProxy[] | null>(null);

  useEffect(() => {
    let live = true;
    void listProxies().then((list) => {
      if (!live) return;
      setProxies(list);
      const mine = account ? list.find((p) => p.account_id === account.id) : undefined;
      if (mine) setForm((f) => ({ ...f, proxy_id: mine.id }));
    });
    return () => {
      live = false;
    };
  }, [account]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (proxies === null) {
      setError('Still loading the proxy list. Try again in a moment.');
      return;
    }
    if (!form.label.trim() || !form.login_email.trim()) {
      setTab('details');
      setError('Add a label and the Amazon sign-in email first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await saveAccount(account?.id ?? null, form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggleClient = (id: string) =>
    set({ allowed_clients: form.allowed_clients.includes(id) ? form.allowed_clients.filter((x) => x !== id) : [...form.allowed_clients, id] });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="acct-title" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-5 py-3">
          <h2 id="acct-title" className="font-mono text-[13px] text-muted">
            {editing ? `PATCH /accounts/${account.label}` : 'POST /accounts'}
          </h2>
          <button type="button" className="min-h-[44px] bg-transparent px-2 font-mono text-[13px] text-muted hover:text-fg" onClick={onClose}>
            close
          </button>
        </div>

        <div role="tablist" aria-label="Account sections" className="flex flex-wrap gap-1 border-b border-line px-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className="-mb-px min-h-[44px] border-b-2 bg-transparent px-3 text-sm font-medium"
              style={{ borderBottomColor: tab === t.id ? 'rgb(var(--accent))' : 'transparent', color: tab === t.id ? 'rgb(var(--strong))' : 'rgb(var(--muted))' }}
            >
              {t.name}
            </button>
          ))}
        </div>

        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="px-5 py-5">
            <ErrorNote message={error} />

            {tab === 'details' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="am-label" className={label}>
                    Label
                  </label>
                  <input id="am-label" maxLength={40} placeholder="AMZ-01" value={form.label} onChange={(e) => set({ label: e.target.value })} className={field} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="am-supplier" className={label}>
                      Supplier
                    </label>
                    <select id="am-supplier" disabled className={field} defaultValue="amazon">
                      <option value="amazon">Amazon</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="am-region" className={label}>
                      Region
                    </label>
                    <select id="am-region" disabled className={field} defaultValue="US">
                      <option value="US">United States</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="am-email" className={label}>
                    Email
                  </label>
                  <input id="am-email" type="email" autoComplete="off" placeholder="buyer01@yourdomain.com" value={form.login_email} onChange={(e) => set({ login_email: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor="am-pass" className={label}>
                    Password
                  </label>
                  <input
                    id="am-pass"
                    type="password"
                    autoComplete="new-password"
                    placeholder={account?.password_set ? 'Saved. Leave blank to keep it' : 'Amazon password'}
                    value={form.password}
                    onChange={(e) => set({ password: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="am-name" className={label}>
                    Billing full name
                  </label>
                  <input id="am-name" maxLength={80} value={form.billing_name} onChange={(e) => set({ billing_name: e.target.value })} className={field} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="am-zip" className={label}>
                      Zip code
                    </label>
                    <input id="am-zip" maxLength={10} inputMode="numeric" value={form.billing_zip} onChange={(e) => set({ billing_zip: e.target.value })} className={field} />
                  </div>
                  <div>
                    <label htmlFor="am-phone" className={label}>
                      Billing phone
                    </label>
                    <input id="am-phone" maxLength={20} inputMode="tel" value={form.billing_phone} onChange={(e) => set({ billing_phone: e.target.value })} className={field} />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="am-totp" className={label}>
                    Verification code key (authenticator app)
                  </label>
                  <input
                    id="am-totp"
                    type="password"
                    autoComplete="off"
                    placeholder={account?.totp_enabled ? 'Generating. Leave blank to keep the saved key' : "The text key from Amazon's \"Can't scan the barcode?\""}
                    value={form.totp_secret}
                    onChange={(e) => set({ totp_secret: e.target.value })}
                    className={`${field} font-mono`}
                  />
                  <p className="mt-1.5 text-[13px] text-muted">Saving starts the live 6-digit code next to this account.</p>
                </div>
              </div>
            ) : null}

            {tab === 'payment' ? (
              <div>
                <label htmlFor="am-card" className={label}>
                  Card on this account
                </label>
                <select id="am-card" value={form.card_id} onChange={(e) => set({ card_id: e.target.value })} className={field}>
                  <option value="">No card selected</option>
                  {data.cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.bank} {c.last4}
                      {c.nickname ? ` · ${c.nickname}` : ''} ({c.accounts} account{Number(c.accounts) === 1 ? '' : 's'})
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[13px] text-muted">
                  Cards are added once in{' '}
                  <Link href="/settings" className="text-accent underline">
                    Settings
                  </Link>{' '}
                  and picked here.
                </p>
              </div>
            ) : null}

            {tab === 'assignment' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="am-box" className={label}>
                    VPS this account is signed in on
                  </label>
                  <select id="am-box" value={form.box_id} onChange={(e) => set({ box_id: e.target.value })} className={field}>
                    <option value="">Unassigned</option>
                    {data.boxes.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="am-proxy" className={label}>
                    Dedicated proxy
                  </label>
                  <select id="am-proxy" disabled={proxies === null} value={form.proxy_id} onChange={(e) => set({ proxy_id: e.target.value })} className={field}>
                    <option value="">{proxies === null ? 'Loading proxies' : 'No proxy'}</option>
                    {(proxies ?? [])
                      .filter((p) => !p.account_id || p.account_id === account?.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} · {p.host}:{p.port}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1.5 text-[13px] text-muted">
                    {proxies && proxies.length === 0 ? 'Import proxies in Settings first.' : `${(proxies ?? []).filter((p) => !p.account_id).length} free in the library. One proxy per account.`}
                  </p>
                </div>
                <fieldset className="sm:col-span-2">
                  <legend className={label}>Access</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(['public', 'private'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={form.visibility === v}
                        onClick={() => set({ visibility: v })}
                        className="min-h-[44px] rounded-[10px] border bg-raised px-3.5 py-2 text-left"
                        style={{ borderColor: form.visibility === v ? 'rgb(var(--accent))' : 'rgb(var(--edge))' }}
                      >
                        <span className="block font-mono text-sm text-fg">{v}</span>
                        <span className="block text-[13px] text-muted">{v === 'public' ? 'Orders for any client on DiceDrop' : 'Orders only for the clients you pick'}</span>
                      </button>
                    ))}
                  </div>
                  {form.visibility === 'private' ? (
                    <div className="mt-3 rounded-[10px] border border-edge px-3.5 py-1">
                      {data.clients.length === 0 ? (
                        <p className="py-2.5 text-[13px] text-muted">Create a client on the Clients page, then pick it here.</p>
                      ) : (
                        data.clients.map((c) => (
                          <Check key={c.id} id={`am-cl-${c.id}`} checked={form.allowed_clients.includes(c.id)} onChange={() => toggleClient(c.id)} title={c.name} />
                        ))
                      )}
                    </div>
                  ) : null}
                </fieldset>
              </div>
            ) : null}

            {tab === 'settings' ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="am-max" className={label}>
                    Max pending orders
                  </label>
                  <input id="am-max" type="number" min={1} placeholder="No limit" value={form.max_pending_orders} onChange={(e) => set({ max_pending_orders: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor="am-spend" className={label}>
                    Daily orders price limit ($)
                  </label>
                  <input id="am-spend" type="number" min={1} step="0.01" placeholder="No limit" value={form.daily_spend_cap} onChange={(e) => set({ daily_spend_cap: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor="am-cap" className={label}>
                    Orders per day
                  </label>
                  <input id="am-cap" type="number" min={1} value={form.daily_order_cap} onChange={(e) => set({ daily_order_cap: e.target.value })} className={field} />
                </div>
                <div className="sm:col-span-3">
                  <Check id="am-track" checked={form.auto_tracking} onChange={(v) => set({ auto_tracking: v })} title="Auto tracking numbers" hint="Pull tracking for this account's orders as they ship." />
                  <Check id="am-scan" checked={form.order_scan} onChange={(v) => set({ order_scan: v })} title="Order scan" hint="Scan this account's Amazon order history for orders placed outside DiceDrop." />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4">
            <button type="button" className={btn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={btnAccent}>
              {busy ? 'Saving' : editing ? 'Save changes' : form.totp_secret.trim() ? 'Save and start generating' : 'Save account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
