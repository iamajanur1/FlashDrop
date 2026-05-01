import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, RotateCcw, Clock, Download, FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSize, timeUntil } from "@/lib/flashdrop-api";
import { toast } from "sonner";

export default function PinResult({ result, onReset }) {
  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const shareUrl = `${window.location.origin}/receive?pin=${result.pin}`;

  const copyPin = async () => {
    await navigator.clipboard.writeText(result.pin);
    setCopiedPin(true);
    toast.success("PIN copied");
    setTimeout(() => setCopiedPin(false), 2000);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    toast.success("Link copied");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const remaining = timeUntil(result.expiry_at);

  return (
    <div className="fd-fade-up space-y-8" data-testid="pin-result">
      {/* File info */}
      <div className="flex items-center gap-3 justify-center">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
          <FileIcon className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <p className="font-medium text-gray-900 text-sm truncate max-w-[240px] sm:max-w-[360px]">
            {result.filename}
          </p>
          <p className="text-xs text-gray-500">{formatSize(result.size)}</p>
        </div>
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

      <Button
        onClick={onReset}
        variant="outline"
        data-testid="send-another-btn"
        className="w-full h-11 rounded-xl border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
      >
        <RotateCcw className="w-4 h-4 mr-2" />
        Send another file
      </Button>
    </div>
  );
}
