import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_API_BASE_URL = "https://api.telegram.org";
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_TITLE_LENGTH = 96;
const MAX_OUTCOME_LENGTH = 160;
const MAX_TRANSCRIPT_BYTES = 512 * 1024;
const MAX_TRANSCRIPT_PATH_LENGTH = 4096;
const REQUEST_TIMEOUT_MS = 2500;
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_DIR_SEGMENTS = ["eip", "telegram-hook"];

function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

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

function sanitizeAbsolutePath(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TRANSCRIPT_PATH_LENGTH || trimmed.includes("\u0000") || !path.isAbsolute(trimmed)) {
    return undefined;
  }

  return path.resolve(trimmed);
}

function sanitizeWorkspaceRoot(value) {
  return sanitizeAbsolutePath(value);
}

function getTrustedWorkspaceStorageRootCandidates(env) {
  const candidates = new Set();
  const home = sanitizeAbsolutePath(readEnv(env, "HOME"));
  const xdgConfigHome = sanitizeAbsolutePath(readEnv(env, "XDG_CONFIG_HOME"));
  const appData = sanitizeAbsolutePath(readEnv(env, "APPDATA"));
  const productNames = ["Code", "Code - Insiders"];

  const addUserDataRoot = (baseDir) => {
    const sanitizedBaseDir = sanitizeAbsolutePath(baseDir);
    if (!sanitizedBaseDir) {
      return;
    }

    for (const productName of productNames) {
      candidates.add(path.join(sanitizedBaseDir, productName, "User", "workspaceStorage"));
    }
  };

  switch (process.platform) {
    case "win32":
      addUserDataRoot(appData);
      break;
    case "darwin":
      addUserDataRoot(home ? path.join(home, "Library", "Application Support") : undefined);
      break;
    default:
      addUserDataRoot(xdgConfigHome || (home ? path.join(home, ".config") : undefined));
      break;
  }

  return [...candidates];
}

function isPathInside(parentPath, candidatePath) {
  if (!parentPath || !candidatePath) {
    return false;
  }

  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalizePath(value) {
  const resolved = path.resolve(value);

  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

async function getTrustedWorkspaceStorageRoots(env) {
  const canonicalRoots = [];

  for (const candidate of getTrustedWorkspaceStorageRootCandidates(env)) {
    const canonicalCandidate = await canonicalizePath(candidate);
    if (!canonicalRoots.includes(canonicalCandidate)) {
      canonicalRoots.push(canonicalCandidate);
    }
  }

  return canonicalRoots;
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

function parseTimestampMs(value) {
  const timestamp = typeof value === "string" ? new Date(value) : undefined;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    return undefined;
  }

  return timestamp.getTime();
}

function truncateText(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  const slice = value.slice(0, Math.max(0, maxLength - 3)).trimEnd();
  const boundary = slice.lastIndexOf(" ");
  const shortened = boundary >= Math.floor(maxLength / 2) ? slice.slice(0, boundary) : slice;
  return `${shortened.trimEnd()}...`;
}

function looksSecretLikeValue(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed || /^\[(?:link|path|redacted)\]$/i.test(trimmed)) {
    return false;
  }

  if (/^\d{6,}$/.test(trimmed)) {
    return true;
  }

  const hasLetter = /[A-Za-z]/.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const hasMixedCase = /[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed);
  const hasSymbol = /[^A-Za-z0-9]/.test(trimmed);

  return (trimmed.length >= 8 && hasLetter && (hasDigit || hasMixedCase || hasSymbol))
    || /^[A-Za-z0-9+/_=-]{16,}$/.test(trimmed);
}

function redactSecrets(value) {
  const redactMatch = (match, label, separator = "", doubleQuotedValue, singleQuotedValue, bareValue, forceRedaction = false) => {
    const secretValue = doubleQuotedValue ?? singleQuotedValue ?? bareValue;
    if (!secretValue) {
      return match;
    }

    if (/^\[redacted\]$/i.test(secretValue.trim())) {
      return `${label}${separator}[redacted]`;
    }

    if (forceRedaction) {
      return `${label}${separator}[redacted]`;
    }

    const hasExplicitSeparator = /[:=]/.test(separator)
      || /\b(?:is|was|are)\b/i.test(separator)
      || doubleQuotedValue != null
      || singleQuotedValue != null;

    if (!hasExplicitSeparator && !looksSecretLikeValue(secretValue)) {
      return match;
    }

    return `${label}${separator}[redacted]`;
  };

  const redactStructuredSecret = (match, label, separator, doubleQuotedValue, singleQuotedValue, bareValue) => (
    redactMatch(match, label, separator, doubleQuotedValue, singleQuotedValue, bareValue)
  );

  const redactKeywordAdjacentSecret = (match, label, separator, doubleQuotedValue, singleQuotedValue, bareValue) => (
    redactMatch(match, label, separator, doubleQuotedValue, singleQuotedValue, bareValue, true)
  );

  return value
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSCODE|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET|COOKIE|CREDENTIAL|CHAT_ID))\b(\s*[:=]\s*)(?:"([^"\r\n]{1,120})"|'([^'\r\n]{1,120})'|([^\s,.;()\[\]{}]{1,120}))/g,
      redactStructuredSecret,
    )
    .replace(
      /\b(password|passwd|passcode|secret|token|api[_ -]?key|apikey|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|credential|cookie|bearer|bot[_ -]?token)\b(\s*(?::|=|is|was|are)?\s*)(?:"([^"\r\n]{1,80})"|'([^'\r\n]{1,80})'|([^\s,.;()\[\]{}]{3,80}))/gi,
      redactKeywordAdjacentSecret,
    )
    .replace(/\b[A-Za-z0-9+/=_-]{16,}\b/g, (match) => (
      /[A-Za-z]/.test(match) && /\d/.test(match) ? "[redacted]" : match
    ));
}

function sanitizeText(value, maxLength) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return undefined;
  }

  const sanitized = redactSecrets(
    normalized
      .replace(/\bhttps?:\/\/\S+/gi, "[link]")
      .replace(/[A-Za-z]:\\(?:[^\\\s]+\\){1,}[^\\\s]+/g, "[path]")
      .replace(/\/(?:[^/\s]+\/){2,}[^/\s]+/g, "[path]")
      .replace(/\bfile:\/\/\S+/gi, "[path]"),
  )
    .replace(/\s+/g, " ")
    .trim();

  return sanitized ? truncateText(sanitized, maxLength) : undefined;
}

function summarizeText(value, maxLength) {
  const sanitized = sanitizeText(value, maxLength * 2);
  if (!sanitized) {
    return undefined;
  }

  const sentenceBoundary = sanitized.search(/[.!?](?:\s|$)/);
  const summary = sentenceBoundary >= 23 ? sanitized.slice(0, sentenceBoundary + 1).trim() : sanitized;
  return truncateText(summary, maxLength);
}

function sanitizeTranscriptPath(value) {
  return sanitizeAbsolutePath(value);
}

function getRawSessionId(payload) {
  return [payload.session_id, payload.sessionId].find((value) => typeof value === "string" && value.trim());
}

function buildSessionKey(rawSessionId) {
  if (typeof rawSessionId !== "string" || !rawSessionId.trim()) {
    return undefined;
  }

  return createHash("sha256").update(rawSessionId).digest("hex");
}

async function getStateRoot(env, workspaceRoot) {
  const configuredStateHome = readEnv(env, "XDG_STATE_HOME");
  const canonicalWorkspaceRoot = workspaceRoot ? await canonicalizePath(workspaceRoot) : undefined;

  if (configuredStateHome && path.isAbsolute(configuredStateHome)) {
    const canonicalStateHome = await canonicalizePath(configuredStateHome);
    if (!canonicalWorkspaceRoot || !isPathInside(canonicalWorkspaceRoot, canonicalStateHome)) {
      return path.join(canonicalStateHome, ...STATE_DIR_SEGMENTS);
    }
  }

  return path.join(path.join(os.tmpdir(), "eip-state"), ...STATE_DIR_SEGMENTS);
}

function getStateFilePath(stateRoot, sessionKey) {
  return path.join(stateRoot, `${sessionKey}.json`);
}

function normalizeState(state) {
  if (!isRecord(state)) {
    return undefined;
  }

  const startedAt = normalizeTimestamp(state.startedAt);
  const startedAtMs = Number.isFinite(state.startedAtMs) ? state.startedAtMs : parseTimestampMs(startedAt);

  return {
    startedAt,
    startedAtMs,
    title: sanitizeText(state.title, MAX_TITLE_LENGTH),
    workspaceName: sanitizeLabel(state.workspaceName),
  };
}

async function readSessionState(env, sessionKey, workspaceRoot) {
  if (!sessionKey) {
    return undefined;
  }

  try {
    const stateRoot = await getStateRoot(env, workspaceRoot);
    const rawState = await readFile(getStateFilePath(stateRoot, sessionKey), "utf8");
    return normalizeState(JSON.parse(rawState));
  } catch {
    return undefined;
  }
}

async function writeSessionState(env, sessionKey, state, workspaceRoot) {
  if (!sessionKey) {
    return;
  }

  const root = await getStateRoot(env, workspaceRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });

  const startedAt = normalizeTimestamp(state.startedAt) || new Date().toISOString();
  const startedAtMs = Number.isFinite(state.startedAtMs) ? state.startedAtMs : parseTimestampMs(startedAt) || Date.now();
  const payload = {
    version: 1,
    startedAt,
    startedAtMs,
    title: sanitizeText(state.title, MAX_TITLE_LENGTH),
    updatedAt: new Date().toISOString(),
    workspaceName: sanitizeLabel(state.workspaceName),
  };

  await writeFile(getStateFilePath(root, sessionKey), JSON.stringify(payload), { mode: 0o600 });
}

async function deleteSessionState(env, sessionKey, workspaceRoot) {
  if (!sessionKey) {
    return;
  }

  try {
    const stateRoot = await getStateRoot(env, workspaceRoot);
    await rm(getStateFilePath(stateRoot, sessionKey), { force: true });
  } catch {
    // Ignore cleanup failures to keep the hook fail-open.
  }
}

async function pruneStaleState(env, workspaceRoot, nowMs = Date.now()) {
  const root = await getStateRoot(env, workspaceRoot);
  let entries;

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const filePath = path.join(root, entry.name);

        try {
          const stats = await lstat(filePath);
          if (nowMs - stats.mtimeMs > STATE_TTL_MS) {
            await rm(filePath, { force: true });
          }
        } catch {
          // Ignore prune failures to keep the hook fail-open.
        }
      }),
  );
}

function extractTextCandidate(value, depth = 0) {
  if (depth > 4 || value == null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = [];
    let totalLength = 0;

    for (const item of value.slice(0, 8)) {
      const text = extractTextCandidate(item, depth + 1);
      if (!text) {
        continue;
      }

      parts.push(text);
      totalLength += text.length;

      if (totalLength >= MAX_OUTCOME_LENGTH * 2) {
        break;
      }
    }

    return parts.join(" ").trim() || undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ["text", "value", "message", "content", "body", "output", "summary", "prompt", "input", "parts"]) {
    if (!(key in value)) {
      continue;
    }

    const text = extractTextCandidate(value[key], depth + 1);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractPromptTitle(payload) {
  const safePayload = isRecord(payload) ? payload : {};

  for (const key of ["prompt", "user_prompt", "text", "input", "message", "content"]) {
    const title = sanitizeText(extractTextCandidate(safePayload[key]), MAX_TITLE_LENGTH);
    if (title) {
      return title;
    }
  }

  return undefined;
}

function isTranscriptEvent(value) {
  return isRecord(value)
    && typeof value.type === "string"
    && isRecord(value.data)
    && typeof value.id === "string"
    && typeof value.timestamp === "string";
}

function looksLikeTrustedTranscriptPath(transcriptPath, sessionId, workspaceRoot, workspaceStorageRoots) {
  if (!transcriptPath || !sessionId || !Array.isArray(workspaceStorageRoots) || workspaceStorageRoots.length === 0) {
    return false;
  }

  if (workspaceRoot && isPathInside(workspaceRoot, transcriptPath)) {
    return false;
  }

  if (path.extname(transcriptPath).toLowerCase() !== ".jsonl") {
    return false;
  }

  if (path.basename(transcriptPath, ".jsonl") !== sessionId) {
    return false;
  }

  return workspaceStorageRoots.some((workspaceStorageRoot) => {
    if (!isPathInside(workspaceStorageRoot, transcriptPath)) {
      return false;
    }

    const relativePath = path.relative(workspaceStorageRoot, transcriptPath);
    const segments = relativePath.split(path.sep).filter(Boolean);
    return segments.length === 4
      && segments[1] === "GitHub.copilot-chat"
      && segments[2] === "transcripts";
  });
}

function extractTranscriptAssistantText(event) {
  if (!isTranscriptEvent(event) || event.type !== "assistant.message") {
    return undefined;
  }

  return extractTextCandidate(event.data);
}

function parseTranscriptContent(rawContent, expectedSessionId) {
  if (typeof expectedSessionId !== "string" || !expectedSessionId.trim()) {
    return undefined;
  }

  let hasMatchingSessionStart = false;
  let lastAssistantText;

  for (const line of rawContent.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(candidate);
    } catch {
      return undefined;
    }

    if (!isTranscriptEvent(event)) {
      return undefined;
    }

    if (event.type === "session.start") {
      if (event.data.sessionId !== expectedSessionId) {
        return undefined;
      }

      hasMatchingSessionStart = true;
      continue;
    }

    const assistantText = extractTranscriptAssistantText(event);
    if (assistantText) {
      lastAssistantText = assistantText;
    }
  }

  return hasMatchingSessionStart ? lastAssistantText : undefined;
}

async function extractOutcomeFromTranscriptPath(env, transcriptPath, sessionId, workspaceRoot) {
  if (!transcriptPath || !sessionId) {
    return undefined;
  }

  const canonicalTranscriptPath = await canonicalizePath(transcriptPath);
  const canonicalWorkspaceRoot = workspaceRoot ? await canonicalizePath(workspaceRoot) : undefined;
  const trustedWorkspaceStorageRoots = await getTrustedWorkspaceStorageRoots(env);
  if (!looksLikeTrustedTranscriptPath(canonicalTranscriptPath, sessionId, canonicalWorkspaceRoot, trustedWorkspaceStorageRoots)) {
    return undefined;
  }

  let stats;
  try {
    stats = await lstat(canonicalTranscriptPath);
  } catch {
    return undefined;
  }

  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > MAX_TRANSCRIPT_BYTES) {
    return undefined;
  }

  let rawContent;
  try {
    rawContent = await readFile(canonicalTranscriptPath, "utf8");
  } catch {
    return undefined;
  }

  return summarizeText(parseTranscriptContent(rawContent, sessionId), MAX_OUTCOME_LENGTH);
}

function normalizeMode(argv) {
  const rawMode = Array.isArray(argv) ? argv[0] : undefined;
  const mode = typeof rawMode === "string" ? rawMode.trim().toLowerCase() : "";

  switch (mode) {
    case "start":
    case "sessionstart":
      return "start";
    case "prompt":
    case "userpromptsubmit":
      return "prompt";
    case "":
    case "stop":
    case "sessionstop":
      return "stop";
    default:
      return "stop";
  }
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

function computeDurationMs(startedAtMs, timestamp) {
  const stopAtMs = parseTimestampMs(timestamp) || Date.now();
  if (!Number.isFinite(startedAtMs) || stopAtMs < startedAtMs) {
    return undefined;
  }

  return stopAtMs - startedAtMs;
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
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function sanitizeStopPayload(payload) {
  const safePayload = isRecord(payload) ? payload : {};
  const rawSessionId = getRawSessionId(safePayload);
  const workspaceName = typeof safePayload.cwd === "string" ? sanitizeLabel(path.basename(safePayload.cwd)) : undefined;
  const sessionId = sanitizeLabel(typeof rawSessionId === "string" ? rawSessionId.slice(0, 8) : undefined, 8);

  return {
    workspaceName,
    sessionId,
    sessionKey: buildSessionKey(rawSessionId),
    timestamp: normalizeTimestamp(safePayload.timestamp),
    stopHookActive: safePayload.stop_hook_active === true,
    transcriptPath: sanitizeTranscriptPath(safePayload.transcript_path),
  };
}

export function buildTelegramMessage(metadata) {
  const parts = ["VS Code agent run finished"];

  if (metadata.workspaceName) {
    parts.push(`workspace: ${metadata.workspaceName}`);
  }

  if (metadata.sessionId) {
    parts.push(`session: ${metadata.sessionId}`);
  }

  parts.push(`title: ${metadata.title || "Untitled"}`);
  parts.push(`status: ${metadata.status || "Completed"}`);
  parts.push(`summary: ${metadata.summary || metadata.outcome || "Trusted transcript recap unavailable."}`);
  parts.push(`elapsed: ${metadata.elapsed || "unknown"}`);

  if (metadata.timestamp) {
    parts.push(`time: ${metadata.timestamp}`);
  }

  return parts.join("\n");
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

async function recordSessionStart({ env, metadata }) {
  if (!metadata.sessionKey) {
    return { delivered: false, reason: "missing-session" };
  }

  await pruneStaleState(env, metadata.workspaceRoot);
  await writeSessionState(env, metadata.sessionKey, {
    startedAt: metadata.timestamp || new Date().toISOString(),
    startedAtMs: parseTimestampMs(metadata.timestamp) || Date.now(),
    workspaceName: metadata.workspaceName,
  }, metadata.workspaceRoot);

  return { delivered: false, reason: "state-recorded" };
}

async function recordPromptTitle({ env, metadata, payload }) {
  if (!metadata.sessionKey) {
    return { delivered: false, reason: "missing-session" };
  }

  await pruneStaleState(env, metadata.workspaceRoot);
  const title = extractPromptTitle(payload);
  if (!title) {
    return { delivered: false, reason: "missing-title" };
  }

  const existingState = await readSessionState(env, metadata.sessionKey, metadata.workspaceRoot);
  if (existingState?.title) {
    return { delivered: false, reason: "title-kept" };
  }

  await writeSessionState(env, metadata.sessionKey, {
    startedAt: existingState?.startedAt || metadata.timestamp || new Date().toISOString(),
    startedAtMs: existingState?.startedAtMs || parseTimestampMs(metadata.timestamp) || Date.now(),
    title,
    workspaceName: existingState?.workspaceName || metadata.workspaceName,
  }, metadata.workspaceRoot);

  return { delivered: false, reason: "title-recorded" };
}

async function notifyStop({ env, fetchImpl, metadata, transcriptSessionId }) {
  const sessionState = await readSessionState(env, metadata.sessionKey, metadata.workspaceRoot);

  try {
    if (metadata.stopHookActive) {
      return { delivered: false, reason: "stop-hook-active" };
    }

    const token = readEnv(env, "TELEGRAM_BOT_TOKEN");
    const chatId = readEnv(env, "TELEGRAM_CHAT_ID");
    if (!token || !chatId) {
      return { delivered: false, reason: "missing-config" };
    }

    const delivered = await sendTelegramNotification({
      apiBaseUrl: readEnv(env, "TELEGRAM_API_BASE_URL") || DEFAULT_API_BASE_URL,
      chatId,
      fetchImpl,
      text: buildTelegramMessage({
        elapsed: formatDuration(computeDurationMs(sessionState?.startedAtMs, metadata.timestamp)),
        sessionId: metadata.sessionId,
        status: "Completed",
        summary: await extractOutcomeFromTranscriptPath(env, metadata.transcriptPath, transcriptSessionId, metadata.workspaceRoot),
        timestamp: metadata.timestamp,
        title: sessionState?.title,
        workspaceName: metadata.workspaceName || sessionState?.workspaceName,
      }),
      token,
    });

    return { delivered, reason: delivered ? "sent" : "upstream-rejected" };
  } catch {
    return { delivered: false, reason: "send-failed" };
  } finally {
    await deleteSessionState(env, metadata.sessionKey, metadata.workspaceRoot);
    await pruneStaleState(env, metadata.workspaceRoot);
  }
}

export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdin = process.stdin,
} = {}) {
  const rawInput = await readStdin(stdin);
  const payload = parseHookPayload(rawInput);
  const metadata = {
    ...sanitizeStopPayload(payload),
    workspaceRoot: sanitizeWorkspaceRoot(isRecord(payload) ? payload.cwd : undefined),
  };
  const transcriptSessionId = getRawSessionId(payload);

  switch (normalizeMode(argv)) {
    case "start":
      return recordSessionStart({ env, metadata });
    case "prompt":
      return recordPromptTitle({ env, metadata, payload });
    default:
      return notifyStop({ env, fetchImpl, metadata, transcriptSessionId });
  }
}

async function main() {
  await run();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
