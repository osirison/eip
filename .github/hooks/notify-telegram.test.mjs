import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
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

test("stop hook registration uses the documented shell schema", async () => {
  const config = JSON.parse(
    await readFile(new URL("./stop-telegram.json", import.meta.url), "utf8"),
  );

  assert.equal(config.version, 1);
  assert.ok(Array.isArray(config.hooks?.Stop));
  assert.equal(config.hooks.Stop.length, 1);
  assert.equal(config.hooks.Stop[0].bash, "node .github/hooks/notify-telegram.mjs");
  assert.equal(config.hooks.Stop[0].powershell, "node .github/hooks/notify-telegram.mjs");
  assert.equal(config.hooks.Stop[0].timeoutSec, 5);
  assert.ok(!("command" in config.hooks.Stop[0]));
  assert.ok(!("timeout" in config.hooks.Stop[0]));
  assert.ok(!("type" in config.hooks.Stop[0]));
});

test("returns a fast no-op when local Telegram env is missing", async () => {
  const result = await run({
    env: {},
    fetchImpl: () => {
      throw new Error("fetch should not run");
    },
    stdin: jsonStream({ cwd: "/tmp/eip" }),
  });

  assert.deepEqual(result, { delivered: false, reason: "missing-config" });
});

test("skips duplicate stop notifications when stop_hook_active is true", async () => {
  const result = await run({
    env: {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
    },
    fetchImpl: () => {
      throw new Error("fetch should not run");
    },
    stdin: jsonStream({ stop_hook_active: true }),
  });

  assert.deepEqual(result, { delivered: false, reason: "stop-hook-active" });
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
    timestamp: "2026-05-10T23:45:01.000Z",
    stopHookActive: false,
  });
  assert.equal(
    buildTelegramMessage(metadata),
    "VS Code agent run finished | workspace=eip | time=2026-05-10T23:45:01.000Z | session=session-",
  );
});

test("accepts a legacy camelCase sessionId defensively", () => {
  const metadata = sanitizeStopPayload({ sessionId: "legacy-1234-unsafe!" });

  assert.equal(metadata.sessionId, "legacy-1");
});

test("posts only minimal sanitized metadata to Telegram", async () => {
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
    const result = await run({
      env: {
        TELEGRAM_API_BASE_URL: `http://127.0.0.1:${address.port}`,
        TELEGRAM_BOT_TOKEN: "123:abc",
        TELEGRAM_CHAT_ID: "456",
      },
      stdin: jsonStream({
        cwd: "/home/qp/Cloud/Projects/eip",
        session_id: "session-1234-unsafe!",
        timestamp: "2026-05-10T23:45:01Z",
        transcript_path: "/tmp/raw-payload.json",
      }),
    });

    assert.deepEqual(result, { delivered: true, reason: "sent" });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      body: {
        chat_id: "456",
        disable_notification: true,
        text: "VS Code agent run finished | workspace=eip | time=2026-05-10T23:45:01.000Z | session=session-",
      },
      method: "POST",
      url: "/bot123:abc/sendMessage",
    });
    assert.ok(!requests[0].body.text.includes("/home/qp/Cloud/Projects/eip"));
    assert.ok(!requests[0].body.text.includes("raw-payload"));
  } finally {
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

test("fails open on network errors", async () => {
  const result = await run({
    env: {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
    },
    fetchImpl: async () => {
      throw new Error("network down");
    },
    stdin: jsonStream({ cwd: "/tmp/eip" }),
  });

  assert.deepEqual(result, { delivered: false, reason: "send-failed" });
});