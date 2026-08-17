import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, RotateCcw, Clock, Download, FileIcon, Files, ShieldCheck, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSize, timeUntil, pingsStreamUrl } from "@/lib/flashdrop-api";
import { toast } from "sonner";

function formatAgo(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function PinResult({ result, onReset }) {
  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [, setTick] = useState(0);
  const [pings, setPings] = useState([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Live-pings SSE subscription
  useEffect(() => {
    if (!result?.pin) return undefined;
    const es = new EventSource(pingsStreamUrl(result.pin));
    es.addEventListener("ready", () => setLive(true));
    es.addEventListener("download", (e) => {
      try {
        const data = JSON.parse(e.data);
        setPings((prev) => [{ ...data, id: `${data.at}-${Math.random()}` }, ...prev].slice(0, 20));
        toast.success(`Someone downloaded · ${data.device || "Unknown device"}`);
      } catch (parseErr) {
        console.error("Bad ping payload", parseErr);
      }
    });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [result?.pin]);

  const keyFragment = result.encryptionKey ? `#k=${result.encryptionKey}` : "";
  const shareUrl = `${window.location.origin}/receive?pin=${result.pin}${keyFragment}`;
  const fileCount = result.file_count ?? result.files?.length ?? 1;
  const firstName = result.files?.[0]?.filename;
  const summary =
    fileCount === 1 ? firstName : `${fileCount} files`;

  const copyPin = async () => {
    await navigator.clipboard.writeText(result.pin);
    setCopiedPin(true);
    toast.success("PIN copied");
    setTimeout(() => setCopiedPin(false), 2000);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    toast.success(result.encrypted ? "Link copied (includes secret key)" : "Link copied");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const remaining = timeUntil(result.expiry_at);

  return (
    <div className="fd-fade-up space-y-8" data-testid="pin-result">
      {/* Bundle summary */}
      <div className="flex items-center gap-3 justify-center">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
          {fileCount > 1 ? (
            <Files className="w-4 h-4 text-indigo-600" />
          ) : (
            <FileIcon className="w-4 h-4 text-indigo-600" />
          )}
        </div>
        <div>
          <p
            className="font-medium text-gray-900 text-sm truncate max-w-[240px] sm:max-w-[360px]"
            data-testid="bundle-summary"
          >
            {summary}
          </p>
          <p className="text-xs text-gray-500">{formatSize(result.total_size)}</p>
        </div>
        {result.encrypted && (
          <span
            data-testid="e2ee-badge"
            className="inline-flex items-center gap-1 text-[10px] font-mono-pin uppercase tracking-wider text-indigo-700 bg-indigo-100 px-2 py-1 rounded-md"
          >
            <ShieldCheck className="w-3 h-3" strokeWidth={2.4} /> E2EE
          </span>
        )}
      </div>

      {/* PIN */}
      <div className="text-center">
        <p className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-3">
          Your PIN
        </p>
        <button
          onClick={copyPin}
          data-testid="pin-display-text"
          className="font-mono-pin font-bold text-5xl sm:text-7xl tracking-[0.15em] text-indigo-600 select-all hover:text-indigo-700 transition-colors duration-200 block mx-auto"
          title="Click to copy"
        >
          {result.pin}
        </button>
        <button
          onClick={copyPin}
          data-testid="copy-pin-btn"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-600 transition-colors"
        >
          {copiedPin ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          {copiedPin ? "Copied" : "Copy PIN"}
        </button>
      </div>

      {/* QR */}
      <div className="flex flex-col items-center" data-testid="qr-code-wrapper">
        <div className="p-4 bg-white border border-gray-200 rounded-2xl">
          <QRCodeSVG
            value={shareUrl}
            size={160}
            level="M"
            fgColor="#111827"
            bgColor="#ffffff"
          />
        </div>
        <p className="mt-3 text-xs text-gray-500">Scan to receive</p>
      </div>

      {/* Share link */}
      <div
        className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-xl"
        data-testid="share-link-row"
      >
        <code className="flex-1 text-sm text-gray-700 truncate font-mono-pin">{shareUrl}</code>
        <button
          onClick={copyLink}
          data-testid="copy-link-btn"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
        >
          {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiedLink ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="p-4 bg-gray-50 rounded-xl">
          <Clock className="w-4 h-4 text-gray-400 mx-auto mb-1.5" />
          <p className="text-xs text-gray-500 mb-0.5">Expires in</p>
          <p className="font-mono-pin font-semibold text-gray-900" data-testid="expiry-countdown">
            {remaining}
          </p>
        </div>
        <div className="p-4 bg-gray-50 rounded-xl">
          <Download className="w-4 h-4 text-gray-400 mx-auto mb-1.5" />
          <p className="text-xs text-gray-500 mb-0.5">Downloads left</p>
          <p className="font-mono-pin font-semibold text-gray-900">{result.max_downloads}</p>
        </div>
      </div>

      {/* Live pings */}
      <div
        className="rounded-2xl border border-gray-200 bg-white p-4"
        data-testid="live-pings-panel"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="relative flex items-center justify-center w-6 h-6">
              <Radio
                className={`w-4 h-4 ${live ? "text-emerald-500" : "text-gray-300"}`}
                strokeWidth={2}
              />
              {live && (
                <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-emerald-500 fd-pulse" />
              )}
            </span>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Live Pings
            </p>
          </div>
          <span
            className={`text-[10px] font-mono-pin uppercase tracking-wider px-1.5 py-0.5 rounded ${
              live ? "text-emerald-700 bg-emerald-50" : "text-gray-400 bg-gray-100"
            }`}
            data-testid="live-pings-status"
          >
            {live ? "Listening" : "Offline"}
          </span>
        </div>
        {pings.length === 0 ? (
          <p className="text-sm text-gray-400 py-2 text-center" data-testid="live-pings-empty">
            Waiting for downloads…
          </p>
        ) : (
          <ul className="space-y-2 max-h-48 overflow-y-auto pr-1" data-testid="live-pings-list">
            {pings.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 text-sm bg-emerald-50/50 border border-emerald-100 rounded-lg px-3 py-2"
                data-testid="live-ping-item"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" strokeWidth={2.4} />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 font-medium truncate">
                    {p.kind === "zip"
                      ? `Downloaded all as ZIP · ${p.file_count} files`
                      : `Downloaded ${p.filename}`}
                  </p>
                  <p className="text-[11px] text-gray-500 font-mono-pin">
                    {formatAgo(p.at)} · {p.device} · {p.browser}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button
        onClick={onReset}
        variant="outline"
        data-testid="send-another-btn"
        className="w-full h-11 rounded-xl border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
      >
        <RotateCcw className="w-4 h-4 mr-2" />
        Send another drop
      </Button>
    </div>
  );
}
