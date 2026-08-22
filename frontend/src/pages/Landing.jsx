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
import flashdropMark from "@/assets/flashdrop-mark.png";

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

function Brand() {
  return (
    <Link to="/" className="landing-brand" aria-label="FlashDroop home">
      <img src={flashdropMark} alt="" className="landing-brand-mark" />
      <span className="landing-brand-copy">
        <strong>FlashDroop</strong>
        <small>EPHEMERAL HANDOFF</small>
      </span>
    </Link>
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
    <div className="demo-panel">
      <div className="demo-panel-head">
        <div>
          <span>LIVE PREVIEW</span>
          <strong>See a pickup happen before you send.</strong>
        </div>
        <span className="live-badge"><i /> LIVE</span>
      </div>

      <div className="demo-mode-tabs" aria-label="Preview access mode">
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

      <div className="demo-file">
        <div className="demo-file-icon"><UploadCloud /></div>
        <div className="demo-file-copy">
          <strong>launch_assets.zip</strong>
          <span>186.4 MB · 7 files</span>
        </div>
        <div className="demo-time"><Clock3 /> 24:18</div>
      </div>

      <div className="demo-progress-wrap">
        <div className="demo-progress-head">
          <span>{statusLabel}</span>
          <b>{status === "streaming" || status === "complete" ? `${progress}%` : "READY"}</b>
        </div>
        <div className="demo-progress"><span style={{ width: `${progress}%` }} /></div>
      </div>

      {status === "waiting" && (
        <div className="demo-claim">
          <div className="demo-device"><MousePointer2 /></div>
          <div>
            <strong>iPhone · Safari</strong>
            <span>wants to claim this drop</span>
          </div>
          <button type="button" className="reject" onClick={reject} aria-label="Reject simulated receiver"><X /></button>
          <button type="button" className="approve" onClick={approve}><Check /> Approve</button>
        </div>
      )}

      <div className="demo-events" aria-live="polite">
        {events.map((event) => (
          <div key={event.id} className={`demo-event tone-${event.tone}`}>
            <span className="demo-event-dot" />
            <span>{event.label}</span>
            <small>{event.time}</small>
          </div>
        ))}
      </div>

      <div className="demo-actions">
        <button
          type="button"
          className="demo-primary"
          onClick={simulateReceiver}
          disabled={status === "waiting" || status === "streaming"}
        >
          {status === "complete" || status === "rejected" ? "Run again" : "Simulate receiver"}
          <ArrowRight />
        </button>
        <span>Nothing here uploads anywhere.</span>
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
    <div className="landing-page" data-testid="landing-page">
      <div className="landing-bg" aria-hidden="true" />

      <nav className="landing-nav">
        <Brand />

        <div className="landing-nav-links" aria-label="Landing page sections">
          <a href="#how">How it works</a>
          <a href="#control">Control</a>
          <a href="#security">Why FlashDroop</a>
        </div>

        <div className="landing-nav-actions">
          <Link to="/app/receive" className="nav-secondary"><Download /> Receive</Link>
          <Link to="/app/send" className="nav-primary">Open app <ArrowRight /></Link>
        </div>
      </nav>

      <main>
        <section className="hero-section">
          <div className="hero-copy" data-reveal>
            <div className="hero-kicker"><span /> FAST · LIVE · TEMPORARY</div>
            <h1>
              File handoff,
              <span> without the cloud-drive baggage.</span>
            </h1>
            <p>
              Create a six-digit PIN immediately, start uploading in the background,
              and let receivers pick up files the moment they are ready.
            </p>

            <div className="hero-actions">
              <Link to="/app/send" className="hero-primary"><Send /> Send files <ArrowRight /></Link>
              <Link to="/app/receive" className="hero-secondary"><Download /> I have a PIN</Link>
            </div>

            <div className="hero-trust">
              <div><strong>0</strong><span>accounts</span></div>
              <div><strong>20</strong><span>files per drop</span></div>
              <div><strong>10–60m</strong><span>auto-expiry</span></div>
            </div>
          </div>

          <div className="hero-product" data-reveal>
            <div className="product-frame">
              <div className="product-topbar">
                <span>ACTIVE DROP</span>
                <span className="live-badge"><i /> LIVE</span>
              </div>

              <div className="product-file">
                <div className="product-file-icon"><Sparkles /></div>
                <div>
                  <strong>campaign_master.zip</strong>
                  <span>412.8 MB · 12 files</span>
                </div>
                <b>67%</b>
              </div>

              <div className="product-progress"><span /></div>

              <div className="product-pin">
                <span>SHARE PIN</span>
                <strong>482 913</strong>
              </div>

              <div className="product-stats">
                <div><Users /><span><b>2</b> pickups left</span></div>
                <div><TimerReset /><span><b>24:18</b> expires</span></div>
              </div>
            </div>

            <div className="product-float product-float-top">
              <UserCheck />
              <div><strong>Receiver approved</strong><span>iPhone · Safari</span></div>
              <CheckCircle2 />
            </div>

            <div className="product-float product-float-bottom">
              <Flame />
              <div><strong>Burn rule</strong><span>After all pickups</span></div>
            </div>
          </div>
        </section>

        <section className="feature-strip" data-reveal>
          <div><Gauge /><strong>Live Drop</strong><span>Share before upload finishes</span></div>
          <div><Zap /><strong>Native streaming</strong><span>Files unlock as they become ready</span></div>
          <div><ShieldCheck /><strong>Controlled access</strong><span>PIN discovers; pickup rules decide</span></div>
          <div><Radio /><strong>Live receipt</strong><span>See claims, progress, completion</span></div>
        </section>

        <section className="content-section" id="how">
          <div className="section-intro" data-reveal>
            <span className="section-label">HOW IT WORKS</span>
            <h2>Three steps. No account ceremony.</h2>
            <p>FlashDroop keeps the transfer itself in focus: create, share, confirm.</p>
          </div>

          <div className="steps-grid">
            <article className="step-card" data-reveal>
              <span className="step-index">01</span>
              <div className="step-icon"><UploadCloud /></div>
              <h3>Create the drop</h3>
              <p>Select files and choose your expiry, pickup count, and access mode.</p>
              <span className="step-meta">PIN FIRST</span>
            </article>

            <article className="step-card" data-reveal>
              <span className="step-index">02</span>
              <div className="step-icon"><Send /></div>
              <h3>Share the PIN</h3>
              <p>The receiver can join while uploads continue in the background.</p>
              <span className="step-meta">LIVE UPLOAD</span>
            </article>

            <article className="step-card" data-reveal>
              <span className="step-index">03</span>
              <div className="step-icon"><Radio /></div>
              <h3>Watch the handoff</h3>
              <p>See claim requests, transfer progress, completion, and burn events.</p>
              <span className="step-meta">LIVE RECEIPT</span>
            </article>
          </div>
        </section>

        <section className="control-section" id="control">
          <div className="control-copy" data-reveal>
            <span className="section-label">CONTROL</span>
            <h2>Decide how a receiver gets in.</h2>
            <p>
              Instant for speed. Confirm when you want approval. One Device when the
              first receiver should own the handoff.
            </p>

            <div className="control-list">
              <div><CheckCircle2 /><span><b>Instant</b> — claim immediately with the PIN.</span></div>
              <div><UserCheck /><span><b>Confirm</b> — you approve the device first.</span></div>
              <div><LockKeyhole /><span><b>One Device</b> — first approved pickup wins.</span></div>
            </div>
          </div>

          <div data-reveal>
            <InteractiveReceipt />
          </div>
        </section>

        <section className="why-section" id="security">
          <div className="section-intro" data-reveal>
            <span className="section-label">WHY FLASHDROOP</span>
            <h2>Designed like a handoff, not a storage product.</h2>
          </div>

          <div className="why-grid">
            <article className="why-card why-card-dark" data-reveal>
              <div className="why-icon"><UserCheck /></div>
              <span className="why-tag">PICKUP CONTROL</span>
              <h3>Approve a receiver, not just a code.</h3>
              <p>
                Confirm mode keeps discovery and permission separate. The PIN finds the
                drop; your approval unlocks it.
              </p>
              <div className="mini-claim">
                <div><span className="avatar">iP</span><span><b>iPhone · Safari</b><small>Waiting for approval</small></span></div>
                <button type="button">Approve</button>
              </div>
            </article>

            <article className="why-card" data-reveal>
              <div className="why-icon"><Users /></div>
              <span className="why-tag">PICKUP PASSES</span>
              <h3>Count receivers, not file requests.</h3>
              <p>One pickup session can retrieve the whole bundle without wasting a slot on every file.</p>
            </article>

            <article className="why-card" data-reveal>
              <div className="why-icon"><Flame /></div>
              <span className="why-tag">BURN RULES</span>
              <h3>Deletion is part of the workflow.</h3>
              <p>Expire on time, burn after a pickup, or close the drop manually when you are done.</p>
            </article>

            <article className="why-card why-card-wide" data-reveal>
              <div className="receipt-list">
                <div><span className="ok" /><b>11:42:04</b><strong>Receiver claimed pickup</strong></div>
                <div><span className="ok" /><b>11:42:07</b><strong>Download started</strong></div>
                <div><span className="active" /><b>11:42:11</b><strong>186 MB / 412 MB · streaming</strong></div>
                <div><span /><b>—</b><strong>Pickup completion</strong></div>
              </div>
              <div>
                <div className="why-icon"><Radio /></div>
                <span className="why-tag">LIVE RECEIPT</span>
                <h3>Know what actually happened.</h3>
                <p>Claims, starts, progress, completion, interruptions, and burn events stay visible in one place.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="closing-cta" data-reveal>
          <div>
            <span>READY WHEN YOU ARE</span>
            <h2>Send it. See the pickup. Burn it.</h2>
            <p>No account, no drive folder, no long-lived share link.</p>
          </div>

          <div className="closing-actions">
            <Link to="/app/send" className="closing-primary"><Send /> Start a FlashDroop <ArrowRight /></Link>
            <Link to="/app/receive" className="closing-secondary"><Download /> Receive with PIN</Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <Brand />
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