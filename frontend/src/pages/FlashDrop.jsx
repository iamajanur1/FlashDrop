import { useEffect } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Download,
  Home,
  Radio,
  Send,
  Sparkles,
  Zap,
} from "lucide-react";

import flashdropMark from "@/assets/flashdrop-mark.png";

import SendFlow from "@/components/flashdrop/SendFlow";
import ReceiveFlow from "@/components/flashdrop/ReceiveFlow";

export default function FlashDrop({ defaultTab = "send" }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const pin = searchParams.get("pin") || "";

  const tab =
    location.pathname.includes("receive") || pin
      ? "receive"
      : defaultTab;

  useEffect(() => {
    document.title =
      tab === "send"
        ? "Send — FlashDroop"
        : "Receive — FlashDroop";
  }, [tab]);

  useEffect(() => {
    if (pin && location.pathname !== "/app/receive") {
      navigate(
        `/app/receive?pin=${encodeURIComponent(pin)}`,
        { replace: true }
      );
    }
  }, [location.pathname, navigate, pin]);

  const switchTab = (next) => {
    navigate(
      next === "send"
        ? "/app/send"
        : "/app/receive"
    );
  };

  return (
    <div className="fd-app-shell min-h-screen relative overflow-hidden">
      <div
        className="fd-app-grid"
        aria-hidden="true"
      />

      <div
        className="fd-app-orb fd-app-orb-one"
        aria-hidden="true"
      />

      <div
        className="fd-app-orb fd-app-orb-two"
        aria-hidden="true"
      />

      {/* HEADER */}
      <header className="relative z-20 w-full border-b border-white/70 bg-white/75 backdrop-blur-xl">
        <div className="w-full max-w-[860px] mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between gap-4">

          {/* BRAND */}
          <Link
            to="/"
            className="flex items-center gap-2.5 group min-w-0"
            data-testid="app-logo"
            aria-label="FlashDroop home"
          >
            <img
              src={flashdropMark}
              alt=""
              className="w-[34px] h-[48px] object-contain flex-shrink-0"
            />

            <div className="flex flex-col justify-center min-w-0">
              <span className="font-display font-bold text-[17px] sm:text-[18px] leading-none tracking-[-0.03em] text-gray-950 group-hover:text-indigo-600 transition-colors">
                FlashDroop
              </span>

              <span className="hidden sm:block mt-1 text-[7px] leading-none tracking-[0.2em] font-bold text-gray-400 whitespace-nowrap">
                EPHEMERAL HANDOFF
              </span>
            </div>
          </Link>

          {/* NAVIGATION */}
          <nav
            className="flex items-center gap-1.5"
            aria-label="Application navigation"
          >
            <Link
              to="/"
              className="fd-app-nav-link hidden sm:inline-flex"
            >
              <Home className="w-3.5 h-3.5" />
              Home
            </Link>

            <Link
              to="/#how"
              className="fd-app-nav-link hidden md:inline-flex"
            >
              <Sparkles className="w-3.5 h-3.5" />
              How it works
            </Link>

            <button
              type="button"
              onClick={() =>
                switchTab(
                  tab === "send"
                    ? "receive"
                    : "send"
                )
              }
              className="fd-app-nav-action"
            >
              {tab === "send" ? (
                <Download className="w-3.5 h-3.5" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}

              {tab === "send"
                ? "Receive"
                : "Send"}
            </button>
          </nav>
        </div>
      </header>

      {/* MAIN */}
      <main className="relative z-10 w-full max-w-[860px] mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6">

        <div className="fd-workspace-head fd-fade-up">
          <div className="min-w-0">

            <div className="fd-workspace-kicker">
              <Radio className="w-3.5 h-3.5" />

              {tab === "send"
                ? "Live Drop"
                : "Pickup Portal"}
            </div>

            <h1
              className="fd-workspace-title"
              data-testid="hero-headline"
            >
              {tab === "send" ? (
                <>
                  Send files.{" "}
                  <span className="fd-text-gradient">
                    PIN first.
                  </span>
                </>
              ) : (
                <>
                  Enter PIN.{" "}
                  <span className="fd-text-gradient">
                    Pick it up.
                  </span>
                </>
              )}
            </h1>

            <p className="fd-workspace-copy">
              {tab === "send"
                ? "Choose files, pick a simple mode, and share the PIN while uploads continue."
                : "Claim one pickup session and stream ready files directly to your browser."}
            </p>
          </div>

          {/* SEND / RECEIVE SWITCH */}
          <div
            className="fd-mode-switch"
            data-testid="mode-toggle-group"
          >
            <button
              type="button"
              onClick={() => switchTab("send")}
              data-testid="send-tab-btn"
              className={
                tab === "send"
                  ? "is-active"
                  : ""
              }
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>

            <button
              type="button"
              onClick={() =>
                switchTab("receive")
              }
              data-testid="receive-tab-btn"
              className={
                tab === "receive"
                  ? "is-active"
                  : ""
              }
            >
              <Download className="w-3.5 h-3.5" />
              Receive
            </button>
          </div>
        </div>

        {/* CAPABILITIES */}
        <div
          className="fd-signal-row fd-fade-up"
          aria-label="FlashDroop capabilities"
        >
          <span>
            <Zap className="w-3.5 h-3.5" />
            Native streaming
          </span>

          <span>
            <Radio className="w-3.5 h-3.5" />
            PIN before upload finishes
          </span>

          <span>
            <Sparkles className="w-3.5 h-3.5" />
            Live receipts
          </span>
        </div>

        {/* WORKSPACE */}
        <section
          className="fd-app-card fd-fade-up mt-4"
          data-testid="main-card"
        >
          <div className="fd-app-card-topline">
            <span>
              {tab === "send"
                ? "CREATE FLASHDROOP"
                : "RECEIVER PORTAL"}
            </span>

            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full fd-pulse" />
              READY
            </span>
          </div>

          <div className="p-4 sm:p-5 lg:p-6">
            {tab === "send" ? (
              <SendFlow />
            ) : (
              <ReceiveFlow
                initialPin={pin}
              />
            )}
          </div>
        </section>

        {/* BOTTOM */}
        <div className="fd-workspace-bottom">
          <span>
            Temporary · pickup controlled · auto-burn · up to 700MB
          </span>

          <Link
            to="/"
            className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors"
          >
            Back to landing
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </main>
    </div>
  );
}