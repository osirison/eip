import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BackendHttpError,
  createAdHocReport,
  createPod,
  listPods,
} from "@/lib/backend/client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.EIP_BACKEND_BASE_URL;
});

describe("backend client", () => {
  it("normalizes the backend base URL and sends JSON bodies", async () => {
    process.env.EIP_BACKEND_BASE_URL = "http://backend.internal:8000/";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ report: { generatedAt: "2026-05-10T00:00:00.000Z" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createAdHocReport({ targetType: "project", targetId: "1042" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.internal:8000/v1/reports/ad-hoc",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ targetType: "project", targetId: "1042" }),
      }),
    );
  });

  it("extracts backend validation messages from FastAPI-style error payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: [{ msg: "Add at least one project or group target." }] }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(createPod({ name: "Pod", targets: [] })).rejects.toEqual(
      new BackendHttpError("Add at least one project or group target.", 400),
    );
  });

  it("supports list pods requests without a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pods: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPods()).resolves.toEqual({ pods: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/v1/pods",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
