import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Readable } from "node:stream";

import {
  buildTelegramMessage,
  parseHookPayload,
  run,
  sanitizeStopPayload,
} from "./notify-telegram.mjs";

function jsonStream(value) {
  return Readable.from([JSON.stringify(value)]);
}

function stateDirFor(stateHome) {
  return path.join(stateHome, "eip", "telegram-hook");
}

function trustedWorkspaceStorageRoot(configHome) {
  return path.join(configHome, "Code", "User", "workspaceStorage");
}

function trustedTranscriptPath(configHome, sessionId) {
  return path.join(trustedWorkspaceStorageRoot(configHome), "workspace-1", "GitHub.copilot-chat", "transcripts", `${sessionId}.jsonl`);
}

async function fileExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeTranscript(transcriptPath, sessionId, assistantContent) {
  await mkdir(path.dirname(transcriptPath), { recursive: true });
  await writeFile(
    transcriptPath,
    [
      JSON.stringify({
        type: "session.start",
        data: { sessionId, version: 1, producer: "copilot-agent" },
        id: "event-start",
        timestamp: "2026-05-10T23:40:00Z",
      }),
      JSON.stringify({
        type: "assistant.message",
        data: { messageId: "assistant-1", content: assistantContent },
        id: "event-assistant-1",
        timestamp: "2026-05-10T23:45:00Z",
      }),
    ].join("\n"),
  );

  return transcriptPath;
}

async function writeTrustedTranscript(configHome, sessionId, assistantContent) {
  return writeTranscript(trustedTranscriptPath(configHome, sessionId), sessionId, assistantContent);
}

async function listStateFiles(stateHome) {
  try {
    return await readdir(stateDirFor(stateHome));
  } catch {
    return [];
  }
}

test("stop hook registration uses the documented shell schema", async () => {
  const config = JSON.parse(
    await readFile(new URL("./stop-telegram.json", import.meta.url), "utf8"),
  );

  assert.equal(config.version, 1);
  for (const [eventName, mode] of [["SessionStart", "start"], ["UserPromptSubmit", "prompt"], ["Stop", "stop"]]) {
    assert.ok(Array.isArray(config.hooks?.[eventName]));
    assert.equal(config.hooks[eventName].length, 1);
    assert.equal(config.hooks[eventName][0].bash, `node .github/hooks/notify-telegram.mjs ${mode}`);
    assert.equal(config.hooks[eventName][0].powershell, `node .github/hooks/notify-telegram.mjs ${mode}`);
    assert.equal(config.hooks[eventName][0].timeoutSec, 5);
    assert.ok(!("command" in config.hooks[eventName][0]));
    assert.ok(!("timeout" in config.hooks[eventName][0]));
    assert.ok(!("type" in config.hooks[eventName][0]));
  }
});

test("returns a fast no-op when local Telegram env is missing and still cleans state", async () => {
  const stateHome = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-"));

  try {
    const env = { XDG_STATE_HOME: stateHome };
    const sessionPayload = {
      cwd: "/home/qp/Cloud/Projects/eip",
      session_id: "session-1234-unsafe!",
      timestamp: "2026-05-10T23:40:00Z",
    };

    assert.deepEqual(
      await run({
        argv: ["start"],
        env,
        stdin: jsonStream(sessionPayload),
      }),
      { delivered: false, reason: "state-recorded" },
    );
    assert.equal((await listStateFiles(stateHome)).length, 1);

    const result = await run({
      argv: ["stop"],
      env,
      fetchImpl: () => {
        throw new Error("fetch should not run");
      },
      stdin: jsonStream({
        ...sessionPayload,
        timestamp: "2026-05-10T23:45:01Z",
      }),
    });

    assert.deepEqual(result, { delivered: false, reason: "missing-config" });
    assert.deepEqual(await listStateFiles(stateHome), []);
  } finally {
    await rm(stateHome, { force: true, recursive: true });
  }
});

test("skips duplicate stop notifications when stop_hook_active is true and still cleans state", async () => {
  const stateHome = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-"));

  try {
    const env = {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      XDG_STATE_HOME: stateHome,
    };
    const sessionPayload = {
      cwd: "/home/qp/Cloud/Projects/eip",
      session_id: "session-1234-unsafe!",
      timestamp: "2026-05-10T23:40:00Z",
    };

    await run({
      argv: ["start"],
      env,
      stdin: jsonStream(sessionPayload),
    });

    const result = await run({
      argv: ["stop"],
      env,
      fetchImpl: () => {
        throw new Error("fetch should not run");
      },
      stdin: jsonStream({
        ...sessionPayload,
        stop_hook_active: true,
        timestamp: "2026-05-10T23:45:01Z",
      }),
    });

    assert.deepEqual(result, { delivered: false, reason: "stop-hook-active" });
    assert.deepEqual(await listStateFiles(stateHome), []);
  } finally {
    await rm(stateHome, { force: true, recursive: true });
  }
});

test("sanitizes the documented stop payload shape before building the Telegram message", () => {
  const metadata = sanitizeStopPayload(
    parseHookPayload(
      JSON.stringify({
        cwd: "/home/qp/Cloud/Projects/eip",
        session_id: "session-1234-unsafe!",
        timestamp: "2026-05-10T23:45:01Z",
        transcript_path: "/secret/transcript.json",
      }),
    ),
  );

  assert.deepEqual(metadata, {
    workspaceName: "eip",
    sessionId: "session-",
    sessionKey: metadata.sessionKey,
    timestamp: "2026-05-10T23:45:01.000Z",
    stopHookActive: false,
    transcriptPath: "/secret/transcript.json",
  });
  assert.equal(
    buildTelegramMessage({
      ...metadata,
      elapsed: "5m 01s",
      summary: "Updated stop notifications safely.",
      title: "Implement Telegram hook update",
    }),
    [
      "VS Code agent run finished",
      "workspace: eip",
      "session: session-",
      "title: Implement Telegram hook update",
      "status: Completed",
      "summary: Updated stop notifications safely.",
      "elapsed: 5m 01s",
      "time: 2026-05-10T23:45:01.000Z",
    ].join("\n"),
  );
  assert.match(metadata.sessionKey, /^[a-f0-9]{64}$/);
});

test("accepts a legacy camelCase sessionId defensively", () => {
  const metadata = sanitizeStopPayload({ sessionId: "legacy-1234-unsafe!" });

  assert.equal(metadata.sessionId, "legacy-1");
  assert.match(metadata.sessionKey, /^[a-f0-9]{64}$/);
});

test("records the first prompt title only once", async () => {
  const stateHome = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-"));

  try {
    const env = { XDG_STATE_HOME: stateHome };
    const sessionPayload = {
      cwd: "/home/qp/Cloud/Projects/eip",
      session_id: "session-1234-unsafe!",
      timestamp: "2026-05-10T23:40:00Z",
    };

    await run({
      argv: ["start"],
      env,
      stdin: jsonStream(sessionPayload),
    });
    await run({
      argv: ["prompt"],
      env,
      stdin: jsonStream({
        ...sessionPayload,
        prompt: "Build Telegram hook summary",
        timestamp: "2026-05-10T23:40:05Z",
      }),
    });
    await run({
      argv: ["prompt"],
      env,
      stdin: jsonStream({
        ...sessionPayload,
        prompt: "Ignore this follow-up",
        timestamp: "2026-05-10T23:40:15Z",
      }),
    });

    const [stateFile] = await listStateFiles(stateHome);
    assert.ok(stateFile);

    const state = JSON.parse(await readFile(path.join(stateDirFor(stateHome), stateFile), "utf8"));
    assert.equal(state.startedAt, "2026-05-10T23:40:00.000Z");
    assert.equal(state.title, "Build Telegram hook summary");
    assert.equal(state.workspaceName, "eip");
  } finally {
    await rm(stateHome, { force: true, recursive: true });
  }
});

test("posts enriched sanitized metadata to Telegram and cleans session state", async () => {
  const stateHome = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-"));
  const configHome = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-config-"));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        body: JSON.parse(body),
        method: request.method,
        url: request.url,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const sessionId = "c030b1e3-e257-48e3-8231-1fe609eb89b5";
    const env = {
      TELEGRAM_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_CHAT_ID: "456",
      XDG_CONFIG_HOME: configHome,
      XDG_STATE_HOME: stateHome,
    };
    const transcriptPath = await writeTrustedTranscript(
      configHome,
      sessionId,
      "Completed with token abc123 and password abc123.",
    );
    const sessionPayload = {
      cwd: "/home/qp/Cloud/Projects/eip",
      session_id: sessionId,
      timestamp: "2026-05-10T23:40:00Z",
    };

    await run({
      argv: ["start"],
      env,
      stdin: jsonStream(sessionPayload),
    });
    await run({
      argv: ["prompt"],
      env,
      stdin: jsonStream({
        ...sessionPayload,
        prompt: "Check password abc123 and token abc123 in prompt",
        timestamp: "2026-05-10T23:40:05Z",
      }),
    });

    const result = await run({
      argv: ["stop"],
      env,
      stdin: jsonStream({
        ...sessionPayload,
        timestamp: "2026-05-10T23:45:01Z",
        transcript_path: transcriptPath,
      }),
    });

    assert.deepEqual(result, { delivered: true, reason: "sent" });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      body: {
        chat_id: "456",
        disable_notification: true,
        text: [
          "VS Code agent run finished",
          "workspace: eip",
          `session: ${sessionId.slice(0, 8)}`,
          "title: Check password [redacted] and token [redacted] in prompt",
          "status: Completed",
          "summary: Completed with token [redacted] and password [redacted].",
          "elapsed: 5m 01s",
          "time: 2026-05-10T23:45:01.000Z",
        ].join("\n"),
      },
      method: "POST",
      url: "/bot123:abc/sendMessage",
    });
    assert.ok(!requests[0].body.text.includes("/home/qp/Cloud/Projects/eip"));
    assert.ok(!requests[0].body.text.includes("abc123"));
    assert.deepEqual(await listStateFiles(stateHome), []);
  } finally {
    await rm(stateHome, { force: true, recursive: true });
    await rm(configHome, { force: true, recursive: true });
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("rejects fake workspaceStorage transcript paths outside the trusted VS Code roots", async () => {
  const stateHome = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-"));
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-external-"));
  const configHome = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-config-"));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const env = {
      TELEGRAM_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_CHAT_ID: "456",
      XDG_CONFIG_HOME: configHome,
      XDG_STATE_HOME: stateHome,
    };
    const sessionId = "session-1234-unsafe!";
    const transcriptPath = path.join(externalRoot, "workspaceStorage", "workspace-1", "GitHub.copilot-chat", "transcripts", `${sessionId}.jsonl`);
    const sessionPayload = {
      cwd: "/home/qp/Cloud/Projects/eip",
      session_id: sessionId,
      timestamp: "2026-05-10T23:40:00Z",
    };

    await writeTranscript(
      transcriptPath,
      sessionId,
      "Completed with token abc123 and password abc123.",
    );

    await run({
      argv: ["start"],
      env,
      stdin: jsonStream(sessionPayload),
    });
    await run({
      argv: ["prompt"],
      env,
      stdin: jsonStream({
        ...sessionPayload,
        prompt: "Verify telegram hook",
        timestamp: "2026-05-10T23:40:05Z",
      }),
    });

    const result = await run({
      argv: ["stop"],
      env,
      stdin: jsonStream({
        ...sessionPayload,
        timestamp: "2026-05-10T23:45:01Z",
        transcript_path: transcriptPath,
      }),
    });

    assert.deepEqual(result, { delivered: true, reason: "sent" });
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].text,
      [
        "VS Code agent run finished",
        "workspace: eip",
        `session: ${sessionId.slice(0, 8)}`,
        "title: Verify telegram hook",
        "status: Completed",
        "summary: Trusted transcript recap unavailable.",
        "elapsed: 5m 01s",
        "time: 2026-05-10T23:45:01.000Z",
      ].join("\n"),
    );
    assert.doesNotMatch(requests[0].text, /abc123/);
    assert.deepEqual(await listStateFiles(stateHome), []);
  } finally {
    await rm(stateHome, { force: true, recursive: true });
    await rm(externalRoot, { force: true, recursive: true });
    await rm(configHome, { force: true, recursive: true });
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("falls back to temp state when XDG_STATE_HOME points inside the workspace", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-workspace-"));
  const repoLocalStateHome = path.join(workspaceRoot, ".state");
  const sessionPayload = {
    cwd: workspaceRoot,
    session_id: "session-uses-temp-fallback",
    timestamp: "2026-05-10T23:40:00Z",
  };
  const metadata = sanitizeStopPayload(sessionPayload);
  const fallbackStateFile = path.join(os.tmpdir(), "eip-state", "eip", "telegram-hook", `${metadata.sessionKey}.json`);

  try {
    await rm(fallbackStateFile, { force: true });

    assert.deepEqual(
      await run({
        argv: ["start"],
        env: { XDG_STATE_HOME: repoLocalStateHome },
        stdin: jsonStream(sessionPayload),
      }),
      { delivered: false, reason: "state-recorded" },
    );

    assert.deepEqual(await listStateFiles(repoLocalStateHome), []);
    assert.equal(await fileExists(fallbackStateFile), true);

    assert.deepEqual(
      await run({
        argv: ["stop"],
        env: { XDG_STATE_HOME: repoLocalStateHome },
        stdin: jsonStream({
          ...sessionPayload,
          timestamp: "2026-05-10T23:45:01Z",
        }),
      }),
      { delivered: false, reason: "missing-config" },
    );

    assert.equal(await fileExists(fallbackStateFile), false);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(fallbackStateFile, { force: true });
  }
});

test("fails open on network errors and still cleans session state", async () => {
  const stateHome = await mkdtemp(path.join(os.tmpdir(), "notify-telegram-"));

  try {
    const env = {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      XDG_STATE_HOME: stateHome,
    };
    const sessionPayload = {
      cwd: "/home/qp/Cloud/Projects/eip",
      session_id: "session-1234-unsafe!",
      timestamp: "2026-05-10T23:40:00Z",
    };

    await run({
      argv: ["start"],
      env,
      stdin: jsonStream(sessionPayload),
    });

    const result = await run({
      argv: ["stop"],
      env,
      fetchImpl: async () => {
        throw new Error("network down");
      },
      stdin: jsonStream({
        ...sessionPayload,
        timestamp: "2026-05-10T23:45:01Z",
      }),
    });

    assert.deepEqual(result, { delivered: false, reason: "send-failed" });
    assert.deepEqual(await listStateFiles(stateHome), []);
  } finally {
    await rm(stateHome, { force: true, recursive: true });
  }
});