'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setTimezone, updateSelector } from '@/app/(console)/actions';
import { ThemeToggle } from '@/components/admin/ThemeToggle';
import type { SelectorRow } from '@/app/(console)/settings/page';
import { btn, Card, ErrorNote, field, label, PageHead } from './ui';

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'UTC'];

export function SettingsView({
  selectors,
  operators,
  timezone,
  initialError,
}: {
  selectors: SelectorRow[];
  operators: string[];
  timezone: string;
  initialError: string;
}) {
  const router = useRouter();
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [zone, setZone] = useState(timezone);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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
