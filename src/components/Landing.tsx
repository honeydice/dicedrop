import Link from 'next/link';
import { WaitlistModal } from '@/components/WaitlistModal';

/** Public marketing homepage at '/'. Operators see a Dashboard button back to the console. */
export function Landing({ isOperator }: { isOperator: boolean }) {
  return (
    <div className="ddland">
      <style>{CSS}</style>

      {isOperator ? (
        <Link href="/dashboard" className="dd-dash">Dashboard &rarr;</Link>
      ) : null}

      <section className="dd-hero">
        <div className="dd-wrap">
          <span className="dd-eyebrow">Managed Orders Infrastructure</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="dd-mark" src="/logo.png" alt="DiceDrop" width={104} height={104} />
          <div className="dd-wordmark" aria-label="DiceDrop">
            <span className="dd-dice">Dice</span>
            <span className="dd-drop" aria-hidden="true">
              <span className="lx d0">D</span>
              <span className="droplet" />
              <span className="lx d1">r</span>
              <span className="lx d2">o</span>
              <span className="lx d3">p</span>
            </span>
          </div>
          <h1>
            Fulfill your dropship orders through <span className="by">DiceDrop</span>.
          </h1>
          <p className="dd-sub">
            Place every order through our own Amazon accounts, and never worry about making accounts or hitting credit limits again.
          </p>
          <div className="dd-cta-row">
            <WaitlistModal />
            <a className="dd-btn dd-ghost" href="#how">See how it works</a>
          </div>
        </div>
      </section>

      <section className="dd-caps" id="how">
        <div className="dd-wrap">
          <div className="dd-caps-head">What DiceDrop runs for you</div>
          <div className="dd-grid">
            <div className="dd-cap">
              <div className="n">01</div>
              <h3>Managed accounts</h3>
              <p>Use our Amazon, Walmart, AliExpress and growing library of marketplace accounts &mdash; so you can scale without ever worrying about making accounts.</p>
            </div>
            <div className="dd-cap">
              <div className="n">02</div>
              <h3>Auto ordering</h3>
              <p>A sale hits your store, the order is placed for you in minutes. No tabs, no copy-paste.</p>
            </div>
            <div className="dd-cap">
              <div className="n">03</div>
              <h3>Tracking &amp; proof</h3>
              <p>Every package watched to delivery, with the carrier&rsquo;s drop-off photo saved as proof.</p>
            </div>
            <div className="dd-cap">
              <div className="n">04</div>
              <h3>Prepaid wallet</h3>
              <p>Load your balance with Stripe, Payoneer, PayPal or crypto &mdash; and we cover every buy.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="dd-footer">
        <div className="dd-wrap dd-foot">
          <div className="dd-foot-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="DiceDrop" width={28} height={28} />
          </div>
          <small>&copy; 2026 DiceDrop. All rights reserved.</small>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
.ddland{
  --ink:#0a0e13; --panel:#111823; --line:#1f2733; --l-fg:#e9eef4; --l-muted:#8b98a7; --faint:#5e6b7a;
  --l-accent:#5b9df9; --cream:#ece6d8;
  --disp:"Space Grotesk",system-ui,sans-serif; --body:"Inter",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,monospace; --digital:"Orbitron","JetBrains Mono",ui-monospace,monospace;
  position:relative; min-height:100vh; background:var(--ink); color:var(--l-fg);
  font-family:var(--body); line-height:1.6; -webkit-font-smoothing:antialiased; overflow-x:hidden;
}
.ddland *{box-sizing:border-box}
.ddland a{color:inherit;text-decoration:none}
.ddland .dd-wrap{width:100%;max-width:1040px;margin-inline:auto;padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px))}

.ddland .dd-dash{position:absolute;top:1rem;right:1rem;z-index:5;font-family:var(--mono);font-size:.8rem;
  padding:.5em 1em;border:1px solid var(--line);border-radius:10px;color:var(--l-muted);background:rgba(17,24,35,.7);backdrop-filter:blur(6px)}
.ddland .dd-dash:hover{border-color:var(--l-accent);color:var(--l-accent)}

.ddland .dd-hero{position:relative;text-align:center;padding-top:clamp(3.5rem,11vh,7rem);padding-bottom:clamp(3rem,8vh,5.5rem);
  background:radial-gradient(1100px 520px at 50% -8%, rgba(91,157,249,.16), transparent 60%),radial-gradient(640px 360px at 50% 0%, rgba(236,230,216,.06), transparent 70%),var(--ink);
  border-bottom:1px solid var(--line)}
.ddland .dd-eyebrow{font-family:var(--mono);font-size:.74rem;letter-spacing:.28em;text-transform:uppercase;color:var(--l-accent);display:inline-flex;align-items:center;gap:.6em}
.ddland .dd-eyebrow::before,.ddland .dd-eyebrow::after{content:"";width:26px;height:1px;background:linear-gradient(90deg,transparent,var(--l-accent))}
.ddland .dd-eyebrow::after{transform:scaleX(-1)}
.ddland .dd-mark{width:clamp(78px,15vw,104px);height:auto;margin:1.8rem auto .4rem;display:block;filter:drop-shadow(0 14px 34px rgba(0,0,0,.55));border-radius:18px}

.ddland .dd-wordmark{display:inline-flex;align-items:flex-start;gap:.1em;font-family:var(--digital);font-weight:700;font-size:clamp(2rem,5vw,3.1rem);letter-spacing:.06em;line-height:.9;color:var(--l-fg);margin-top:.4rem}
.ddland .dd-drop{position:relative;display:flex;flex-direction:column;align-items:center;color:var(--l-accent);line-height:.78}
.ddland .dd-drop .lx{display:block}
.ddland .dd-drop .d0{font-size:1em}
.ddland .dd-drop .d1{font-size:.80em}
.ddland .dd-drop .d2{font-size:.63em}
.ddland .dd-drop .d3{font-size:.50em}
.ddland .dd-drop .d1,.ddland .dd-drop .d2,.ddland .dd-drop .d3{opacity:0;animation:dd-emerge .5s cubic-bezier(.2,.9,.3,1.25) forwards}
.ddland .dd-drop .d1{animation-delay:.82s}
.ddland .dd-drop .d2{animation-delay:.97s}
.ddland .dd-drop .d3{animation-delay:1.12s}
.ddland .dd-drop .droplet{position:absolute;left:50%;top:.78em;width:.2em;height:.2em;border-radius:50%;background:var(--l-accent);box-shadow:0 0 .45em rgba(91,157,249,.55);transform:translate(-50%,-.3em) scale(0);opacity:0;animation:dd-drip 1.2s ease-in forwards}
@keyframes dd-drip{0%{transform:translate(-50%,-.35em) scaleX(.55) scaleY(.4);opacity:0}13%{transform:translate(-50%,-.12em) scaleX(.68) scaleY(1.2);opacity:1}50%{transform:translate(-50%,1.0em) scaleX(.58) scaleY(1.4);opacity:1}67%{transform:translate(-50%,1.5em) scaleX(1.15) scaleY(.6);opacity:1}82%{transform:translate(-50%,1.5em) scaleX(2) scaleY(.22);opacity:.5}100%{transform:translate(-50%,1.5em) scaleX(2.8) scaleY(.07);opacity:0}}
@keyframes dd-emerge{0%{opacity:0;transform:scale(.2)}60%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}

.ddland h1{font-family:var(--disp);font-weight:700;letter-spacing:-.02em;text-wrap:balance;font-size:clamp(2.15rem,6vw,4rem);line-height:1.04;margin:1.6rem auto .2rem;max-width:16ch}
.ddland h1 .cream{color:var(--cream)}
.ddland h1 .by{color:var(--l-accent)}
.ddland .dd-sub{max-width:52ch;margin:1.25rem auto 0;color:var(--l-muted);font-size:clamp(1rem,1.9vw,1.18rem)}
.ddland .dd-cta-row{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap;margin-top:2.2rem}
.ddland .dd-btn{font-family:var(--disp);font-weight:600;font-size:.98rem;padding:.85em 1.6em;border-radius:12px;border:1px solid transparent;cursor:pointer;transition:transform .15s ease,background .15s ease,border-color .15s ease;line-height:1}
.ddland .dd-btn:active{transform:translateY(1px)}
.ddland .dd-primary{background:var(--l-accent);color:#07101f;box-shadow:0 10px 30px -10px rgba(91,157,249,.6)}
.ddland .dd-primary:hover{background:#74adfb}
.ddland .dd-ghost{background:transparent;color:var(--l-fg);border-color:var(--line)}
.ddland .dd-ghost:hover{border-color:var(--l-accent);color:var(--l-accent)}

.ddland .dd-caps{padding-block:clamp(3rem,7vh,4.75rem)}
.ddland .dd-caps-head{font-family:var(--mono);font-size:.72rem;letter-spacing:.26em;text-transform:uppercase;color:var(--faint);text-align:center;margin-bottom:2.2rem}
.ddland .dd-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.ddland .dd-cap{background:var(--panel);padding:1.6rem 1.4rem;min-width:0}
.ddland .dd-cap .n{font-family:var(--mono);font-size:.72rem;color:var(--l-accent);letter-spacing:.1em}
.ddland .dd-cap h3{font-family:var(--disp);font-weight:600;font-size:1.08rem;margin:.7rem 0 .45rem}
.ddland .dd-cap p{color:var(--l-muted);font-size:.92rem;margin:0}
@media(max-width:860px){.ddland .dd-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:480px){.ddland .dd-grid{grid-template-columns:1fr}}

.ddland .dd-footer{border-top:1px solid var(--line);padding-block:2.4rem;color:var(--faint)}
.ddland .dd-foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.ddland .dd-foot-brand{display:flex;align-items:center;gap:.7rem;font-family:var(--digital);font-weight:700;letter-spacing:.04em;color:var(--l-muted)}
.ddland .dd-foot-brand img{width:28px;height:28px;border-radius:7px}
.ddland .dd-foot small{font-family:var(--mono);font-size:.76rem}

/* ---- waitlist modal ---- */
.ddland .dd-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,8,13,.72);backdrop-filter:blur(4px)}
.ddland .dd-modal{width:100%;max-width:440px;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:1.6rem;box-shadow:0 30px 80px -20px rgba(0,0,0,.7)}
.ddland .dd-modal h2{font-family:var(--disp);font-weight:700;font-size:1.3rem;margin:0 0 .3rem}
.ddland .dd-modal .lead{color:var(--l-muted);font-size:.9rem;margin:0 0 1.2rem}
.ddland .dd-field{display:flex;flex-direction:column;gap:.35rem;margin-bottom:1rem}
.ddland .dd-field label{font-family:var(--mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--l-muted)}
.ddland .dd-field input,.ddland .dd-field select,.ddland .dd-field textarea{width:100%;background:var(--ink);border:1px solid var(--line);border-radius:10px;padding:.7em .8em;color:var(--l-fg);font-family:var(--body);font-size:.95rem}
.ddland .dd-field textarea{resize:vertical;min-height:70px}
.ddland .dd-field input:focus,.ddland .dd-field select:focus,.ddland .dd-field textarea:focus{outline:2px solid var(--l-accent);outline-offset:1px;border-color:var(--l-accent)}
.ddland .dd-modal-actions{display:flex;gap:.7rem;margin-top:.4rem}
.ddland .dd-modal-actions .dd-btn{flex:1}
.ddland .dd-err{color:#ff8182;font-size:.85rem;margin:.2rem 0 .8rem}
.ddland .dd-done{text-align:center;padding:1rem 0}
.ddland .dd-done .check{width:48px;height:48px;border-radius:50%;background:rgba(91,157,249,.15);color:var(--l-accent);display:flex;align-items:center;justify-content:center;font-size:1.6rem;margin:0 auto 1rem}

@media(prefers-reduced-motion:reduce){
  .ddland .dd-drop .droplet{display:none}
  .ddland .dd-drop .d1,.ddland .dd-drop .d2,.ddland .dd-drop .d3{opacity:1;animation:none;transform:none}
  .ddland *{transition:none!important}
}
`;
