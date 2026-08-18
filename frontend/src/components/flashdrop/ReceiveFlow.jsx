import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  FileIcon,
  Files,
  RotateCcw,
  AlertCircle,
  UserCheck,
  Zap,
  LockKeyhole,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  Radio,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";
import {
  createClaim,
  downloadAllUrl,
  downloadSingleUrl,
  formatSize,
  getBundleInfo,
  getClaimStatus,
  liveDropStreamUrl,
  startNativeDownload,
  timeUntil,
} from "@/lib/flashdrop-api";
import { toast } from "sonner";

const ACCESS_COPY = {
  instant: {
    icon: Zap,
    title: "Instant pickup",
    body: "Claim one pickup pass and download the entire drop.",
    button: "Claim pickup",
  },
  confirm: {
    icon: UserCheck,
    title: "Sender confirmation",
    body: "The sender must approve this device before downloads unlock.",
    button: "Request pickup",
  },
  one_device: {
    icon: LockKeyhole,
    title: "One-device lock",
    body: "The first approved pickup owns this drop.",
    button: "Claim this device",
  },
};

function sessionKey(pin) {
  return `flashdrop:claim:${pin}`;
}

export default function ReceiveFlow({ initialPin = "" }) {
  const [pin, setPin] = useState(initialPin.replace(/\D/g, "").slice(0, 6));
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claim, setClaim] = useState(null);
  const [error, setError] = useState("");
  const [downloadNote, setDownloadNote] = useState("");
  const [liveUploadConnected, setLiveUploadConnected] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const restoreClaim = useCallback((value) => {
    try {
      const raw = window.sessionStorage.getItem(sessionKey(value));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.claim_id || !parsed?.claim_token) return null;
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const fetchInfo = useCallback(async (value) => {
    setLoading(true);
    setError("");
    setDownloadNote("");
    try {
      const data = await getBundleInfo(value);
      setInfo(data);
      const restored = restoreClaim(value);
      if (restored) setClaim(restored);
    } catch (err) {
      const message = err?.response?.data?.detail || "Drop not found";
      setError(typeof message === "string" ? message : "Drop not found");
      setInfo(null);
      setClaim(null);
    } finally {
      setLoading(false);
    }
  }, [restoreClaim]);

  useEffect(() => {
    if (initialPin && initialPin.length === 6) void fetchInfo(initialPin);
  }, [initialPin, fetchInfo]);

  useEffect(() => {
    if (!info || !pin || info.upload_complete) return undefined;
    const source = new EventSource(liveDropStreamUrl(pin));

    const updateFile = (type, data) => {
      setInfo((current) => {
        if (!current) return current;
        const files = current.files.map((file) => {
          if (file.file_id !== data.file_id) return file;
          if (type === "file_upload_started") return { ...file, status: "uploading", uploaded_bytes: 0, upload_error: null };
          if (type === "file_upload_progress") return { ...file, status: "uploading", uploaded_bytes: data.uploaded_bytes ?? file.uploaded_bytes };
          if (type === "file_ready") return { ...file, status: "ready", uploaded_bytes: file.size, upload_error: null };
          return { ...file, status: "failed", uploaded_bytes: 0, upload_error: data.error || "Upload interrupted" };
        });
        const readyCount = files.filter((file) => file.status === "ready").length;
        const uploadedBytes = files.reduce((sum, file) => sum + Math.min(file.uploaded_bytes || 0, file.size || 0), 0);
        const complete = files.length > 0 && readyCount === files.length;
        return {
          ...current,
          files,
          ready_file_count: readyCount,
          uploaded_bytes: uploadedBytes,
          upload_complete: complete,
          upload_state: complete ? "ready" : "uploading",
        };
      });
    };

    source.addEventListener("snapshot", (message) => {
      try {
        setInfo(JSON.parse(message.data));
        setLiveUploadConnected(true);
      } catch {
        // Ignore malformed frames.
      }
    });
    ["file_upload_started", "file_upload_progress", "file_ready", "file_upload_failed"].forEach((type) => {
      source.addEventListener(type, (message) => {
        try {
          updateFile(type, JSON.parse(message.data));
          setLiveUploadConnected(true);
        } catch {
          // Ignore malformed frames.
        }
      });
    });
    source.addEventListener("upload_completed", () => {
      setInfo((current) => current ? {
        ...current,
        upload_state: "ready",
        upload_complete: true,
        ready_file_count: current.file_count,
        uploaded_bytes: current.total_size,
        files: current.files.map((file) => ({ ...file, status: "ready", uploaded_bytes: file.size, upload_error: null })),
      } : current);
      toast.success("All files are ready");
    });
    ["drop_burned", "drop_expired"].forEach((type) => {
      source.addEventListener(type, () => {
        setError(type === "drop_expired" ? "Drop expired" : "Drop was burned");
        source.close();
      });
    });
    source.onopen = () => setLiveUploadConnected(true);
    source.onerror = () => setLiveUploadConnected(false);
    return () => source.close();
  }, [info?.upload_complete, pin]);

  useEffect(() => {
    if (!claim || claim.status !== "pending" || !pin) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const status = await getClaimStatus(pin, claim.claim_id, claim.claim_token);
        if (stopped) return;
        const next = { ...claim, ...status };
        setClaim(next);
        window.sessionStorage.setItem(sessionKey(pin), JSON.stringify(next));
        if (status.status === "approved") toast.success("Sender approved this pickup");
        if (status.status === "rejected") toast.error("Sender rejected this pickup");
        if (status.status === "burned") toast.error("This drop was burned");
      } catch (err) {
        if (!stopped && [404, 410].includes(err?.response?.status)) {
          setError(err?.response?.data?.detail || "Drop is no longer available");
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1300);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [claim?.claim_id, claim?.claim_token, claim?.status, pin]);

  const handlePinChange = (value) => {
    setPin(value);
    setError("");
    setInfo(null);
    setClaim(null);
    setDownloadNote("");
    setLiveUploadConnected(false);
    if (value.length === 6) void fetchInfo(value);
  };

  const handleClaim = async () => {
    if (!info || claiming) return;
    setClaiming(true);
    setError("");
    try {
      const next = await createClaim(pin);
      setClaim(next);
      window.sessionStorage.setItem(sessionKey(pin), JSON.stringify(next));
      if (next.status === "approved") toast.success("Pickup ready");
      else toast.info("Waiting for sender approval");
    } catch (err) {
      const message = err?.response?.data?.detail || "Could not claim this drop";
      setError(typeof message === "string" ? message : "Could not claim this drop");
    } finally {
      setClaiming(false);
    }
  };

  const launchDownload = (url, label) => {
    if (!claim?.claim_token || claim.status !== "approved" && claim.status !== "completed") {
      toast.error("This pickup is not approved yet");
      return;
    }
    startNativeDownload(url);
    setDownloadNote(`${label} opened in your browser download manager. The sender receives live completion status from the server.`);
    toast.success("Download started");
  };

  const reset = () => {
    if (pin) window.sessionStorage.removeItem(sessionKey(pin));
    setPin("");
    setInfo(null);
    setClaim(null);
    setError("");
    setDownloadNote("");
    setLiveUploadConnected(false);
  };

  const access = ACCESS_COPY[info?.access_mode] || ACCESS_COPY.instant;
  const AccessIcon = access.icon;
  const ready = claim?.status === "approved" || claim?.status === "completed";
  const isMulti = (info?.file_count || 0) > 1;
  const readyFiles = info?.files?.filter((file) => file.status === "ready") || [];
  const allReady = Boolean(info?.upload_complete || (info?.files?.length && readyFiles.length === info.files.length));
  const uploadPercent = info?.total_size ? Math.min(100, Math.round(((info.uploaded_bytes || 0) / info.total_size) * 100)) : 100;
  const remaining = useMemo(() => (info ? timeUntil(info.expiry_at) : ""), [info?.expiry_at, now]);

  return (
    <div className="space-y-8" data-testid="receive-flow">
      <div className="flex flex-col items-center">
        <label className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-4">Enter 6-digit PIN</label>
        <InputOTP
          maxLength={6}
          value={pin}
          onChange={handlePinChange}
          disabled={loading}
          data-testid="pin-input-field"
        >
          <InputOTPGroup>
            {[0, 1, 2].map((index) => (
              <InputOTPSlot key={index} index={index} className="w-11 h-14 sm:w-12 sm:h-16 text-2xl font-mono-pin font-bold" />
            ))}
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            {[3, 4, 5].map((index) => (
              <InputOTPSlot key={index} index={index} className="w-11 h-14 sm:w-12 sm:h-16 text-2xl font-mono-pin font-bold" />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {loading && <p className="mt-4 text-sm text-gray-500 fd-pulse">Looking up drop…</p>}
        {error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-red-600" data-testid="receive-error">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
      </div>

      {info && (
        <div className="fd-fade-up space-y-5">
          <div className="border border-gray-200 rounded-2xl p-5 flex items-center gap-4 bg-gray-50/50" data-testid="received-bundle-card">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
              {isMulti ? <Files className="w-5 h-5 text-indigo-600" /> : <FileIcon className="w-5 h-5 text-indigo-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate" data-testid="received-bundle-title">
                {isMulti ? `${info.file_count} files` : info.files?.[0]?.filename}
              </p>
              <p className="text-sm text-gray-500">
                {formatSize(info.total_size)} · {allReady ? "all files ready" : `${readyFiles.length}/${info.file_count} ready`} · expires in {remaining}
              </p>
            </div>
            <span className="text-[10px] font-mono-pin uppercase tracking-wider text-indigo-700 bg-indigo-100 px-2 py-1 rounded-md">
              {info.remaining_pickups} pickup{info.remaining_pickups === 1 ? "" : "s"} left
            </span>
          </div>

          {!allReady && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4" data-testid="receiver-live-upload">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex w-8 h-8 items-center justify-center rounded-xl bg-white border border-indigo-100">
                    <Radio className={`w-4 h-4 ${liveUploadConnected ? "text-emerald-500" : "text-indigo-500"}`} />
                    {liveUploadConnected && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500 fd-pulse" />}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-indigo-950">Sender is still uploading</p>
                    <p className="text-[11px] text-indigo-700">Stay here — files unlock individually as they become ready.</p>
                  </div>
                </div>
                <span className="text-xs font-mono-pin font-semibold text-indigo-700">{uploadPercent}%</span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white overflow-hidden border border-indigo-100">
                <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${uploadPercent}%` }} />
              </div>
            </div>
          )}

          {(isMulti || !allReady) && (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1" data-testid="received-files-list">
              {info.files.map((file) => {
                const fileReady = file.status === "ready";
                const percent = file.size ? Math.min(100, Math.round(((file.uploaded_bytes || 0) / file.size) * 100)) : 100;
                return (
                  <div key={file.file_id} className={`border rounded-xl p-3 ${fileReady ? "border-emerald-100 bg-emerald-50/30" : file.status === "failed" ? "border-orange-100 bg-orange-50/30" : "border-gray-100 bg-white"}`}>
                    <div className="flex items-center gap-3">
                      {file.status === "uploading" ? <UploadCloud className="w-4 h-4 text-indigo-500 flex-shrink-0" /> : fileReady ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" /> : <FileIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 truncate">{file.filename}</p>
                        <p className="text-xs text-gray-500">
                          {fileReady ? `${formatSize(file.size)} · Ready` : file.status === "failed" ? "Sender needs to retry this file" : file.status === "uploading" ? `${formatSize(file.uploaded_bytes || 0)} / ${formatSize(file.size)}` : "Waiting to upload"}
                        </p>
                      </div>
                      {ready && fileReady ? (
                        <button
                          onClick={() => launchDownload(downloadSingleUrl(pin, file.file_id, claim.claim_token), file.filename)}
                          className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-1"
                          data-testid={`download-single-btn-${file.file_id}`}
                        >
                          <Download className="w-3 h-3" /> Get
                        </button>
                      ) : (
                        <span className={`text-[10px] font-mono-pin uppercase ${fileReady ? "text-emerald-600" : file.status === "failed" ? "text-orange-600" : "text-indigo-600"}`}>
                          {file.status === "uploading" ? `${percent}%` : file.status}
                        </span>
                      )}
                    </div>
                    {file.status === "uploading" && (
                      <div className="mt-2 h-1.5 rounded-full bg-indigo-50 overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!claim && info.remaining_pickups > 0 && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white border border-indigo-100 flex items-center justify-center flex-shrink-0">
                  <AccessIcon className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{access.title}</h3>
                  <p className="mt-1 text-sm text-gray-600 leading-relaxed">{access.body}</p>
                </div>
              </div>
              <Button
                onClick={handleClaim}
                disabled={claiming}
                className="mt-4 w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                data-testid="claim-drop-btn"
              >
                {claiming ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Claiming…</> : access.button}
              </Button>
            </div>
          )}

          {!claim && info.remaining_pickups === 0 && (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-center" data-testid="no-pickups-left">
              <AlertCircle className="w-7 h-7 text-orange-600 mx-auto" />
              <h3 className="mt-3 font-semibold text-orange-950">No pickup passes left</h3>
              <p className="mt-1 text-sm text-orange-800">All available receiver sessions have already been claimed.</p>
            </div>
          )}

          {claim?.status === "pending" && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center" data-testid="claim-pending">
              <Loader2 className="w-7 h-7 text-amber-600 animate-spin mx-auto" />
              <h3 className="mt-3 font-semibold text-amber-950">Waiting for sender approval</h3>
              <p className="mt-1 text-sm text-amber-800">Keep this page open. Access unlocks automatically when the sender approves this device.</p>
            </div>
          )}

          {claim?.status === "rejected" && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center" data-testid="claim-rejected">
              <AlertCircle className="w-7 h-7 text-red-600 mx-auto" />
              <h3 className="mt-3 font-semibold text-red-950">Pickup rejected</h3>
              <p className="mt-1 text-sm text-red-700">The sender did not approve this device.</p>
            </div>
          )}

          {ready && (
            <>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Pickup approved</p>
                  <p className="text-xs text-emerald-700">Downloads stream directly to your browser instead of buffering the whole file in page memory.</p>
                </div>
              </div>

              <Button
                onClick={() => launchDownload(downloadAllUrl(pin, claim.claim_token), isMulti ? "ZIP download" : info.files?.[0]?.filename || "Download")}
                disabled={!allReady}
                className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50"
                data-testid="download-all-btn"
              >
                {allReady ? <Download className="w-4 h-4 mr-2" /> : <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {allReady
                  ? (isMulti ? `Stream all as ZIP · ${formatSize(info.total_size)}` : `Download · ${formatSize(info.total_size)}`)
                  : `Waiting for ${info.file_count - readyFiles.length} file${info.file_count - readyFiles.length === 1 ? "" : "s"}`}
              </Button>

              {downloadNote && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 leading-relaxed" data-testid="download-note">
                  {downloadNote}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3 text-center text-xs">
            <div className="rounded-xl bg-gray-50 p-3">
              <ShieldCheck className="w-4 h-4 text-gray-400 mx-auto mb-1" />
              <span className="text-gray-500">Access</span>
              <p className="mt-0.5 font-semibold text-gray-900 capitalize">{info.access_mode.replace("_", " ")}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <RotateCcw className="w-4 h-4 text-gray-400 mx-auto mb-1" />
              <button onClick={reset} className="font-semibold text-indigo-600 hover:text-indigo-700">Use another PIN</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
