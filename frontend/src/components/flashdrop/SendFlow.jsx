import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  FileIcon,
  Flame,
  LockKeyhole,
  Plus,
  Radio,
  SlidersHorizontal,
  TimerReset,
  UploadCloud,
  UserCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  initLiveDrop,
  uploadLiveFile,
  formatSize,
  MAX_BUNDLE_SIZE,
  MAX_FILES_PER_BUNDLE,
} from "@/lib/flashdrop-api";
import { toast } from "sonner";
import PinResult from "./PinResult";

const EXPIRY_OPTIONS = [
  { value: 10, label: "10 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

const PICKUP_OPTIONS = [1, 3, 5, 10];
const LIVE_UPLOAD_CONCURRENCY = 2;

const ACCESS_OPTIONS = [
  {
    value: "instant",
    label: "Instant",
    description: "PIN holders can claim immediately.",
    icon: Zap,
  },
  {
    value: "confirm",
    label: "Confirm",
    description: "Approve each receiver first.",
    icon: UserCheck,
  },
  {
    value: "one_device",
    label: "One Device",
    description: "First approved device locks it.",
    icon: LockKeyhole,
  },
];

const BURN_OPTIONS = [
  {
    value: "expiry",
    label: "On expiry",
    description: "Keep it until the timer ends.",
  },
  {
    value: "after_first_pickup",
    label: "First pickup",
    description: "Burn after one complete pickup.",
  },
  {
    value: "after_all_pickups",
    label: "All pickups",
    description: "Burn after all passes complete.",
  },
];

const PRESETS = [
  {
    key: "quick",
    label: "Quick",
    hint: "Share instantly",
    icon: Zap,
    expiry: 30,
    maxPickups: 3,
    accessMode: "instant",
    burnRule: "expiry",
  },
  {
    key: "approve",
    label: "Approve",
    hint: "You control entry",
    icon: UserCheck,
    expiry: 30,
    maxPickups: 3,
    accessMode: "confirm",
    burnRule: "expiry",
  },
  {
    key: "one-time",
    label: "One-time",
    hint: "Burn after pickup",
    icon: Flame,
    expiry: 10,
    maxPickups: 1,
    accessMode: "one_device",
    burnRule: "after_first_pickup",
  },
];

function runtimeFor(slot, current = {}) {
  return {
    status: current.status || slot.status || "queued",
    loaded: current.loaded ?? slot.uploaded_bytes ?? 0,
    total: slot.size,
    error: current.error || slot.upload_error || "",
  };
}

export default function SendFlow() {
  const [files, setFiles] = useState([]);
  const [expiry, setExpiry] = useState(30);
  const [maxPickups, setMaxPickups] = useState(3);
  const [accessMode, setAccessMode] = useState("instant");
  const [burnRule, setBurnRule] = useState("expiry");
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uploadRuntime, setUploadRuntime] = useState({});
  const [result, setResult] = useState(() => {
    try {
      const saved = window.sessionStorage.getItem("flashdrop:active-sender");
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (!parsed?.manage_token || !parsed?.expiry_at || new Date(parsed.expiry_at).getTime() <= Date.now()) {
        window.sessionStorage.removeItem("flashdrop:active-sender");
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  const inputRef = useRef(null);
  const controllersRef = useRef(new Map());

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const effectivePickups = accessMode === "one_device" ? 1 : maxPickups;
  const currentPreset = PRESETS.find(
    (preset) =>
      preset.expiry === expiry &&
      preset.maxPickups === effectivePickups &&
      preset.accessMode === accessMode &&
      preset.burnRule === burnRule,
  )?.key;

  const expiryLabel = EXPIRY_OPTIONS.find((option) => option.value === expiry)?.label || `${expiry} min`;
  const accessLabel = ACCESS_OPTIONS.find((option) => option.value === accessMode)?.label || "Custom";
  const burnLabel = BURN_OPTIONS.find((option) => option.value === burnRule)?.label || "Custom";

  const setRuntime = (slot, patch) => {
    setUploadRuntime((current) => ({
      ...current,
      [slot.file_id]: { ...runtimeFor(slot, current[slot.file_id]), ...patch },
    }));
  };

  const addFiles = (incoming) => {
    if (!incoming?.length) return;
    const next = Array.from(incoming);
    const existing = new Set(files.map((file) => `${file.name}|${file.size}`));
    const filtered = next.filter((file) => !existing.has(`${file.name}|${file.size}`));

    if (filtered.length < next.length) toast.info("Skipped duplicate files");
    if (!filtered.length) return;

    const combined = [...files, ...filtered];
    if (combined.length > MAX_FILES_PER_BUNDLE) {
      toast.error(`Max ${MAX_FILES_PER_BUNDLE} files per drop`);
      return;
    }

    const nextSize = combined.reduce((sum, file) => sum + file.size, 0);
    if (nextSize > MAX_BUNDLE_SIZE) {
      toast.error(`Bundle exceeds 1.5GB total. Selected: ${formatSize(nextSize)}.`);
      return;
    }

    setFiles(combined);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const uploadPair = async (drop, slot, file) => {
    if (!drop?.upload_token || !slot || !file || controllersRef.current.has(slot.file_id)) return;
    const controller = new AbortController();
    controllersRef.current.set(slot.file_id, controller);
    setRuntime(slot, { status: "uploading", loaded: 0, error: "" });

    try {
      const response = await uploadLiveFile({
        pin: drop.pin,
        fileSlot: slot,
        uploadToken: drop.upload_token,
        file,
        signal: controller.signal,
        onProgress: ({ loaded }) => setRuntime(slot, { status: "uploading", loaded }),
      });
      setRuntime(slot, { status: "ready", loaded: slot.size, error: "" });
      return response;
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error?.response?.data?.detail || error.message || "Upload interrupted";
      setRuntime(slot, {
        status: "failed",
        loaded: 0,
        error: typeof message === "string" ? message : "Upload interrupted",
      });
    } finally {
      controllersRef.current.delete(slot.file_id);
    }
  };

  const runUploadPairs = async (drop, pairs) => {
    const queue = pairs.filter(({ slot, file }) => slot && file && slot.status !== "ready");
    if (!queue.length) return;
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const index = cursor;
        cursor += 1;
        const { slot, file } = queue[index];
        await uploadPair(drop, slot, file);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LIVE_UPLOAD_CONCURRENCY, queue.length) }, () => worker()));
  };

  const handleUpload = async () => {
    if (!files.length || creating) return;
    setCreating(true);

    try {
      const data = await initLiveDrop({
        files,
        expiryMinutes: expiry,
        maxPickups: effectivePickups,
        accessMode,
        burnRule,
      });

      const runtime = {};
      data.files.forEach((slot) => {
        runtime[slot.file_id] = runtimeFor(slot);
      });
      setUploadRuntime(runtime);
      setResult(data);
      window.sessionStorage.setItem("flashdrop:active-sender", JSON.stringify(data));
      toast.success("PIN is live — upload continues now");

      const source = [...files];
      void runUploadPairs(
        data,
        data.files.map((slot, index) => ({ slot, file: source[index] })),
      );
    } catch (error) {
      const message = error?.response?.data?.detail || error.message || "Could not create Live Drop";
      toast.error(typeof message === "string" ? message : "Could not create Live Drop");
    } finally {
      setCreating(false);
    }
  };

  const retryFile = async (fileId, replacementFile) => {
    if (!result) return;
    const slot = result.files.find((item) => item.file_id === fileId);
    if (!slot) return;
    const source = replacementFile || files[slot.position];
    if (!source) {
      toast.info("Reselect that file to resume the upload");
      return;
    }
    await runUploadPairs(result, [{ slot, file: source }]);
  };

  const resumeFiles = async (incoming, targetSlots) => {
    if (!result) return;
    const candidates = Array.from(incoming || []);
    const used = new Set();
    const pairs = [];

    for (const slot of targetSlots) {
      let index = candidates.findIndex((file, i) => !used.has(i) && file.size === slot.size && file.name === slot.filename);
      if (index < 0) index = candidates.findIndex((file, i) => !used.has(i) && file.size === slot.size);
      if (index >= 0) {
        used.add(index);
        pairs.push({ slot, file: candidates[index] });
      }
    }

    if (!pairs.length) {
      toast.error("No selected files matched the unfinished upload slots");
      return;
    }
    if (pairs.length < targetSlots.length) toast.info(`Matched ${pairs.length} of ${targetSlots.length} unfinished files`);
    await runUploadPairs(result, pairs);
  };

  const stopUploads = () => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  };

  const reset = () => {
    stopUploads();
    setFiles([]);
    setUploadRuntime({});
    setResult(null);
    window.sessionStorage.removeItem("flashdrop:active-sender");
  };

  const applyPreset = (preset) => {
    if (creating) return;
    setExpiry(preset.expiry);
    setMaxPickups(preset.maxPickups);
    setAccessMode(preset.accessMode);
    setBurnRule(preset.burnRule);
  };

  if (result) {
    return (
      <PinResult
        result={result}
        uploadRuntime={uploadRuntime}
        onRetryFile={retryFile}
        onResumeFiles={resumeFiles}
        onStopUploads={stopUploads}
        onReset={reset}
      />
    );
  }

  return (
    <div className="fd-send-flow" data-testid="send-flow">
      {files.length === 0 ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          data-testid="file-upload-dropzone"
          className={`fd-dropzone ${dragging ? "is-dragging" : ""}`}
        >
          <div className="fd-dropzone-icon">
            <UploadCloud className="w-6 h-6" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <p className="fd-dropzone-title">Drop files here</p>
            <p className="fd-dropzone-copy">or browse · up to 700MB · {MAX_FILES_PER_BUNDLE} files</p>
          </div>
          <div className="fd-live-pill">
            <Radio className="w-3.5 h-3.5" /> PIN appears first
          </div>
        </div>
      ) : (
        <div className="fd-file-stack" data-testid="selected-files-list">
          <div className="fd-file-stack-head">
            <div>
              <b>{files.length} {files.length === 1 ? "file" : "files"}</b>
              <span>{formatSize(totalSize)} selected</span>
            </div>
            {!creating && files.length < MAX_FILES_PER_BUNDLE && (
              <button type="button" onClick={() => inputRef.current?.click()} data-testid="add-more-files-btn">
                <Plus className="w-3.5 h-3.5" /> Add files
              </button>
            )}
          </div>
          <div className="fd-file-list">
            {files.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="fd-file-row" data-testid={`selected-file-item-${index}`}>
                <div className="fd-file-icon"><FileIcon className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{file.name}</p>
                  <span>{formatSize(file.size)}</span>
                </div>
                {!creating && (
                  <button
                    type="button"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    className="fd-file-remove"
                    data-testid={`remove-file-btn-${index}`}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="file-input"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="fd-setup-block">
        <div className="fd-setup-heading">
          <div>
            <span>Drop style</span>
            <b>Choose how this handoff behaves</b>
          </div>
          <span className="fd-setup-auto">You can tune it</span>
        </div>

        <div className="fd-preset-grid" data-testid="drop-presets">
          {PRESETS.map((preset) => {
            const Icon = preset.icon;
            const active = currentPreset === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                disabled={creating}
                onClick={() => applyPreset(preset)}
                className={`fd-preset-card ${active ? "is-active" : ""}`}
                data-testid={`preset-${preset.key}`}
              >
                <span className="fd-preset-icon"><Icon className="w-4 h-4" /></span>
                <span className="min-w-0 text-left">
                  <b>{preset.label}</b>
                  <small>{preset.hint}</small>
                </span>
                {active && <Check className="fd-preset-check w-4 h-4" />}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className={`fd-config-summary ${advancedOpen ? "is-open" : ""}`}
        onClick={() => setAdvancedOpen((open) => !open)}
        aria-expanded={advancedOpen}
        data-testid="advanced-controls-toggle"
      >
        <div className="fd-config-summary-title">
          <SlidersHorizontal className="w-4 h-4" />
          <span>{currentPreset ? "Current setup" : "Custom setup"}</span>
        </div>
        <div className="fd-config-pills">
          <span>{expiryLabel}</span>
          <span>{effectivePickups} {effectivePickups === 1 ? "pickup" : "pickups"}</span>
          <span>{accessLabel}</span>
          <span>{burnLabel}</span>
        </div>
        <div className="fd-config-edit">
          {advancedOpen ? "Done" : "Advanced"}
          <ChevronDown className="w-4 h-4" />
        </div>
      </button>

      <div className={`fd-advanced-wrap ${advancedOpen ? "is-open" : ""}`} aria-hidden={!advancedOpen}>
        <div className="fd-advanced-panel">
          <div className="fd-advanced-grid">
            <div className="fd-control-group">
              <label><TimerReset className="w-3.5 h-3.5" /> Expires</label>
              <div className="fd-segmented" data-testid="expiry-selector">
                {EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setExpiry(option.value)}
                    disabled={creating}
                    data-testid={`expiry-option-${option.value}`}
                    className={expiry === option.value ? "is-active" : ""}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="fd-control-group">
              <label><Users className="w-3.5 h-3.5" /> Pickup passes</label>
              <div className="fd-segmented" data-testid="pickup-limit-selector">
                {PICKUP_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMaxPickups(value)}
                    disabled={creating || accessMode === "one_device"}
                    data-testid={`pickup-option-${value}`}
                    className={effectivePickups === value ? "is-active" : ""}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="fd-control-group">
            <label>Access</label>
            <div className="fd-choice-grid" data-testid="access-mode-selector">
              {ACCESS_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = accessMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={creating}
                    onClick={() => setAccessMode(option.value)}
                    data-testid={`access-mode-${option.value}`}
                    className={active ? "is-active" : ""}
                  >
                    <Icon className="w-4 h-4" />
                    <span><b>{option.label}</b><small>{option.description}</small></span>
                    {active && <Check className="fd-choice-check w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="fd-control-group">
            <label><Flame className="w-3.5 h-3.5" /> Burn</label>
            <div className="fd-choice-grid" data-testid="burn-rule-selector">
              {BURN_OPTIONS.map((option) => {
                const active = burnRule === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={creating}
                    onClick={() => setBurnRule(option.value)}
                    data-testid={`burn-rule-${option.value}`}
                    className={active ? "is-active burn" : "burn"}
                  >
                    <span><b>{option.label}</b><small>{option.description}</small></span>
                    {active && <Check className="fd-choice-check w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="fd-create-bar">
        <div className="fd-create-note">
          <Radio className="w-4 h-4" />
          <span><b>Live Drop</b> · PIN is ready before file uploads finish.</span>
        </div>
        <Button
          onClick={handleUpload}
          disabled={!files.length || creating}
          data-testid="generate-pin-btn"
          className="fd-create-button"
        >
          {creating ? "Creating PIN…" : files.length > 1 ? `Create Drop · ${files.length} files` : "Create Drop"}
        </Button>
      </div>
    </div>
  );
}
