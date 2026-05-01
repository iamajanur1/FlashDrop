import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms) {
  if (ms <= 0 || !isFinite(ms)) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export function timeUntil(isoString) {
  const target = new Date(isoString).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return "expired";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export async function uploadFile({ file, expiryMinutes, maxDownloads, onProgress }) {
  const form = new FormData();
  form.append("file", file);
  form.append("expiry_minutes", String(expiryMinutes));
  form.append("max_downloads", String(maxDownloads));

  const res = await axios.post(`${API}/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (!onProgress) return;
      const total = e.total || file.size;
      const loaded = e.loaded || 0;
      onProgress({ loaded, total, percent: total ? loaded / total : 0 });
    },
  });
  return res.data;
}

export async function getFileInfo(pin) {
  const res = await axios.get(`${API}/file/${pin}`);
  return res.data;
}

export function downloadUrl(pin) {
  return `${API}/download/${pin}`;
}
