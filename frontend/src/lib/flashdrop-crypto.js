// FlashDrop E2EE — AES-GCM 256 helpers using Web Crypto.
// The symmetric key is generated in the browser, never sent to the server,
// and shared with the recipient only in the URL fragment (`#k=...`).

const KEY_ALGO = { name: "AES-GCM", length: 256 };
const IV_BYTES = 12; // 96-bit IV recommended for AES-GCM

// ---------- base64url ----------
function bytesToBase64Url(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- key handling ----------
export async function generateKey() {
  return crypto.subtle.generateKey(KEY_ALGO, true, ["encrypt", "decrypt"]);
}

export async function exportKeyToString(key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return bytesToBase64Url(raw);
}

export async function importKeyFromString(str) {
  const raw = base64UrlToBytes(str);
  return crypto.subtle.importKey("raw", raw, KEY_ALGO, false, ["encrypt", "decrypt"]);
}

// ---------- encryption ----------
// Encrypts a File → returns a new File with the same name but content
// laid out as [12-byte IV || ciphertext+tag] and MIME `application/octet-stream`.
export async function encryptFile(file, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  const cipher = new Uint8Array(cipherBuf);
  const payload = new Uint8Array(iv.length + cipher.length);
  payload.set(iv, 0);
  payload.set(cipher, iv.length);
  return new File([payload], file.name, { type: "application/octet-stream" });
}

// ---------- decryption ----------
// Decrypts a downloaded encrypted Blob → returns a plaintext Blob with the given mime type.
export async function decryptBlob(encryptedBlob, key, mimeType = "application/octet-stream") {
  const buf = new Uint8Array(await encryptedBlob.arrayBuffer());
  if (buf.length < IV_BYTES + 16) {
    throw new Error("Encrypted payload too small");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const cipher = buf.subarray(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new Blob([plain], { type: mimeType });
}

// ---------- URL fragment helpers ----------
export function readKeyFromFragment() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#")) return "";
  const params = new URLSearchParams(hash.slice(1));
  return params.get("k") || "";
}
