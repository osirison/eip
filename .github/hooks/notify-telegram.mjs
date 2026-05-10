import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_API_BASE_URL = "https://api.telegram.org";
const MAX_STDIN_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 2500;

function readEnv(env, key) {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeLabel(value, maxLength = 80) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const sanitized = trimmed.replace(/[^A-Za-z0-9._-]/g, "").slice(0, maxLength);
  return sanitized || undefined;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return undefined;
  }

  return timestamp.toISOString();
}

export async function readStdin(stream = process.stdin, maxBytes = MAX_STDIN_BYTES) {
  if (!stream || stream.isTTY) {
    return "";
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      return "";
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function parseHookPayload(rawInput) {
  if (typeof rawInput !== "string" || !rawInput.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawInput);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function sanitizeStopPayload(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const workspaceName = typeof safePayload.cwd === "string" ? sanitizeLabel(path.basename(safePayload.cwd)) : undefined;
  const rawSessionId = [safePayload.session_id, safePayload.sessionId].find(
    (value) => typeof value === "string" && value.trim(),
  );
  const sessionId = sanitizeLabel(typeof rawSessionId === "string" ? rawSessionId.slice(0, 8) : undefined, 8);

  return {
    workspaceName,
    sessionId,
    timestamp: normalizeTimestamp(safePayload.timestamp),
    stopHookActive: safePayload.stop_hook_active === true,
  };
}

export function buildTelegramMessage(metadata) {
  const parts = ["VS Code agent run finished"];

  if (metadata.workspaceName) {
    parts.push(`workspace=${metadata.workspaceName}`);
  }

  if (metadata.timestamp) {
    parts.push(`time=${metadata.timestamp}`);
  }

  if (metadata.sessionId) {
    parts.push(`session=${metadata.sessionId}`);
  }

  return parts.join(" | ");
}

export function buildTelegramUrl(apiBaseUrl, token) {
  const url = new URL(apiBaseUrl || DEFAULT_API_BASE_URL);
  const basePath = url.pathname.replace(/\/$/, "");
  url.pathname = `${basePath}/bot${token}/sendMessage`;
  return url;
}

export async function sendTelegramNotification({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  chatId,
  fetchImpl = globalThis.fetch,
  text,
  timeoutMs = REQUEST_TIMEOUT_MS,
  token,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is unavailable");
  }

  const response = await fetchImpl(buildTelegramUrl(apiBaseUrl, token), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      disable_notification: true,
      text,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    return false;
  }

  try {
    const body = await response.json();
    return body?.ok !== false;
  } catch {
    return true;
  }
}

export async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdin = process.stdin,
} = {}) {
  const token = readEnv(env, "TELEGRAM_BOT_TOKEN");
  const chatId = readEnv(env, "TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    return { delivered: false, reason: "missing-config" };
  }

  const rawInput = await readStdin(stdin);
  const metadata = sanitizeStopPayload(parseHookPayload(rawInput));

  if (metadata.stopHookActive) {
    return { delivered: false, reason: "stop-hook-active" };
  }

  try {
    const delivered = await sendTelegramNotification({
      apiBaseUrl: readEnv(env, "TELEGRAM_API_BASE_URL") || DEFAULT_API_BASE_URL,
      chatId,
      fetchImpl,
      text: buildTelegramMessage(metadata),
      token,
    });

    return { delivered, reason: delivered ? "sent" : "upstream-rejected" };
  } catch {
    return { delivered: false, reason: "send-failed" };
  }
}

async function main() {
  await run();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}