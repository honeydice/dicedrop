'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { addCard, clearTotp, importProxies, removeCard, removeProxies, setAccountsPerBox, disconnectContabo, restoreContaboServers, saveContabo, setTimezone, setTotp, syncContabo, updateSelector } from '@/app/(console)/actions';
import { ThemeToggle } from '@/components/admin/ThemeToggle';
import type { SelectorRow } from '@/app/(console)/settings/page';
import type { ContaboStatus, OpsCard, OpsProxy } from '@/lib/types';
import { usePaged } from './Pager';
import { btn, btnAccent, btnDanger, Dot, ErrorNote, field, label, PageHead, TONE, when } from './ui';

/** A settings group that stays folded to one line until it is clicked. */
function Section({ title, summary, open, onToggle, children }: { title: string; summary?: string; open: boolean; onToggle: (title: string) => void; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(title)}
        className="flex min-h-[52px] w-full items-center gap-4 bg-raised px-5 py-3 text-left"
      >
        <span className="font-mono text-[14px] text-fg">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[13px] text-muted">{summary}</span>
        <span aria-hidden="true" className="font-mono text-[13px] text-muted">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? <div className="border-t border-line">{children}</div> : null}
    </section>
  );
}

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'UTC'];

export function SettingsView({
  selectors,
  operators,
  timezone,
  initialError,
  contabo,
  twoStep,
  cards,
  proxies,
  perBox,
}: {
  selectors: SelectorRow[];
  operators: string[];
  timezone: string;
  initialError: string;
  contabo: ContaboStatus | null;
  twoStep: { id: string; label: string; totp_enabled: boolean; totp_set_at: string | null }[];
  cards: OpsCard[];
  proxies: OpsProxy[];
  perBox: number;
}) {
  const router = useRouter();
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [zone, setZone] = useState(timezone);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [creds, setCreds] = useState({ client_id: '', client_secret: '', api_user: '', api_password: '' });
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');

  const contaboRun = async (work: () => Promise<{ ok: boolean; error: string; secret?: string }>, okText: (count: string) => string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (!result.ok) setError(result.error);
      else setNotice(okText(result.secret ?? '0'));
      router.refresh();
      return result.ok;
    } catch {
      setError('That did not go through. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const connected = contabo?.connected === true;
  const [keyFor, setKeyFor] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [card, setCard] = useState({ bank: '', last4: '', nickname: '' });
  const [perBoxDraft, setPerBoxDraft] = useState(String(perBox));
  const [proxyText, setProxyText] = useState('');
  const [proxyProvider, setProxyProvider] = useState('');
  const [proxyNotice, setProxyNotice] = useState('');
  const { shown: shownProxies, pager: proxyPager } = usePaged(proxies);
  const proxiesFree = proxies.filter((p) => !p.account_id).length;
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());
  const toggle = (title: string) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  const generating = twoStep.filter((x) => x.totp_enabled).length;

  const save = async (work: () => Promise<{ ok: boolean; error: string }>) => {
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (!result.ok) setError(result.error);
      router.refresh();
      return result.ok;
    } catch {
      setError('That did not go through. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const summary: Record<string, string> = {
    appearance: 'light or dark',
    'contabo connection': connected ? `connected · ${contabo?.instance_count ?? 0} servers` : 'not connected',
    proxies: `${proxies.length} proxies · ${proxiesFree} free`,
    cards: `${cards.length} card${cards.length === 1 ? '' : 's'}`,
    'two-step codes': `${generating} of ${twoStep.length} generating`,
    'vps capacity': `${perBox} accounts per vps`,
    'day boundary': timezone,
    selectors: `${selectors.length} selectors`,
    operators: `${operators.length} operator${operators.length === 1 ? '' : 's'}`,
  };

  return (
    <>
      <PageHead title="Settings" />
      <ErrorNote message={error} />

      <div className="space-y-2.5">
        <Section title="appearance" summary={summary['appearance']} open={openSet.has('appearance')} onToggle={toggle}>
          <div className="px-5 py-4">
            <ThemeToggle />
          </div>
        </Section>

        <Section title="contabo connection" summary={summary['contabo connection']} open={openSet.has('contabo connection')} onToggle={toggle}>
          <div className="px-5 py-4">
            <div className="flex items-start gap-3.5">
              <span className="mt-[7px]">
                <Dot color={connected ? (contabo?.last_sync_error ? TONE.warn : TONE.good) : TONE.muted} />
              </span>
              <div>
                <div className="font-mono text-[15px]">{connected ? 'contabo.connected' : 'contabo.not_connected'}</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {connected
                    ? `${contabo?.api_user ?? ''} · ${contabo?.instance_count ?? 0} servers · last sync ${when(contabo?.last_sync_at)}`
                    : ''}
                </div>
                {connected && contabo?.last_sync_error ? <div className="mt-1 text-[13px] text-bad">{contabo.last_sync_error}</div> : null}
                {notice ? <div className="mt-1 text-[13px] text-good">{notice}</div> : null}
              </div>
            </div>

            {connected && !editing ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={btn} onClick={() => void contaboRun(() => syncContabo(), (n) => `Synced ${n} servers.`)}>
                  Sync now
                </button>
                <button type="button" disabled={busy} className={btn} onClick={() => setEditing(true)}>
                  Replace credentials
                </button>
                {(contabo?.ignored ?? 0) > 0 ? (
                  <button type="button" disabled={busy} className={btn} onClick={() => void contaboRun(() => restoreContaboServers(), (n) => `Restored. ${n} servers now showing.`)}>
                    Bring back {contabo?.ignored} removed server{contabo?.ignored === 1 ? '' : 's'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  className={btnDanger}
                  onClick={() => {
                    if (!window.confirm('Disconnect Contabo? The saved credentials are deleted. Your boxes stay in the list.')) return;
                    void contaboRun(() => disconnectContabo(), () => 'Disconnected.');
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <form
                className="mt-4 grid gap-3 sm:grid-cols-2"
                autoComplete="off"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await contaboRun(() => saveContabo(creds), (n) => `Connected. Imported ${n} servers.`);
                  if (ok) {
                    setCreds({ client_id: '', client_secret: '', api_user: '', api_password: '' });
                    setEditing(false);
                  }
                }}
              >
                <div>
                  <label htmlFor="ct-id" className={label}>
                    Client ID
                  </label>
                  <input id="ct-id" required autoComplete="off" value={creds.client_id} onChange={(e) => setCreds({ ...creds, client_id: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor="ct-secret" className={label}>
                    Client Secret
                  </label>
                  <input id="ct-secret" type="password" required autoComplete="new-password" value={creds.client_secret} onChange={(e) => setCreds({ ...creds, client_secret: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor="ct-user" className={label}>
                    API User
                  </label>
                  <input id="ct-user" required autoComplete="off" value={creds.api_user} onChange={(e) => setCreds({ ...creds, api_user: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor="ct-pass" className={label}>
                    API Password
                  </label>
                  <input id="ct-pass" type="password" required autoComplete="new-password" value={creds.api_password} onChange={(e) => setCreds({ ...creds, api_password: e.target.value })} className={field} />
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                  <button type="submit" disabled={busy} className={btnAccent}>
                    {busy ? 'Connecting' : 'Connect Contabo'}
                  </button>
                  {editing ? (
                    <button type="button" className={btn} onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            )}
          </div>
        </Section>

        <Section title="proxies" summary={summary['proxies']} open={openSet.has('proxies')} onToggle={toggle}>
          <div className="px-5 pt-4">
            {proxyNotice ? <div className="mt-2 text-[13px] text-good">{proxyNotice}</div> : null}
          </div>
          <form
            className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]"
            autoComplete="off"
            onSubmit={async (e) => {
              e.preventDefault();
              setProxyNotice('');
              setBusy(true);
              setError('');
              try {
                const result = await importProxies(proxyText, proxyProvider);
                if (!result.ok) setError(result.error);
                else {
                  setProxyNotice(`Imported: ${result.secret}.`);
                  setProxyText('');
                }
                router.refresh();
              } catch {
                setError('That did not go through. Try again.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <label htmlFor="px-text" className={label}>
                Proxy lines
              </label>
              <textarea
                id="px-text"
                rows={4}
                spellCheck={false}
                value={proxyText}
                onChange={(e) => setProxyText(e.target.value)}
                placeholder="isp.provider.com:10001:username:password"
                className="w-full rounded-[10px] border border-edge bg-raised px-3.5 py-2.5 font-mono text-[13px] text-fg"
                style={{ WebkitTextSecurity: proxyText ? 'disc' : undefined } as React.CSSProperties}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className={`${btn} cursor-pointer`}>
                  Choose CSV or TXT file
                  <input
                    type="file"
                    accept=".csv,.txt,text/plain,text/csv"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) setProxyText(await file.text());
                      e.target.value = '';
                    }}
                  />
                </label>
                <span className="font-mono text-xs text-muted">{proxyText.trim() ? `${proxyText.trim().split(/\r?\n/).filter(Boolean).length} lines ready` : 'no file chosen'}</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:w-52">
              <div>
                <label htmlFor="px-provider" className={label}>
                  Provider
                </label>
                <input id="px-provider" maxLength={30} placeholder="Decodo" value={proxyProvider} onChange={(e) => setProxyProvider(e.target.value)} className={field} />
              </div>
              <button type="submit" disabled={busy || !proxyText.trim()} className={btnAccent}>
                Import proxies
              </button>
            </div>
          </form>
          {shownProxies.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-divider px-5 py-2">
              <Dot color={p.account_id ? TONE.good : TONE.muted} />
              <span className="font-mono text-[13px]">{p.label}</span>
              <span className="font-mono text-[13px] text-muted">
                {p.host}:{p.port} · {p.account_label ? `assigned to ${p.account_label}` : 'free'}
              </span>
              <button
                type="button"
                disabled={busy}
                className="ml-auto min-h-[44px] bg-transparent px-2 font-mono text-[13px] text-bad disabled:opacity-40"
                onClick={() => {
                  if (!window.confirm(`Remove ${p.label}?${p.account_label ? ` ${p.account_label} goes back to no proxy.` : ''}`)) return;
                  void save(() => removeProxies([p.id]));
                }}
              >
                remove
              </button>
            </div>
          ))}
          {proxyPager}
        </Section>

        <Section title="cards" summary={summary['cards']} open={openSet.has('cards')} onToggle={toggle}>
          <div className="px-5 py-3">
            {cards.length === 0 ? <div className="py-2 font-mono text-[13px] text-muted">no cards yet.</div> : null}
            {cards.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-divider py-2.5 last:border-b-0">
                <span className="font-mono text-[14px]">
                  {c.bank} {c.last4}
                </span>
                <span className="font-mono text-[13px] text-muted">
                  {[c.nickname, `${c.accounts} account${Number(c.accounts) === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className={`${btnDanger} ml-auto`}
                  onClick={() => {
                    if (!window.confirm(`Remove ${c.bank} ${c.last4} from the library? Accounts using it go back to no card selected.`)) return;
                    void save(() => removeCard(c.id));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <form
              className="mt-3 flex flex-wrap items-end gap-3"
              autoComplete="off"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await save(() => addCard(card.bank, card.last4, card.nickname));
                if (ok) setCard({ bank: '', last4: '', nickname: '' });
              }}
            >
              <div className="basis-36">
                <label htmlFor="cd-bank" className={label}>
                  Bank
                </label>
                <input id="cd-bank" required maxLength={30} placeholder="AMEX" value={card.bank} onChange={(e) => setCard({ ...card, bank: e.target.value })} className={field} />
              </div>
              <div className="basis-28">
                <label htmlFor="cd-last4" className={label}>
                  Last 4
                </label>
                <input id="cd-last4" required inputMode="numeric" maxLength={4} placeholder="1003" value={card.last4} onChange={(e) => setCard({ ...card, last4: e.target.value })} className={`${field} font-mono`} />
              </div>
              <div className="flex-1 basis-48">
                <label htmlFor="cd-nick" className={label}>
                  Nickname (optional)
                </label>
                <input id="cd-nick" maxLength={40} placeholder="Business Gold" value={card.nickname} onChange={(e) => setCard({ ...card, nickname: e.target.value })} className={field} />
              </div>
              <button type="submit" disabled={busy} className={btnAccent}>
                Add card
              </button>
            </form>
          </div>
        </Section>

        <Section title="two-step codes" summary={summary['two-step codes']} open={openSet.has('two-step codes')} onToggle={toggle}>
          <div className="px-5 py-3">
            {twoStep.length === 0 ? (
              <div className="py-4 font-mono text-[13px] text-muted">no accounts yet. add one on the accounts page.</div>
            ) : (
              twoStep.map((acct) => (
                <div key={acct.id} className="border-b border-divider py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
                    <Dot color={acct.totp_enabled ? TONE.good : TONE.muted} />
                    <span className="font-mono text-[14px]">{acct.label}</span>
                    <span className="font-mono text-[13px] text-muted">
                      {acct.totp_enabled ? `generating since ${when(acct.totp_set_at)}` : 'no key yet'}
                    </span>
                    <span className="ml-auto flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className={btn}
                        onClick={() => {
                          setKeyFor(keyFor === acct.id ? '' : acct.id);
                          setKeyDraft('');
                        }}
                      >
                        {acct.totp_enabled ? 'Replace key' : 'Add key'}
                      </button>
                      {acct.totp_enabled ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={btnDanger}
                          onClick={() => {
                            if (!window.confirm(`Stop generating codes for ${acct.label}? The saved key is deleted.`)) return;
                            void save(() => clearTotp(acct.id));
                          }}
                        >
                          Stop
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {keyFor === acct.id ? (
                    <form
                      className="mt-3 flex flex-wrap items-end gap-3"
                      autoComplete="off"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const ok = await save(() => setTotp(acct.id, keyDraft));
                        if (ok) {
                          setKeyFor('');
                          setKeyDraft('');
                        }
                      }}
                    >
                      <div className="flex-1 basis-72">
                        <label htmlFor={`totp-${acct.id}`} className={label}>
                          Amazon two-step key for {acct.label}
                        </label>
                        <input
                          id={`totp-${acct.id}`}
                          type="password"
                          autoComplete="off"
                          value={keyDraft}
                          onChange={(e) => setKeyDraft(e.target.value)}
                          placeholder="Letters A-Z and numbers 2-7"
                          className={`${field} font-mono`}
                        />
                      </div>
                      <button type="submit" disabled={busy || !keyDraft.trim()} className={btnAccent}>
                        Start generating
                      </button>
                    </form>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Section>

        <Section title="vps capacity" summary={summary['vps capacity']} open={openSet.has('vps capacity')} onToggle={toggle}>
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <div className="basis-64">
              <label htmlFor="per-box" className={label}>
                Accounts per VPS (auto-assign limit)
              </label>
              <input id="per-box" type="number" min={1} max={50} value={perBoxDraft} onChange={(e) => setPerBoxDraft(e.target.value)} className={field} />
            </div>
            <button type="button" disabled={busy || Number(perBoxDraft) === perBox} className={btn} onClick={() => void save(() => setAccountsPerBox(Number(perBoxDraft)))}>
              Save
            </button>
          </div>
        </Section>

        <Section title="day boundary" summary={summary['day boundary']} open={openSet.has('day boundary')} onToggle={toggle}>
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <div className="basis-64">
              <label htmlFor="tz" className={label}>
                Time zone for &quot;today&quot; totals and daily account caps
              </label>
              <select id="tz" value={zone} onChange={(e) => setZone(e.target.value)} className={field}>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" disabled={busy || zone === timezone} className={btn} onClick={() => void save(() => setTimezone(zone))}>
              Save
            </button>
          </div>
        </Section>

        <Section title="selectors" summary={summary['selectors']} open={openSet.has('selectors')} onToggle={toggle}>
          <div className="px-5 py-4">
            {selectors.map((s) => {
              const draft = drafts[s.key] ?? s.value;
              return (
                <div key={s.key} className="flex flex-wrap items-end gap-3 border-b border-divider py-3 last:border-b-0">
                  <div className="flex-1 basis-72">
                    <label htmlFor={`sel-${s.key}`} className={label}>
                      <span className="font-mono">{s.key}</span>
                      {s.description ? <span className="ml-2 font-normal text-muted">{s.description}</span> : null}
                    </label>
                    <input
                      id={`sel-${s.key}`}
                      value={draft}
                      onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                      className={`${field} font-mono text-[13px]`}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || draft === s.value}
                    className={btn}
                    onClick={async () => {
                      const ok = await save(() => updateSelector(s.key, draft));
                      if (ok) {
                        const next = { ...drafts };
                        delete next[s.key];
                        setDrafts(next);
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="operators" summary={summary['operators']} open={openSet.has('operators')} onToggle={toggle}>
          <div className="px-5 py-4">
            <ul className="space-y-1 font-mono text-[13px]">
              {operators.map((email) => (
                <li key={email}>{email}</li>
              ))}
            </ul>
          </div>
        </Section>
      </div>
    </>
  );
}
