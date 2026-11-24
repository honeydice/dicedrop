'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cardStatus, clearCardDetails, listProxies, saveAccount, saveCardDetails, type AccountForm, type CardDetails } from '@/app/(console)/actions';
import type { OpsAccount, OpsAccounts, OpsProxy } from '@/lib/types';
import { btn, btnAccent, Dot, ErrorNote, field, label, TONE } from './ui';

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
    engine: a ? (a.engine ?? 'kameleo') : 'multilogin',
    mlx_profile: a?.mlx_profile ?? '',
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
export function AccountModal({ account, data, onClose, onSaved, defaultStage }: { account: OpsAccount | null; data: OpsAccounts; onClose: () => void; onSaved: () => void; defaultStage?: 'live' | 'warmup' }) {
  const [tab, setTab] = useState<Tab>('details');
  const [form, setForm] = useState<AccountForm>(() => startingForm(account));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<AccountForm>) => setForm((f) => ({ ...f, ...p }));
  const editing = account !== null;
  // New accounts run in Multilogin. Only an account already on Kameleo keeps its proxy picker.
  const usesKameleo = account?.engine === 'kameleo';
  const [proxies, setProxies] = useState<OpsProxy[] | null>(null);
  const BLANK_CARD: CardDetails = { number: '', exp_month: '', exp_year: '', cvv: '', name: '', zip: '' };
  const [card, setCard] = useState<CardDetails>(BLANK_CARD);
  const [cardSaved, setCardSaved] = useState<{ set: boolean; set_at: string | null }>({ set: false, set_at: null });
  const [cardNote, setCardNote] = useState('');

  useEffect(() => {
    if (!account) return;
    let live = true;
    void cardStatus(account.id).then((s) => live && setCardSaved(s));
    return () => {
      live = false;
    };
  }, [account]);

  const storeCard = async () => {
    if (!account) return;
    setBusy(true);
    setError('');
    setCardNote('');
    try {
      const result = await saveCardDetails(account.id, card);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCard(BLANK_CARD);
      setCardSaved(await cardStatus(account.id));
      setCardNote('Card details saved.');
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

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
    // The email can wait: an account can start as just its computer (VPS + proxy), with the Amazon account made by hand in Open browser.
    if (!form.label.trim()) {
      setTab('details');
      setError('Add a label first.');
      return;
    }
    if (!usesKameleo && !form.mlx_profile.trim()) {
      setTab('details');
      setError('Add the Multilogin profile name: the name of this account\'s browser in Multilogin.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // A brand-new account created from the Warm up tab starts in the warm-up lane (browse-only).
      const result = await saveAccount(account?.id ?? null, account ? form : { ...form, stage: defaultStage ?? 'live' });
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

  // Only proxies nobody else is using, plus this account's own.
  const available = (proxies ?? []).filter((p) => !p.account_id || p.account_id === account?.id);

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
                  <input id="am-email" type="email" autoComplete="off" placeholder="buyer01@yourdomain.com (can be added later)" value={form.login_email} onChange={(e) => set({ login_email: e.target.value })} className={field} />
                </div>
                {!usesKameleo ? (
                  <div>
                    <label htmlFor="am-mlx" className={label}>
                      Multilogin profile name
                    </label>
                    <input id="am-mlx" autoComplete="off" placeholder="Exactly as it shows in Multilogin" value={form.mlx_profile} onChange={(e) => set({ mlx_profile: e.target.value })} className={field} />
                  </div>
                ) : null}
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

                <div className="mt-6 rounded-xl border border-line">
                  <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-4 py-2.5">
                    <span className="font-mono text-xs text-muted">card details · for Amazon&apos;s verify-payment page</span>
                    <span className="font-mono text-xs" style={{ color: cardSaved.set ? TONE.good : TONE.muted }}>
                      {cardSaved.set ? `saved${cardSaved.set_at ? ` ${new Date(cardSaved.set_at).toLocaleDateString()}` : ''}` : 'not saved'}
                    </span>
                  </div>
                  {editing ? (
                    <div className="grid gap-3 px-4 py-4 sm:grid-cols-6">
                      <div className="sm:col-span-4">
                        <label htmlFor="cd-number" className={label}>
                          Card number
                        </label>
                        <input id="cd-number" type="password" inputMode="numeric" autoComplete="off" maxLength={23} placeholder={cardSaved.set ? 'Saved. Enter a new one to replace it' : ''} value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} className={`${field} font-mono`} />
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor="cd-cvv" className={label}>
                          Security code
                        </label>
                        <input id="cd-cvv" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value })} className={`${field} font-mono`} />
                      </div>
                      <div className="sm:col-span-1">
                        <label htmlFor="cd-month" className={label}>
                          Exp. month
                        </label>
                        <input id="cd-month" inputMode="numeric" maxLength={2} placeholder="04" value={card.exp_month} onChange={(e) => setCard({ ...card, exp_month: e.target.value })} className={`${field} font-mono`} />
                      </div>
                      <div className="sm:col-span-1">
                        <label htmlFor="cd-year" className={label}>
                          Exp. year
                        </label>
                        <input id="cd-year" inputMode="numeric" maxLength={4} placeholder="2029" value={card.exp_year} onChange={(e) => setCard({ ...card, exp_year: e.target.value })} className={`${field} font-mono`} />
                      </div>
                      <div className="sm:col-span-3">
                        <label htmlFor="cd-name" className={label}>
                          Name on card
                        </label>
                        <input id="cd-name" maxLength={60} autoComplete="off" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} className={field} />
                      </div>
                      <div className="sm:col-span-1">
                        <label htmlFor="cd-zip" className={label}>
                          Billing zip
                        </label>
                        <input id="cd-zip" maxLength={10} value={card.zip} onChange={(e) => setCard({ ...card, zip: e.target.value })} className={`${field} font-mono`} />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:col-span-6">
                        <button type="button" disabled={busy || !card.number.trim() || !card.cvv.trim()} className={btn} onClick={() => void storeCard()}>
                          Save card details
                        </button>
                        {cardSaved.set ? (
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-[44px] bg-transparent px-2 font-mono text-[13px] text-bad disabled:opacity-40"
                            onClick={async () => {
                              if (!account || !window.confirm('Remove the saved card details from this account?')) return;
                              setBusy(true);
                              try {
                                await clearCardDetails(account.id);
                                setCardSaved(await cardStatus(account.id));
                                setCardNote('Card details removed.');
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            remove
                          </button>
                        ) : null}
                        {cardNote ? <span className="font-mono text-xs text-good">{cardNote}</span> : null}
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-3 font-mono text-xs text-muted">save the account first, then open edit details to add its card</div>
                  )}
                </div>
              </div>
            ) : null}

            {tab === 'assignment' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="am-box" className={label}>
                    VPS this account is signed in on
                  </label>
                  <select id="am-box" value={form.box_id} onChange={(e) => set({ box_id: e.target.value })} className={field}>
                    <option value="">{editing ? 'Unassigned' : 'Auto-assign (box with the most room)'}</option>
                    {data.boxes.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                {usesKameleo ? (
                <div className="sm:col-span-2">
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span id="am-proxy-label" className="text-[13px] font-medium text-soft">
                      Dedicated proxy
                    </span>
                    <span className="font-mono text-xs text-muted">{proxies === null ? 'loading' : `${available.filter((p) => !p.account_id).length} available`}</span>
                  </div>
                  <div role="radiogroup" aria-labelledby="am-proxy-label" className="max-h-[232px] overflow-y-auto rounded-[10px] border border-edge">
                    {[{ id: '', label: 'none', host: '', port: 0 }, ...available].map((p) => {
                      const picked = form.proxy_id === p.id;
                      return (
                        <button
                          key={p.id || 'none'}
                          type="button"
                          role="radio"
                          aria-checked={picked}
                          onClick={() => set({ proxy_id: p.id })}
                          className="flex min-h-[44px] w-full items-center gap-3.5 border-b border-divider px-3.5 text-left last:border-b-0 hover:bg-raised/60"
                          style={picked ? { background: 'rgb(var(--raised))' } : undefined}
                        >
                          <Dot color={picked ? TONE.good : 'rgb(var(--chip))'} />
                          <span className="font-mono text-[14px] text-fg">{p.label}</span>
                          <span className="font-mono text-[13px] text-muted">{p.host ? `${p.host}:${p.port}` : 'no proxy on this account'}</span>
                          {picked ? <span className="ml-auto font-mono text-xs text-good">selected</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
                ) : null}
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
