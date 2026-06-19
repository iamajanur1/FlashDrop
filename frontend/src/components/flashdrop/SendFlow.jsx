import { useRef, useState } from "react";
import { UploadCloud, FileIcon, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFiles, formatSize, MAX_BUNDLE_SIZE, MAX_FILES_PER_BUNDLE } from "@/lib/flashdrop-api";
import { toast } from "sonner";
import PinResult from "./PinResult";

const EXPIRY_OPTIONS = [
  { value: 10, label: "10 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];
const LIMIT_OPTIONS = [1, 3, 5, 10];

export default function SendFlow() {
  const [files, setFiles] = useState([]);
  const [expiry, setExpiry] = useState(30);
  const [limit, setLimit] = useState(3);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const addFiles = (incoming) => {
    if (!incoming || incoming.length === 0) return;
    const newOnes = Array.from(incoming);

    // Deduplicate against current selection (name + size)
    const existingKey = new Set(files.map((f) => `${f.name}|${f.size}`));
    const filtered = newOnes.filter((f) => !existingKey.has(`${f.name}|${f.size}`));
    if (filtered.length < newOnes.length) {
      toast.info("Skipped duplicates");
    }
    if (filtered.length === 0) return;

    const combined = [...files, ...filtered];
    if (combined.length > MAX_FILES_PER_BUNDLE) {
      toast.error(`Max ${MAX_FILES_PER_BUNDLE} files per drop`);
      return;
    }
    const newTotal = combined.reduce((s, f) => s + f.size, 0);
    if (newTotal > MAX_BUNDLE_SIZE) {
      toast.error(`Bundle exceeds 700MB total. Currently at ${formatSize(newTotal)}.`);
      return;
    }
    setFiles(combined);
  };

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setProgress(0);
    try {
      const data = await uploadFiles({
        files,
        expiryMinutes: expiry,
        maxDownloads: limit,
        onProgress: ({ percent }) => setProgress(Math.round(percent * 100)),
      });
      setResult(data);
      toast.success("Ready to share!");
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || "Upload failed";
      toast.error(typeof msg === "string" ? msg : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setResult(null);
    setProgress(0);
  };

  let buttonLabel;
  if (uploading) buttonLabel = "Uploading…";
  else if (files.length === 0) buttonLabel = "Select files to continue";
  else if (files.length === 1) buttonLabel = "Generate PIN";
  else buttonLabel = `Generate PIN · ${files.length} files`;

  if (result) {
    return <PinResult result={result} onReset={reset} />;
  }

  const showDropzone = files.length === 0;

  return (
    <div className="space-y-8" data-testid="send-flow">
      {/* Dropzone (empty state) */}
      {showDropzone ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          data-testid="file-upload-dropzone"
          className={`border-2 border-dashed rounded-2xl p-10 min-h-[240px] flex flex-col items-center justify-center cursor-pointer transition-colors duration-200 ${
            dragging
              ? "border-indigo-500 bg-indigo-50/70"
              : "border-gray-200 bg-gray-50/50 hover:border-indigo-400 hover:bg-indigo-50/40"
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-center mb-5">
            <UploadCloud className="w-6 h-6 text-indigo-600" strokeWidth={1.8} />
          </div>
          <p className="font-display font-semibold text-lg text-gray-900 mb-1">
            Drop your files here
          </p>
          <p className="text-sm text-gray-500">
            or click to browse · up to 700MB · max {MAX_FILES_PER_BUNDLE} files
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="selected-files-list">
          <div className="flex items-baseline justify-between px-1">
            <p className="text-xs font-semibold text-gray-500 tracking-wider uppercase">
              {files.length} {files.length === 1 ? "file" : "files"} selected
            </p>
            <p className="text-xs text-gray-400 font-mono-pin">
              {formatSize(totalSize)} / 700MB
            </p>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {files.map((f, idx) => (
              <div
                key={`${f.name}-${f.size}-${idx}`}
                className="border border-gray-200 rounded-xl p-3 flex items-center gap-3 bg-gray-50/50"
                data-testid={`selected-file-item-${idx}`}
              >
                <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <FileIcon className="w-4 h-4 text-indigo-600" strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{f.name}</p>
                  <p className="text-xs text-gray-500">{formatSize(f.size)}</p>
                </div>
                {!uploading && (
                  <button
                    onClick={() => removeFile(idx)}
                    className="w-7 h-7 rounded-lg hover:bg-gray-200 flex items-center justify-center transition-colors flex-shrink-0"
                    data-testid={`remove-file-btn-${idx}`}
                    aria-label="Remove file"
                  >
                    <X className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!uploading && files.length < MAX_FILES_PER_BUNDLE && (
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-sm font-medium text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors flex items-center justify-center gap-2"
              data-testid="add-more-files-btn"
            >
              <Plus className="w-4 h-4" /> Add more files
            </button>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          addFiles(e.target.files);
          // reset the input so the same file can be re-selected after removal
          e.target.value = "";
        }}
      />

      {/* Settings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-2.5 block">
            Expires in
          </label>
          <div className="flex gap-2" data-testid="expiry-selector">
            {EXPIRY_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setExpiry(o.value)}
                data-testid={`expiry-option-${o.value}`}
                disabled={uploading}
                className={`flex-1 py-2.5 px-3 text-sm font-medium rounded-lg border transition-all duration-200 disabled:opacity-50 ${
                  expiry === o.value
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-2.5 block">
            Max downloads
          </label>
          <div className="flex gap-2" data-testid="download-limit-selector">
            {LIMIT_OPTIONS.map((v) => (
              <button
                key={v}
                onClick={() => setLimit(v)}
                data-testid={`limit-option-${v}`}
                disabled={uploading}
                className={`flex-1 py-2.5 px-3 text-sm font-medium rounded-lg border transition-all duration-200 disabled:opacity-50 ${
                  limit === v
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Progress */}
      {uploading && (
        <div className="space-y-2" data-testid="upload-progress">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700 font-medium">Uploading…</span>
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

      {/* Submit */}
      <Button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
        data-testid="generate-pin-btn"
        className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
