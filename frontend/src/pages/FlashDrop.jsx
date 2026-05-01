import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Zap } from "lucide-react";
import SendFlow from "@/components/flashdrop/SendFlow";
import ReceiveFlow from "@/components/flashdrop/ReceiveFlow";

export default function FlashDrop({ defaultTab = "send" }) {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(defaultTab);

  useEffect(() => {
    if (searchParams.get("pin")) setTab("receive");
  }, [searchParams]);

  return (
    <div className="fd-bg-orb min-h-screen bg-[#F9FAFB] flex flex-col items-center p-4 sm:p-8 relative">
      {/* Header */}
      <header className="relative z-10 w-full max-w-[720px] flex items-center justify-between py-4 sm:py-6 mb-4">
        <div className="flex items-center gap-2" data-testid="app-logo">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-[0_4px_12px_rgba(79,70,229,0.3)]">
            <Zap className="w-4 h-4 text-white" strokeWidth={2.5} fill="white" />
          </div>
          <span className="font-display font-bold text-lg text-gray-900">FlashDrop</span>
        </div>
        <span className="text-xs text-gray-500 font-medium tracking-wide uppercase hidden sm:block">
          Instant · Secure · Temporary
        </span>
      </header>

      {/* Main card */}
      <main className="relative z-10 w-full max-w-[720px] fd-fade-up">
        {/* Toggle */}
        <div
          className="flex bg-gray-100 p-1 rounded-xl w-full max-w-[280px] mx-auto mb-8"
          data-testid="mode-toggle-group"
        >
          <button
            onClick={() => setTab("send")}
            data-testid="send-tab-btn"
            className={`w-1/2 py-2.5 px-4 text-sm font-semibold rounded-lg transition-all duration-200 ${
              tab === "send"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Send
          </button>
          <button
            onClick={() => setTab("receive")}
            data-testid="receive-tab-btn"
            className={`w-1/2 py-2.5 px-4 text-sm font-semibold rounded-lg transition-all duration-200 ${
              tab === "receive"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Receive
          </button>
        </div>

        {/* Headline */}
        <div className="text-center mb-10 px-2">
          <h1
            className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-gray-900 leading-[1.05]"
            data-testid="hero-headline"
          >
            {tab === "send" ? "Send urgent files instantly." : "Got a PIN? Let's fetch it."}
          </h1>
          <p className="mt-4 text-base text-gray-500 leading-relaxed max-w-md mx-auto">
            {tab === "send"
              ? "No login. No friction. Secure and temporary."
              : "Enter the 6-digit code to download your file."}
          </p>
        </div>

        {/* Card */}
        <div
          className="bg-white rounded-2xl border border-gray-100 shadow-[0_8px_32px_rgba(79,70,229,0.08)] p-6 sm:p-10"
          data-testid="main-card"
        >
          {tab === "send" ? <SendFlow /> : <ReceiveFlow initialPin={searchParams.get("pin") || ""} />}
        </div>

        {/* Footer */}
        <footer className="mt-10 text-center text-xs text-gray-400 pb-6">
          <p>Files auto-delete after expiry or max downloads · Max 200MB</p>
        </footer>
      </main>
    </div>
  );
}
