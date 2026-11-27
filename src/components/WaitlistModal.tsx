'use client';

import { useState } from 'react';

const ORDER_BANDS = ['Under 100', '100 – 500', '500 – 2,000', '2,000 – 10,000', '10,000+'];

export function WaitlistModal() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [marketplace, setMarketplace] = useState('eBay');
  const [orders, setOrders] = useState('');
  const [comment, setComment] = useState('');

  function close() {
    setOpen(false);
    // Reset after the overlay is gone so a re-open starts clean.
    setTimeout(() => { setDone(false); setErr(''); }, 200);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!email.includes('@')) { setErr('Enter a valid email so we can reach you.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, marketplace, monthly_orders: orders, comment }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) { setErr(typeof data.error === 'string' ? data.error : 'Something went wrong. Try again.'); return; }
      setDone(true);
    } catch {
      setErr('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="dd-btn dd-primary" onClick={() => setOpen(true)}>Request early access</button>

      {open ? (
        <div className="dd-overlay" role="dialog" aria-modal="true" aria-label="Request early access" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="dd-modal">
            {done ? (
              <div className="dd-done">
                <div className="check">&#10003;</div>
                <h2>You&rsquo;re on the list</h2>
                <p className="lead">Thanks &mdash; we&rsquo;ll reach out at <strong>{email}</strong> when early access opens.</p>
                <button type="button" className="dd-btn dd-ghost" style={{ width: '100%' }} onClick={close}>Close</button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <h2>Request early access</h2>
                <p className="lead">Tell us a little about your store and we&rsquo;ll be in touch.</p>
                {err ? <div className="dd-err">{err}</div> : null}

                <div className="dd-field">
                  <label htmlFor="wl-email">Email</label>
                  <input id="wl-email" type="email" required autoComplete="email" placeholder="you@store.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>

                <div className="dd-field">
                  <label htmlFor="wl-mkt">Your marketplace</label>
                  <select id="wl-mkt" value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
                    <option value="eBay">eBay</option>
                  </select>
                </div>

                <div className="dd-field">
                  <label htmlFor="wl-orders">Orders per month</label>
                  <select id="wl-orders" value={orders} onChange={(e) => setOrders(e.target.value)}>
                    <option value="">Select a range&hellip;</option>
                    {ORDER_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div className="dd-field">
                  <label htmlFor="wl-comment">Anything you&rsquo;d want? (optional)</label>
                  <textarea id="wl-comment" placeholder="Features or functions you&rsquo;d love to see&hellip;" value={comment} onChange={(e) => setComment(e.target.value)} />
                </div>

                <div className="dd-modal-actions">
                  <button type="button" className="dd-btn dd-ghost" onClick={close} disabled={busy}>Cancel</button>
                  <button type="submit" className="dd-btn dd-primary" disabled={busy}>{busy ? 'Sending…' : 'Join the list'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
