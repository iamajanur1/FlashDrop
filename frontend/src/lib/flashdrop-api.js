import axios from "axios";

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || import.meta.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
export const API = `${BACKEND_URL}/api`;

export const MAX_BUNDLE_SIZE = 700 * 1024 * 1024;
export const MAX_FILES_PER_BUNDLE = 20;

export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
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

export function getClientId() {
  const key = "flashdrop:client-id";
  let value = window.localStorage.getItem(key);
  if (!value) {
    value = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(key, value);
  }
  return value;
}


export async function initLiveDrop({ files, expiryMinutes, maxPickups, accessMode, burnRule }) {
  const res = await axios.post(`${API}/drop/init`, {
    files: files.map((file) => ({
      filename: file.name,
      size: file.size,
      content_type: file.type || "application/octet-stream",
    })),
    expiry_minutes: expiryMinutes,
    max_pickups: maxPickups,
    access_mode: accessMode,
    burn_rule: burnRule,
  });
  return res.data;
}

export async function uploadLiveFile({ pin, fileSlot, uploadToken, file, onProgress, signal }) {
  if (!fileSlot?.file_id) throw new Error("Missing Live Drop file slot");
  if (file.size !== fileSlot.size) throw new Error(`Selected file size does not match ${fileSlot.filename}`);

  const res = await axios.put(
    `${API}/drop/${encodeURIComponent(pin)}/files/${encodeURIComponent(fileSlot.file_id)}`,
    file,
    {
      headers: {
        Authorization: `Bearer ${uploadToken}`,
        "Content-Type": file.type || fileSlot.content_type || "application/octet-stream",
      },
      signal,
      onUploadProgress: (event) => {
        if (!onProgress) return;
        const total = event.total || file.size;
        const loaded = Math.min(event.loaded || 0, total);
        onProgress({ loaded, total, percent: total ? loaded / total : 1 });
      },
    },
  );
  return res.data;
}

export function liveDropStreamUrl(pin) {
  return `${API}/file/${encodeURIComponent(pin)}/live`;
}

export async function uploadFiles({ files, expiryMinutes, maxPickups, accessMode, burnRule, onProgress }) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file, file.name));
  form.append("expiry_minutes", String(expiryMinutes));
  form.append("max_pickups", String(maxPickups));
  form.append("access_mode", accessMode);
  form.append("burn_rule", burnRule);

  const total = files.reduce((sum, file) => sum + file.size, 0);
  const res = await axios.post(`${API}/upload`, form, {
    onUploadProgress: (event) => {
      if (!onProgress) return;
      const totalBytes = event.total || total;
      const loaded = event.loaded || 0;
      onProgress({ loaded, total: totalBytes, percent: totalBytes ? loaded / totalBytes : 0 });
    },
  });
  return res.data;
}

export async function getBundleInfo(pin) {
  const res = await axios.get(`${API}/file/${encodeURIComponent(pin)}`);
  return res.data;
}

export async function createClaim(pin) {
  const res = await axios.post(`${API}/file/${encodeURIComponent(pin)}/claim`, {
    client_id: getClientId(),
  });
  return res.data;
}

export async function getClaimStatus(pin, claimId, claimToken) {
  const res = await axios.get(`${API}/file/${encodeURIComponent(pin)}/claim/${encodeURIComponent(claimId)}`, {
    params: { claim_token: claimToken },
  });
  return res.data;
}

export function downloadAllUrl(pin, claimToken) {
  const params = new URLSearchParams({ claim_token: claimToken });
  return `${API}/download/${encodeURIComponent(pin)}?${params.toString()}`;
}

export function downloadSingleUrl(pin, fileId, claimToken) {
  const params = new URLSearchParams({ claim_token: claimToken });
  return `${API}/download/${encodeURIComponent(pin)}/${encodeURIComponent(fileId)}?${params.toString()}`;
}

export function startNativeDownload(url) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function eventsStreamUrl(pin, manageToken) {
  const params = new URLSearchParams({ manage_token: manageToken });
  return `${API}/events/${encodeURIComponent(pin)}?${params.toString()}`;
}

export async function getManageStatus(pin, manageToken) {
  const res = await axios.get(`${API}/manage/${encodeURIComponent(pin)}`, {
    params: { manage_token: manageToken },
  });
  return res.data;
}

export async function approveClaim(pin, claimId, manageToken) {
  const res = await axios.post(
    `${API}/manage/${encodeURIComponent(pin)}/claims/${encodeURIComponent(claimId)}/approve`,
    null,
    { params: { manage_token: manageToken } },
  );
  return res.data;
}

export async function rejectClaim(pin, claimId, manageToken) {
  const res = await axios.post(
    `${API}/manage/${encodeURIComponent(pin)}/claims/${encodeURIComponent(claimId)}/reject`,
    null,
    { params: { manage_token: manageToken } },
  );
  return res.data;
}

export async function burnDrop(pin, manageToken) {
  const res = await axios.delete(`${API}/manage/${encodeURIComponent(pin)}`, {
    params: { manage_token: manageToken },
  });
  return res.data;
}
