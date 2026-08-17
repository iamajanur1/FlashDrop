import { useEffect } from "react";
import { Link } from "react-router-dom";
import "./Landing.css";

export default function Landing() {
  useEffect(() => {
    document.title = "FlashDrop — Files that don't wait";
  }, []);

  return (
    <div className="fd-landing" data-testid="landing-page">
      <nav>
        <div className="nav-brand">
          <div className="nav-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2L4 14H11L10 22L20 9H13L13 2Z" fill="white" />
            </svg>
          </div>
          <span>FlashDrop</span>
        </div>
        <div className="nav-links">
          <a href="#how" data-testid="nav-how-link">How it works</a>
          <a href="#features" data-testid="nav-features-link">Security</a>
          <Link to="/app" className="btn-launch" data-testid="nav-launch-btn">
            Launch FlashDrop
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-grid">
          <div>
            <div className="eyebrow"><span className="dot"></span> NOW LIVE · SELF-DESTRUCTING TRANSFERS</div>
            <h1 className="hero-title">Some files<br />shouldn&apos;t <span className="accent">outlive</span><br />the moment.</h1>
            <p className="hero-sub">FlashDrop moves urgent files in seconds, then erases every trace. No account, no inbox clutter, no link floating around after you&apos;re done with it.</p>
            <div className="hero-ctas">
              <Link to="/app" className="btn-primary" data-testid="hero-launch-btn">Send a file now</Link>
              <a href="#how" className="btn-ghost">See how it works ↓</a>
            </div>
            <div className="hero-stats">
              <div className="stat"><b>700MB</b><span>PER TRANSFER</span></div>
              <div className="stat"><b>0</b><span>ACCOUNTS NEEDED</span></div>
              <div className="stat"><b>10min–1hr</b><span>AUTO-EXPIRY</span></div>
            </div>
          </div>
          <div className="hero-visual">
            <div className="device">
              <div className="device-head">
                <span>ACTIVE TRANSFER</span>
                <div className="live-tag"><span className="dot"></span>LIVE</div>
              </div>
              <div className="file-card">
                <div className="file-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                </div>
                <div className="file-meta">
                  <div className="fname">contract_final_v3.pdf</div>
                  <div className="fsize">4.2 MB</div>
                </div>
                <div className="countdown-chip">27:41</div>
              </div>
              <div className="device-progress"><div className="device-progress-bar"></div></div>
              <div className="device-foot">
                <span>2 OF 3 DOWNLOADS USED</span>
                <span>AES-256</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section-tag">// HOW IT WORKS</div>
        <h2 className="section-title">Three steps. Under a minute. Nothing left behind.</h2>
        <p className="section-sub">FlashDrop is built around a single idea — a transfer should exist only as long as it needs to.</p>
        <div className="steps">
          <div className="step">
            <div className="step-time mono">00:00</div>
            <h3>Drop your files</h3>
            <p>Drag up to 20 files, up to 700MB total. No sign-up form standing between you and the upload.</p>
          </div>
          <div className="step">
            <div className="step-time mono">00:04</div>
            <h3>Set the terms</h3>
            <p>Choose how long the link stays alive — 10 minutes to an hour — and how many times it can be downloaded.</p>
          </div>
          <div className="step">
            <div className="step-time mono">00:07</div>
            <h3>Share and forget</h3>
            <p>Send the link. Once it expires or hits its download limit, the files are gone — permanently.</p>
          </div>
        </div>
      </section>

      <section className="features-wrap" id="features">
        <div className="section">
          <div className="section-tag">// BUILT FOR URGENCY</div>
          <h2 className="section-title">Everything you need. Nothing that lingers.</h2>
          <p className="section-sub" style={{ color: "var(--mist)" }}>No dashboards to manage, no history to clean up later.</p>
          <div className="feature-grid">
            <div className="feature">
              <div className="feature-icon"><svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></div>
              <h3>No login, ever</h3>
              <p>Open the page and start sending. No accounts, no passwords to remember.</p>
            </div>
            <div className="feature">
              <div className="feature-icon"><svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg></div>
              <h3>Auto-delete on expiry</h3>
              <p>Every transfer runs on a timer. When it hits zero, the files are wiped from our servers.</p>
            </div>
            <div className="feature">
              <div className="feature-icon"><svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7z" /></svg></div>
              <h3>Download limits</h3>
              <p>Cap a link at 1, 3, 5, or 10 downloads so it can&apos;t be reshared past its purpose.</p>
            </div>
            <div className="feature">
              <div className="feature-icon"><svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Z" /></svg></div>
              <h3>End-to-end encryption</h3>
              <p>Turn on Private Drop and files are encrypted in your browser. The key rides in the link — never on our servers.</p>
            </div>
            <div className="feature">
              <div className="feature-icon"><svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" /></svg></div>
              <h3>Live pings</h3>
              <p>See the moment your file is picked up. A live feed on your PIN screen tells you when, where, and on what.</p>
            </div>
            <div className="feature">
              <div className="feature-icon"><svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg></div>
              <h3>Built for the moment</h3>
              <p>No history tab, no saved recipients. Every transfer starts and ends clean.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="cta-band">
        <h2>Send it before it&apos;s gone.</h2>
        <p>Your first transfer takes less time than reading this sentence.</p>
        <Link to="/app" className="btn-primary" data-testid="cta-launch-btn">Launch FlashDrop →</Link>
      </div>

      <footer>
        <div className="nav-brand">
          <div className="nav-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2L4 14H11L10 22L20 9H13L13 2Z" fill="white" />
            </svg>
          </div>
          <span>FlashDrop</span>
        </div>
        <p>INSTANT · SECURE · TEMPORARY — © 2026 FLASHDROP</p>
      </footer>
    </div>
  );
}
