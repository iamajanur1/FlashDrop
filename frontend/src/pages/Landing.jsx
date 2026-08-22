import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Flame,
  Gauge,
  LockKeyhole,
  MousePointer2,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UploadCloud,
  UserCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import "./Landing.css";
import flashdropLogo from "@/assets/flashdrop-logo.png";

const ACCESS_MODES = [
  { value: "instant", label: "Instant", icon: Zap },
  { value: "confirm", label: "Confirm", icon: UserCheck },
  { value: "one_device", label: "One Device", icon: LockKeyhole },
];

const EVENT_COPY = {
  idle: "Drop created",
  waiting: "Receiver waiting for approval",
  streaming: "Download streaming",
  complete: "Pickup completed",
  rejected: "Receiver rejected",
};

function BrandMark({ small = false }) {
  return (
    <div className={`fd-brand-mark ${small ? "is-small" : ""}`} aria-hidden="true">
      <Zap fill="currentColor" strokeWidth={2.4} />
    </div>
  );
}

function InteractiveReceipt() {
  const [mode, setMode] = useState("confirm");
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [events, setEvents] = useState([
    { id: 1, label: "Drop created", time: "now", tone: "neutral" },
  ]);

  const addEvent = (label, tone = "neutral") => {
    setEvents((current) => [
      ...current.slice(-3),
      { id: Date.now() + Math.random(), label, time: "now", tone },
    ]);
  };

  const resetDemo = (nextMode = mode) => {
    setMode(nextMode);
    setStatus("idle");
    setProgress(0);
    setEvents([{ id: Date.now(), label: "Drop created", time: "now", tone: "neutral" }]);
  };

  const simulateReceiver = () => {
    if (status !== "idle" && status !== "rejected" && status !== "complete") return;
    if (status === "complete" || status === "rejected") resetDemo(mode);

    if (mode === "confirm") {
      setStatus("waiting");
      addEvent("Receiver requested a pickup", "amber");
    } else {
      setStatus("streaming");
      setProgress(7);
      addEvent(mode === "one_device" ? "First device claimed the drop" : "Pickup pass claimed", "indigo");
    }
  };

  const approve = () => {
    setStatus("streaming");
    setProgress(8);
    addEvent("Receiver approved", "indigo");
  };

  const reject = () => {
    setStatus("rejected");
    setProgress(0);
    addEvent("Receiver rejected", "amber");
  };

  useEffect(() => {
    if (status !== "streaming") return undefined;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(100, current + Math.max(4, Math.round((100 - current) / 9)));
        if (next >= 100) {
          window.clearInterval(timer);
          window.setTimeout(() => {
            setStatus("complete");
            addEvent("Pickup completed · receipt verified", "green");
          }, 180);
        }
        return next;
      });
    }, 280);
    return () => window.clearInterval(timer);
  }, [status]);

  const statusLabel = useMemo(() => EVENT_COPY[status] || "Ready", [status]);

  return (
    <div className="fd-demo-shell">
      <div className="fd-demo-toolbar">
        <div>
          <span className="fd-demo-kicker">INTERACTIVE PREVIEW</span>
          <strong>Flash Claim + Live Receipt</strong>
        </div>
        <span className="fd-live-chip"><span /> LIVE</span>
      </div>

      <div className="fd-demo-modes" aria-label="Preview access mode">
        {ACCESS_MODES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.value}
              className={mode === item.value ? "active" : ""}
              onClick={() => resetDemo(item.value)}
            >
              <Icon /> {item.label}
            </button>
          );
        })}
      </div>

      <div className="fd-demo-file">
        <div className="fd-file-icon"><UploadCloud /></div>
        <div className="fd-demo-file-meta">
          <strong>launch_assets.zip</strong>
          <span>186.4 MB · 7 files</span>
        </div>
        <div className="fd-expire-chip"><Clock3 /> 24:18</div>
      </div>

      <div className="fd-demo-progress-wrap">
        <div className="fd-demo-progress-head">
          <span>{statusLabel}</span>
          <b>{status === "streaming" || status === "complete" ? `${progress}%` : "READY"}</b>
        </div>
        <div className="fd-demo-progress"><span style={{ width: `${progress}%` }} /></div>
      </div>

      {status === "waiting" && (
        <div className="fd-claim-request">
          <div className="fd-device-avatar"><MousePointer2 /></div>
          <div>
            <strong>iPhone · Safari</strong>
            <span>wants to claim this drop</span>
          </div>
          <button type="button" className="reject" onClick={reject} aria-label="Reject simulated receiver"><X /></button>
          <button type="button" className="approve" onClick={approve}><Check /> Approve</button>
        </div>
      )}

      <div className="fd-receipt-list" aria-live="polite">
        {events.map((event) => (
          <div key={event.id} className={`fd-receipt-item tone-${event.tone}`}>
            <span className="fd-receipt-dot" />
            <span>{event.label}</span>
            <small>{event.time}</small>
          </div>
        ))}
      </div>

      <div className="fd-demo-actions">
        <button
          type="button"
          className="fd-demo-primary"
          onClick={simulateReceiver}
          disabled={status === "waiting" || status === "streaming"}
        >
          {status === "complete" || status === "rejected" ? "Run again" : "Simulate receiver"}
          <ArrowRight />
        </button>
        <span>Try the modes above</span>
      </div>
    </div>
  );
}

export default function Landing() {
  useEffect(() => {
    document.title = "FlashDroop — Fast, live, temporary file handoff";

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
      },
      { threshold: 0.12 },
    );

    const elements = document.querySelectorAll("[data-reveal]");
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="fd-landing" data-testid="landing-page">
      <div className="fd-landing-noise" aria-hidden="true" />

      <nav className="fd-nav">
        <Link to="/" className="fd-nav-brand" aria-label="FlashDrop home">
            <img
              src={flashdropLogo}
              alt="FlashDrop"
              className="fd-brand-logo"
            />
        </Link>

        <div className="fd-nav-center" aria-label="Landing page sections">
          <a href="#how">How it works</a>
          <a href="#control">Control</a>
          <a href="#performance">Speed</a>
        </div>

        <div className="fd-nav-actions">
          <Link to="/app/receive" className="fd-nav-receive"><Download /> Receive</Link>
          <Link to="/app/send" className="fd-nav-launch">Open app <ArrowRight /></Link>
        </div>
      </nav>

      <header className="fd-hero">
        <div className="fd-hero-copy" data-reveal>
          <div className="fd-eyebrow"><span className="fd-eyebrow-pulse" /> FAST · LIVE · TEMPORARY</div>
          <h1>
            Files should move<br />
            <span>faster than trust.</span>
          </h1>
          <p>
            FlashDroop is a controlled, self-destructing file handoff. Your six-digit PIN appears before the upload finishes, receivers can join immediately, and each file unlocks the moment it is ready.
          </p>

          <div className="fd-hero-actions">
            <Link to="/app/send" className="fd-primary-cta"><Send /> Send files now <ArrowRight /></Link>
            <Link to="/app/receive" className="fd-secondary-cta"><Download /> I have a PIN</Link>
          </div>

          <div className="fd-proof-row">
            <div><b>0</b><span>accounts</span></div>
            <div><b>1.5GB</b><span>per drop</span></div>
            <div><b>20</b><span>files</span></div>
            <div><b>10–60m</b><span>auto-expiry</span></div>
          </div>
        </div>

        <div className="fd-hero-visual" data-reveal>
          <div className="fd-orbit fd-orbit-one" aria-hidden="true" />
          <div className="fd-orbit fd-orbit-two" aria-hidden="true" />
          <div className="fd-visual-card fd-visual-main">
            <div className="fd-visual-top">
              <span>ACTIVE DROP</span>
              <span className="fd-live-chip"><span /> LIVE</span>
            </div>
            <div className="fd-visual-file">
              <div className="fd-visual-file-icon"><Sparkles /></div>
              <div><strong>campaign_master.zip</strong><span>412.8 MB · 12 files</span></div>
              <b>67%</b>
            </div>
            <div className="fd-visual-progress"><span /></div>
            <div className="fd-visual-pin">
              <span>SHARE PIN</span>
              <strong>482 913</strong>
            </div>
            <div className="fd-visual-stats">
              <div><Users /><span><b>2</b> pickups left</span></div>
              <div><TimerReset /><span><b>24:18</b> expires</span></div>
            </div>
          </div>

          <div className="fd-visual-card fd-floating-card fd-floating-one">
            <UserCheck />
            <div><strong>Receiver approved</strong><span>iPhone · Safari</span></div>
            <CheckCircle2 />
          </div>
          <div className="fd-visual-card fd-floating-card fd-floating-two">
            <Flame />
            <div><strong>Burn rule</strong><span>After all pickups</span></div>
          </div>
        </div>
      </header>

      <section className="fd-speed-ribbon" id="performance" data-reveal>
        <div><Gauge /><strong>Live Drop</strong><span>Share the PIN while upload continues</span></div>
        <div><Zap /><strong>Streaming ZIP</strong><span>Starts before archive completion</span></div>
        <div><ShieldCheck /><strong>Capability tokens</strong><span>PIN is discovery, not admin access</span></div>
        <div><Radio /><strong>Live receipts</strong><span>Server-side lifecycle events</span></div>
      </section>

      <section className="fd-section fd-how" id="how">
        <div className="fd-section-heading" data-reveal>
          <div className="fd-section-label">01 / HOW IT WORKS</div>
          <h2>A transfer with a beginning, a receipt, and an ending.</h2>
          <p>No dashboard maze. No account ceremony. The full workflow stays understandable even when the controls get advanced.</p>
        </div>

        <div className="fd-step-grid">
          <article className="fd-step-card" data-reveal>
            <span className="fd-step-number">01</span>
            <div className="fd-step-icon"><UploadCloud /></div>
            <h3>Create the PIN first</h3>
            <p>Select up to 20 files. FlashDroop creates the handoff immediately, then uploads files in parallel while you already share the PIN or QR.</p>
            <span className="fd-step-meta">LIVE DROP · 700MB</span>
          </article>
          <article className="fd-step-card" data-reveal>
            <span className="fd-step-number">02</span>
            <div className="fd-step-icon"><UserCheck /></div>
            <h3>Set the pickup rules</h3>
            <p>Pick Instant, Confirm, or One Device. Choose pickup passes, expiry, and exactly when the drop should burn.</p>
            <span className="fd-step-meta">YOU CONTROL ACCESS</span>
          </article>
          <article className="fd-step-card" data-reveal>
            <span className="fd-step-number">03</span>
            <div className="fd-step-icon"><Radio /></div>
            <h3>Watch it happen</h3>
            <p>See claim requests, approvals, starts, progress, completion, interruptions, and the final burn event.</p>
            <span className="fd-step-meta">LIVE RECEIPT</span>
          </article>
        </div>
      </section>

      <section className="fd-section fd-control" id="control">
        <div className="fd-section-heading compact" data-reveal>
          <div className="fd-section-label">02 / CONTROL</div>
          <h2>Try the interaction before you send anything.</h2>
          <p>The live preview below is local-only. Switch access modes and simulate how a receiver claims a drop.</p>
        </div>
        <div data-reveal><InteractiveReceipt /></div>
      </section>

      <section className="fd-section fd-bento-section">
        <div className="fd-section-heading" data-reveal>
          <div className="fd-section-label">03 / DIFFERENT BY DESIGN</div>
          <h2>Not another cloud drive with a temporary link.</h2>
          <p>FlashDroop is built around the handoff itself: presence, control, proof, speed, and intentional deletion.</p>
        </div>

        <div className="fd-bento-grid">
          <article className="fd-bento-card fd-bento-large" data-reveal>
            <div className="fd-bento-icon"><UserCheck /></div>
            <span className="fd-bento-tag">FLASH CLAIM</span>
            <h3>Approve the receiver, not just the code.</h3>
            <p>In Confirm mode, the receiver can discover the drop with the PIN but cannot download until the sender approves that pickup session.</p>
            <div className="fd-mini-claim">
              <div><span className="fd-avatar-dot">iP</span><div><b>iPhone · Safari</b><small>Waiting for approval</small></div></div>
              <button type="button">Approve</button>
            </div>
          </article>

          <article className="fd-bento-card" data-reveal>
            <div className="fd-bento-icon"><Users /></div>
            <span className="fd-bento-tag">PICKUP PASSES</span>
            <h3>Count receivers, not HTTP requests.</h3>
            <p>One claimed pass can retrieve the whole bundle without wasting a slot for every individual file.</p>
          </article>

          <article className="fd-bento-card" data-reveal>
            <div className="fd-bento-icon"><Flame /></div>
            <span className="fd-bento-tag">BURN RULES</span>
            <h3>Make deletion part of the workflow.</h3>
            <p>Burn on expiry, after the first completed pickup, after all pickup passes, or instantly from the sender screen.</p>
          </article>

          <article className="fd-bento-card fd-bento-wide" data-reveal>
            <div className="fd-receipt-visual">
              <div><span className="ok" /><b>11:42:04</b><strong>Receiver claimed pickup</strong></div>
              <div><span className="ok" /><b>11:42:07</b><strong>Download started</strong></div>
              <div><span className="active" /><b>11:42:11</b><strong>186 MB / 412 MB · streaming</strong></div>
              <div><span /><b>—</b><strong>Pickup completion</strong></div>
            </div>
            <div>
              <div className="fd-bento-icon"><Radio /></div>
              <span className="fd-bento-tag">LIVE RECEIPT</span>
              <h3>See the transfer lifecycle as it happens.</h3>
              <p>The sender gets a server-side activity trail instead of an ambiguous “someone clicked download” message.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="fd-final-cta" data-reveal>
        <div className="fd-final-glow" aria-hidden="true" />
        <div>
          <span className="fd-section-label light">READY WHEN YOU ARE</span>
          <h2>Send it. See the pickup. Burn it.</h2>
          <p>Create the PIN immediately, share while files are still moving, and keep full pickup and burn control without an account.</p>
        </div>
        <div className="fd-final-actions">
          <Link to="/app/send" className="fd-primary-cta light"><Send /> Start a FlashDroop <ArrowRight /></Link>
          <Link to="/app/receive" className="fd-secondary-cta light"><Download /> Receive with PIN</Link>
        </div>
      </section>

      <footer className="fd-footer">
        <Link to="/" className="fd-nav-brand">
          <img
            src={flashdropLogo}
            alt="FlashDrop"
            className="fd-brand-logo"
          />
        </Link>
        <p>Fast · Live · Temporary — © 2026 FlashDroop</p>
        <div>
          <Link to="/app/send">Send</Link>
          <Link to="/app/receive">Receive</Link>
          <a href="#how">How it works</a>
        </div>
      </footer>
    </div>
  );
}
