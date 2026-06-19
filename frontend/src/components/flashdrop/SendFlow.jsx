import { useRef, useState } from "react";
import { UploadCloud, FileIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFile, formatSize } from "@/lib/flashdrop-api";
import { toast } from "sonner";
import PinResult from "./PinResult";

const EXPIRY_OPTIONS = [
  { value: 10, label: "10 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];
const LIMIT_OPTIONS = [1, 3, 5, 10];
const MAX_SIZE = 200 * 1024 * 1024;

export default function SendFlow() {
  const [file, setFile] = useState(null);
  const [expiry, setExpiry] = useState(30);
  const [limit, setLimit] = useState(3);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const handleSelect = (f) => {
    if (!f) return;
    if (f.size > MAX_SIZE) {
      toast.error("File too large. Max 200MB.");
      return;
    }
    setFile(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    handleSelect(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const data = await uploadFile({
        file,
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
    setFile(null);
    setResult(null);
    setProgress(0);
  };

  if (result) {
    return <PinResult result={result} onReset={reset} />;
  }

  const buttonLabel = uploading
    ? "Uploading…"
    : file
      ? "Generate PIN"
      : "Select a file to continue";

  return (
    <div className="space-y-8" data-testid="send-flow">
      {/* Dropzone */}
      {!file ? (
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
            Drop your file here
          </p>
          <p className="text-sm text-gray-500">or click to browse · up to 200MB</p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            data-testid="file-input"
            onChange={(e) => handleSelect(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div
          className="border border-gray-200 rounded-2xl p-5 flex items-center gap-4 bg-gray-50/50"
          data-testid="selected-file-card"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <FileIcon className="w-5 h-5 text-indigo-600" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 truncate" data-testid="selected-file-name">
              {file.name}
            </p>
            <p className="text-sm text-gray-500">{formatSize(file.size)}</p>
          </div>
          {!uploading && (
            <button
              onClick={reset}
              className="w-8 h-8 rounded-lg hover:bg-gray-200 flex items-center justify-center transition-colors"
              data-testid="remove-file-btn"
              aria-label="Remove file"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>
      )}

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
        disabled={!file || uploading}
        data-testid="generate-pin-btn"
        className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
