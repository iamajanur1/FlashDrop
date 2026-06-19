import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Download, FileIcon, CheckCircle2, RotateCcw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";
import { API, downloadUrl, formatSize, timeUntil } from "@/lib/flashdrop-api";
import { toast } from "sonner";

export default function ReceiveFlow({ initialPin = "" }) {
  const [pin, setPin] = useState(initialPin.replace(/\D/g, "").slice(0, 6));
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const fetchInfo = useCallback(async (value) => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`${API}/file/${value}`);
      setInfo(res.data);
    } catch (err) {
      const msg = err?.response?.data?.detail || "File not found";
      setError(typeof msg === "string" ? msg : "File not found");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialPin && initialPin.length === 6) {
      void fetchInfo(initialPin);
    }
  }, [initialPin, fetchInfo]);

  const handlePinChange = (value) => {
    setPin(value);
    setError("");
    setInfo(null);
    setDone(false);
    if (value.length === 6) {
      void fetchInfo(value);
    }
  };

  const handleDownload = async () => {
    if (!info) return;
    setDownloading(true);
    setProgress(0);
    try {
      const res = await axios.get(downloadUrl(pin), {
        responseType: "blob",
        onDownloadProgress: (e) => {
          const total = e.total || info.size;
          const loaded = e.loaded || 0;
          setProgress(total ? Math.round((loaded / total) * 100) : 0);
        },
      });
      const blob = new Blob([res.data], { type: info.content_type });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = info.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setDone(true);
      toast.success("Download complete");
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || "Download failed";
      toast.error(typeof msg === "string" ? msg : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const reset = () => {
    setPin("");
    setInfo(null);
    setDone(false);
    setProgress(0);
    setError("");
  };

  if (done) {
    return (
      <div className="fd-fade-up text-center py-4 space-y-6" data-testid="download-success">
        <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" strokeWidth={2} />
        </div>
        <div>
          <h2 className="font-display font-semibold text-2xl text-gray-900">Downloaded successfully</h2>
          <p className="mt-2 text-sm text-gray-500">
            {info?.filename} · {formatSize(info?.size)}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {new Date().toLocaleString()} · {navigator.userAgent.includes("Mobile") ? "Mobile" : "Desktop"}
          </p>
        </div>
        <Button
          onClick={reset}
          data-testid="receive-another-btn"
          className="h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-6"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Receive another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="receive-flow">
      {/* PIN input */}
      <div className="flex flex-col items-center">
        <label className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-4">
          Enter 6-digit PIN
        </label>
        <InputOTP
          maxLength={6}
          value={pin}
          onChange={handlePinChange}
          disabled={loading || downloading}
          data-testid="pin-input-field"
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} className="w-11 h-14 sm:w-12 sm:h-16 text-2xl font-mono-pin font-bold" />
            <InputOTPSlot index={1} className="w-11 h-14 sm:w-12 sm:h-16 text-2xl font-mono-pin font-bold" />
            <InputOTPSlot index={2} className="w-11 h-14 sm:w-12 sm:h-16 text-2xl font-mono-pin font-bold" />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} className="w-11 h-14 sm:w-12 sm:h-16 text-2xl font-mono-pin font-bold" />
            <InputOTPSlot index={4} className="w-11 h-14 sm:w-12 sm:h-16 text-2xl font-mono-pin font-bold" />
            <InputOTPSlot index={5} className="w-11 h-14 sm:w-12 sm:h-16 text-2xl font-mono-pin font-bold" />
          </InputOTPGroup>
        </InputOTP>
        {loading && <p className="mt-4 text-sm text-gray-500 fd-pulse">Looking up…</p>}
        {error && (
          <div
            className="mt-4 flex items-center gap-2 text-sm text-red-600"
            data-testid="receive-error"
          >
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
      </div>

      {/* File info */}
      {info && (
        <div className="fd-fade-up space-y-5">
          <div
            className="border border-gray-200 rounded-2xl p-5 flex items-center gap-4 bg-gray-50/50"
            data-testid="received-file-card"
          >
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <FileIcon className="w-5 h-5 text-indigo-600" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate" data-testid="received-file-name">
                {info.filename}
              </p>
              <p className="text-sm text-gray-500">{formatSize(info.size)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 mb-0.5">Expires in</p>
              <p className="font-mono-pin font-semibold text-gray-900 text-sm">
                {timeUntil(info.expiry_at)}
              </p>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 mb-0.5">Downloads left</p>
              <p className="font-mono-pin font-semibold text-gray-900 text-sm">
                {info.remaining_downloads}
              </p>
            </div>
          </div>

          {downloading && (
            <div className="space-y-2" data-testid="download-progress">
              <div className="flex justify-between text-sm">
                <span className="text-gray-700 font-medium">Downloading…</span>
                <span className="text-gray-500 font-mono-pin">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <Button
            onClick={handleDownload}
            disabled={downloading}
            data-testid="download-file-btn"
            className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
          >
            <Download className="w-4 h-4 mr-2" />
            {downloading ? "Downloading…" : "Download file"}
          </Button>
        </div>
      )}
    </div>
  );
}
