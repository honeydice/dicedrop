'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { disconnectContabo, restoreContaboServers, saveContabo, setTimezone, syncContabo, updateSelector } from '@/app/(console)/actions';
import { ThemeToggle } from '@/components/admin/ThemeToggle';
import type { SelectorRow } from '@/app/(console)/settings/page';
import type { ContaboStatus } from '@/lib/types';
import { btn, btnAccent, btnDanger, Card, Dot, ErrorNote, field, label, PageHead, TONE, when } from './ui';

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'UTC'];

export function SettingsView({
  selectors,
  operators,
  timezone,
  initialError,
  contabo,
}: {
  selectors: SelectorRow[];
  operators: string[];
  timezone: string;
  initialError: string;
  contabo: ContaboStatus | null;
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

  return (
    <>
      <PageHead title="Settings" />
      <ErrorNote message={error} />

      <div className="space-y-5">
        <Card title="appearance">
          <div className="px-5 py-4">
            <ThemeToggle />
          </div>
        </Card>

        <Card title="contabo connection">
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
                    : 'Connect to import your Contabo servers, see their status, and start, restart, or shut them down from the VPS page.'}
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
                  <span className="text-xs text-muted">
                    Find these in the Contabo Customer Control Panel under API. They are stored encrypted and never shown again.
                  </span>
                </div>
              </form>
            )}
          </div>
        </Card>

        <Card title="day boundary">
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
        </Card>

        <Card title="selectors">
          <p className="px-5 pt-4 text-[13px] text-muted">
            Where Amazon&apos;s buttons and fields live. Every box picks up a change on its next check-in, so a page change on Amazon is a one-row edit here.
          </p>
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
        </Card>

        <Card title="operators">
          <div className="px-5 py-4">
            <p className="text-[13px] text-muted">The people who can sign in to this console. Nobody else has access.</p>
            <ul className="mt-3 space-y-1 font-mono text-[13px]">
              {operators.map((email) => (
                <li key={email}>{email}</li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
