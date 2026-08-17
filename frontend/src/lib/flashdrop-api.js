import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const MAX_BUNDLE_SIZE = 700 * 1024 * 1024; // 700 MB
export const MAX_FILES_PER_BUNDLE = 20;

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

export function timeUntil(isoString) {
  const target = new Date(isoString).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return "expired";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export async function uploadFiles({ files, expiryMinutes, maxDownloads, encrypted = false, onProgress }) {
  const form = new FormData();
  files.forEach((f) => form.append("files", f, f.name));
  form.append("expiry_minutes", String(expiryMinutes));
  form.append("max_downloads", String(maxDownloads));
  form.append("encrypted", String(encrypted));

  const total = files.reduce((s, f) => s + f.size, 0);
  const res = await axios.post(`${API}/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (!onProgress) return;
      const totalBytes = e.total || total;
      const loaded = e.loaded || 0;
      onProgress({ loaded, total: totalBytes, percent: totalBytes ? loaded / totalBytes : 0 });
    },
  });
  return res.data;
}

export async function getBundleInfo(pin) {
  const res = await axios.get(`${API}/file/${pin}`);
  return res.data;
}

export function downloadAllUrl(pin) {
  return `${API}/download/${pin}`;
}

export function downloadSingleUrl(pin, fileId) {
  return `${API}/download/${pin}/${fileId}`;
}

export function pingsStreamUrl(pin) {
  return `${API}/pings/${pin}`;
}
