import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileIcon,
  Files,
  Flame,
  Link2,
  QrCode,
  Radio,
  RefreshCw,
  RotateCcw,
  Share2,
  UploadCloud,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  approveClaim,
  burnDrop,
  eventsStreamUrl,
  formatSize,
  getManageStatus,
  rejectClaim,
  timeUntil,
} from "@/lib/flashdrop-api";
import { toast } from "sonner";

const EVENT_TYPES = [
  "file_upload_started", "file_upload_progress", "file_ready", "file_upload_failed", "upload_completed",
  "claim_requested", "claim_approved", "claim_rejected", "download_started", "download_progress",
  "download_completed", "download_aborted", "download_failed", "pickup_completed", "drop_burned", "drop_expired",
];

const ACCESS_LABEL = { instant: "Instant", confirm: "Confirm", one_device: "One device" };
const BURN_LABEL = { expiry: "On expiry", after_first_pickup: "First pickup", after_all_pickups: "All pickups" };

function eventTitle(event) {
  switch (event.type) {
    case "file_upload_started": return `${event.filename || "File"} started`;
    case "file_upload_progress": return `${event.filename || "File"} · ${event.percent ?? "…"}%`;
    case "file_ready": return `${event.filename || "File"} ready`;
    case "file_upload_failed": return `${event.filename || "File"} needs retry`;
    case "upload_completed": return "All files ready";
    case "claim_requested": return `${event.device || "Receiver"} wants to pick up`;
    case "claim_approved": return `${event.device || "Receiver"} approved`;
    case "claim_rejected": return `${event.device || "Receiver"} rejected`;
    case "download_started": return event.kind === "zip" ? "ZIP download started" : `${event.filename || "File"} download started`;
    case "download_progress": return `Delivering · ${event.percent ?? "…"}%`;
    case "download_completed": return "Download completed";
    case "download_aborted": return "Download interrupted";
    case "download_failed": return "Download failed";
    case "pickup_completed": return `${event.device || "Receiver"} completed pickup`;
    case "drop_burned": return "Drop burned";
    case "drop_expired": return "Drop expired";
    default: return event.type?.replaceAll("_", " ") || "Activity";
  }
}

function eventKind(event) {
  if (["download_completed", "pickup_completed", "claim_approved", "file_ready", "upload_completed"].includes(event.type)) return "ok";
  if (["download_failed", "download_aborted", "claim_rejected", "drop_burned", "drop_expired", "file_upload_failed"].includes(event.type)) return "warn";
  return "live";
}

export default function PinResult({ result, uploadRuntime = {}, onRetryFile, onResumeFiles, onStopUploads, onReset }) {
  const [copied, setCopied] = useState("");
  const [live, setLive] = useState(false);
  const [events, setEvents] = useState([]);
  const [activeView, setActiveView] = useState("share");
  const [qrOpen, setQrOpen] = useState(true);
  const [manage, setManage] = useState({
    max_pickups: result.max_pickups,
    pickup_count: 0,
    completed_pickups: 0,
    remaining_pickups: result.remaining_pickups,
    files: result.files || [],
    upload_state: result.upload_state || "ready",
    claims: [],
  });
  const [busyClaim, setBusyClaim] = useState(null);
  const [burning, setBurning] = useState(false);
  const [burned, setBurned] = useState(false);
  const [now, setNow] = useState(Date.now());
  const resumeInputRef = useRef(null);

  const shareUrl = `${window.location.origin}/app/receive?pin=${result.pin}`;
  const fileCount = result.file_count ?? result.files?.length ?? 1;
  const summary = fileCount === 1 ? result.files?.[0]?.filename : `${fileCount} files`;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshManage = useCallback(async () => {
    if (!result.manage_token || burned) return;
    try {
      setManage(await getManageStatus(result.pin, result.manage_token));
    } catch (error) {
      if ([404, 410].includes(error?.response?.status)) setBurned(true);
    }
  }, [result.pin, result.manage_token, burned]);

  useEffect(() => { void refreshManage(); }, [refreshManage]);

  useEffect(() => {
    if (!result.manage_token || burned) return undefined;
    const source = new EventSource(eventsStreamUrl(result.pin, result.manage_token));
    const seen = new Set();
    source.addEventListener("ready", () => setLive(true));
    EVENT_TYPES.forEach((type) => {
      source.addEventListener(type, (message) => {
        try {
          const data = JSON.parse(message.data);
          const key = data.event_id || `${type}-${data.created_at}-${data.claim_id || data.download_id || data.file_id || ""}`;
          if (seen.has(key)) return;
          seen.add(key);
          setEvents((current) => [{ ...data, type, _key: key }, ...current].slice(0, 50));
          if (["claim_requested", "claim_approved", "claim_rejected", "pickup_completed", "file_ready", "file_upload_failed", "upload_completed"].includes(type)) void refreshManage();
          if (type === "claim_requested" && result.access_mode === "confirm") {
            setActiveView("share");
            toast.info("Receiver waiting for approval");
          }
          if (type === "upload_completed") toast.success("All files are ready");
          if (type === "pickup_completed") toast.success("Pickup completed");
          if (["drop_burned", "drop_expired"].includes(type)) setBurned(true);
        } catch { /* next SSE event continues */ }
      });
    });
    source.onerror = () => setLive(false);
    return () => source.close();
  }, [result.pin, result.manage_token, result.access_mode, refreshManage, burned]);

  const pendingClaims = useMemo(() => (manage.claims || []).filter((claim) => claim.status === "pending"), [manage.claims]);

  const liveFiles = useMemo(() => {
    const serverFiles = manage.files?.length ? manage.files : result.files || [];
    return serverFiles.map((file) => {
      const runtime = uploadRuntime[file.file_id];
      if (!runtime || file.status === "ready") return file.status === "ready" ? { ...file, uploaded_bytes: file.size } : file;
      return { ...file, status: runtime.status || file.status, uploaded_bytes: runtime.loaded ?? file.uploaded_bytes ?? 0, upload_error: runtime.error || file.upload_error };
    }).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }, [manage.files, result.files, uploadRuntime]);

  const readyFileCount = liveFiles.filter((file) => file.status === "ready").length;
  const uploadedBytes = liveFiles.reduce((sum, file) => sum + Math.min(file.uploaded_bytes || 0, file.size || 0), 0);
  const uploadPercent = result.total_size ? Math.min(100, Math.round((uploadedBytes / result.total_size) * 100)) : 100;
  const uploadComplete = liveFiles.length > 0 && readyFileCount === liveFiles.length;
  const unfinishedFiles = liveFiles.filter((file) => ["queued", "failed"].includes(file.status));
  const remaining = useMemo(() => timeUntil(result.expiry_at), [result.expiry_at, now]);

  const copy = async (kind, value) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    toast.success(kind === "pin" ? "PIN copied" : "Link copied");
    window.setTimeout(() => setCopied(""), 1400);
  };

  const decideClaim = async (claimId, decision) => {
    setBusyClaim(claimId);
    try {
      if (decision === "approve") await approveClaim(result.pin, claimId, result.manage_token);
      else await rejectClaim(result.pin, claimId, result.manage_token);
      toast.success(decision === "approve" ? "Receiver approved" : "Receiver rejected");
      await refreshManage();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update pickup");
    } finally { setBusyClaim(null); }
  };

  const handleBurn = async () => {
    if (!window.confirm("Burn this drop now? Files will be deleted immediately.")) return;
    setBurning(true);
    onStopUploads?.();
    try {
      await burnDrop(result.pin, result.manage_token);
      setBurned(true);
      toast.success("Drop burned");
    } catch (error) { toast.error(error?.response?.data?.detail || "Could not burn drop"); }
    finally { setBurning(false); }
  };

  if (burned) {
    return (
      <div className="fd-command-empty" data-testid="drop-burned-state">
        <div className="fd-command-empty-icon burn"><Flame /></div>
        <h2>Drop burned</h2>
        <p>The PIN is closed and the files are no longer available.</p>
        <button type="button" className="fd-command-primary compact" onClick={onReset}><RotateCcw /> New drop</button>
      </div>
    );
  }

  return (
    <div className="fd-command" data-testid="pin-result">
      <div className="fd-command-hero">
        <div className="fd-command-file">
          <span className="fd-command-file-icon">{fileCount > 1 ? <Files /> : <FileIcon />}</span>
          <span className="min-w-0"><b>{summary}</b><small>{formatSize(result.total_size)} · {readyFileCount}/{fileCount} ready</small></span>
        </div>
        <div className={`fd-command-live ${live ? "is-live" : ""}`}><span /> {live ? "Live" : "Connecting"}</div>
      </div>

      <div className="fd-command-pin-zone">
        <div>
          <span className="fd-command-eyebrow">Share this PIN</span>
          <button type="button" className="fd-command-pin" onClick={() => copy("pin", result.pin)} data-testid="pin-display-text">
            {result.pin.slice(0, 3)} <span>{result.pin.slice(3)}</span>
          </button>
          <p>Receiver can join now — uploads keep running.</p>
        </div>
        <div className="fd-command-actions">
          <button type="button" className="fd-command-primary" onClick={() => copy("pin", result.pin)}>{copied === "pin" ? <Check /> : <Copy />} {copied === "pin" ? "Copied" : "Copy PIN"}</button>
          <button type="button" className="fd-command-icon-btn" onClick={() => setQrOpen((open) => !open)} aria-label="Show QR code"><QrCode /></button>
        </div>
      </div>

      {qrOpen && (
        <div className="fd-command-qr-pop">
          <div className="fd-command-qr"><QRCodeSVG value={shareUrl} size={112} level="M" fgColor="#17151d" bgColor="#ffffff" /></div>
          <div className="min-w-0"><b>Scan to pick up</b><p>{shareUrl}</p><button type="button" onClick={() => copy("link", shareUrl)}><Link2 /> {copied === "link" ? "Copied" : "Copy link"}</button></div>
        </div>
      )}

      {pendingClaims.length > 0 && result.access_mode === "confirm" && (
        <div className="fd-command-claim" data-testid="approval-panel">
          <div><span className="fd-command-claim-icon"><UserCheck /></span><span><b>{pendingClaims[0].device || "Receiver"} wants this drop</b><small>{pendingClaims[0].browser || "Browser"} · waiting for approval</small></span></div>
          <div><button type="button" className="reject" disabled={busyClaim === pendingClaims[0].claim_id} onClick={() => decideClaim(pendingClaims[0].claim_id, "reject")}><X /></button><button type="button" className="approve" disabled={busyClaim === pendingClaims[0].claim_id} onClick={() => decideClaim(pendingClaims[0].claim_id, "approve")}>Approve</button></div>
        </div>
      )}

      <div className="fd-command-meter">
        <div className="fd-command-meter-top"><span>{uploadComplete ? <CheckCircle2 /> : <UploadCloud />}<b>{uploadComplete ? "Ready to share" : "Uploading in background"}</b></span><strong>{uploadPercent}%</strong></div>
        <div className="fd-command-track"><i style={{ width: `${uploadPercent}%` }} /></div>
        <div className="fd-command-meter-foot"><span>{readyFileCount} of {fileCount} files ready</span><span>{formatSize(uploadedBytes)} / {formatSize(result.total_size)}</span></div>
      </div>

      <div className="fd-command-stats">
        <span><Clock /><b>{remaining}</b><small>left</small></span>
        <span><Users /><b>{manage.remaining_pickups ?? result.remaining_pickups}</b><small>pickups</small></span>
        <span><UserCheck /><b>{ACCESS_LABEL[result.access_mode]}</b><small>access</small></span>
        <span><Flame /><b>{BURN_LABEL[result.burn_rule]}</b><small>burn</small></span>
      </div>

      <div className="fd-command-tabs" role="tablist">
        <button type="button" className={activeView === "share" ? "is-active" : ""} onClick={() => setActiveView("share")}><Share2 /> Share</button>
        <button type="button" className={activeView === "files" ? "is-active" : ""} onClick={() => setActiveView("files")}><UploadCloud /> Files <em>{readyFileCount}/{fileCount}</em></button>
        <button type="button" className={activeView === "activity" ? "is-active" : ""} onClick={() => setActiveView("activity")}><Activity /> Activity {events.length > 0 && <em>{events.length}</em>}</button>
      </div>

      <div className="fd-command-panel">
        {activeView === "share" && (
          <div className="fd-command-share-panel">
            <div><b>Receiver link</b><p>{shareUrl}</p></div>
            <button type="button" onClick={() => copy("link", shareUrl)}>{copied === "link" ? <Check /> : <Copy />} {copied === "link" ? "Copied" : "Copy link"}</button>
          </div>
        )}

        {activeView === "files" && (
          <div className="fd-command-file-list">
            {liveFiles.map((file) => {
              const percent = file.size ? Math.min(100, Math.round(((file.uploaded_bytes || 0) / file.size) * 100)) : 100;
              const failed = file.status === "failed";
              return (
                <div className="fd-command-file-row" key={file.file_id}>
                  <span className={`state ${file.status}`}><FileIcon /></span>
                  <span className="min-w-0"><b>{file.filename}</b><small>{file.status === "ready" ? `${formatSize(file.size)} · ready` : failed ? (file.upload_error || "Upload interrupted") : `${percent}% · ${formatSize(file.uploaded_bytes || 0)} / ${formatSize(file.size)}`}</small></span>
                  {file.status === "uploading" && <div className="mini-track"><i style={{ width: `${percent}%` }} /></div>}
                  {failed && onRetryFile && <button type="button" className="retry" onClick={() => onRetryFile(file.file_id)}><RefreshCw /></button>}
                  {file.status === "ready" && <CheckCircle2 className="ready-check" />}
                </div>
              );
            })}
            {!uploadComplete && unfinishedFiles.length > 0 && onResumeFiles && <>
              <input ref={resumeInputRef} type="file" multiple className="hidden" onChange={(event) => { void onResumeFiles(event.target.files, unfinishedFiles); event.target.value = ""; }} />
              <button type="button" className="fd-command-resume" onClick={() => resumeInputRef.current?.click()}><RefreshCw /> Reselect unfinished files</button>
            </>}
          </div>
        )}

        {activeView === "activity" && (
          <div className="fd-command-activity" data-testid="live-receipt-panel">
            {events.length === 0 ? <div className="fd-command-no-activity"><Radio /><b>Listening live</b><span>Receiver and transfer activity will appear here.</span></div> : events.map((event) => {
              const kind = eventKind(event);
              return <div className={`fd-command-event ${kind}`} key={event._key}><span>{kind === "ok" ? <CheckCircle2 /> : kind === "warn" ? <AlertTriangle /> : <Radio />}</span><div><b>{eventTitle(event)}</b><small>{new Date(event.created_at).toLocaleTimeString()}</small></div></div>;
            })}
          </div>
        )}
      </div>

      <div className="fd-command-footer">
        <button type="button" onClick={onReset}><RotateCcw /> New drop</button>
        <button type="button" className="burn" onClick={handleBurn} disabled={burning}><Flame /> {burning ? "Burning…" : "Burn now"}</button>
      </div>
    </div>
  );
}
