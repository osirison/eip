import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/report/route";

const fixtureReport = {
  generatedAt: "2026-05-10T00:00:00.000Z",
  dataSource: "fixture",
  target: {
    id: "1042",
    type: "project",
    name: "Payments Platform",
    path: "platform/payments",
    webUrl: "https://gitlab.example.com/platform/payments",
  },
  window: {
    mergeRequestsAnalyzed: 0,
    label: "Last 0 merge requests analyzed",
  },
  kpis: {
    mergeRequestsAnalyzed: 0,
    openMergeRequests: 0,
    mergedLast30Days: 0,
    medianMergeTimeHours: null,
    activeAuthors: 0,
    activeReviewers: 0,
  },
  summary: [],
  recentMergeRequests: [],
  contributorRollup: [],
  reviewerRollup: [],
  attentionFlags: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.EIP_BACKEND_BASE_URL;
});

describe("POST /api/report", () => {
  it("validates the request body before reaching the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/report", {
        method: "POST",
        body: JSON.stringify({ targetType: "project", targetId: "abc" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({ error: "Use a numeric GitLab ID." });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies successful ad-hoc reports to the backend service", async () => {
    process.env.EIP_BACKEND_BASE_URL = "http://backend.internal:9100/";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ report: fixtureReport }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/report", {
        method: "POST",
        body: JSON.stringify({ targetType: "project", targetId: "1042" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({ report: fixtureReport });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.internal:9100/v1/reports/ad-hoc",
      expect.objectContaining({
        body: JSON.stringify({ targetType: "project", targetId: "1042" }),
        cache: "no-store",
        method: "POST",
      }),
    );
  });

  it("preserves not-found errors from the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "The GitLab target was not found." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/report", {
        method: "POST",
        body: JSON.stringify({ targetType: "group", targetId: "7" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({ error: "The GitLab target was not found." });
    expect(response.status).toBe(404);
  });

  it("translates backend upstream failures into the legacy 502 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "GitLab upstream failed." }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/report", {
        method: "POST",
        body: JSON.stringify({ targetType: "project", targetId: "1042" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "GitLab returned an upstream error while generating the report.",
    });
    expect(response.status).toBe(502);
  });

  it("fails closed when the backend returns an incomplete success payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/report", {
        method: "POST",
        body: JSON.stringify({ targetType: "project", targetId: "1042" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "The server could not generate a report right now.",
    });
    expect(response.status).toBe(500);
  });
});