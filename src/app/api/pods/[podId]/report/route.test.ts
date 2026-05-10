import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/pods/[podId]/report/route";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/pods/[podId]/report", () => {
  it("returns pod reports from the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            report: {
              generatedAt: "2026-05-10T00:00:00.000Z",
              dataSource: "fixture",
              target: {
                id: "pod-1",
                type: "pod",
                name: "Platform Foundation",
                path: "platform-foundation",
                webUrl: null,
              },
              window: { mergeRequestsAnalyzed: 0, label: "Last 0 merge requests analyzed" },
              kpis: {
                mergeRequestsAnalyzed: 0,
                openMergeRequests: 0,
                mergedLast30Days: 0,
                medianMergeTimeHours: null,
                activeAuthors: 0,
                activeReviewers: 0,
                activeProjects: 0,
              },
              summary: [],
              openQueue: { total: 0, stale: 0, draft: 0, oversized: 0, unreviewed: 0 },
              recentMergeRequests: [],
              staleOpenMergeRequests: [],
              projectBreakdown: [],
              contributorRollup: [],
              reviewerRollup: [],
              reviewerLoadSignal: {
                topReviewerName: null,
                topReviewerShare: 0,
                risk: "balanced",
                overloadedReviewers: [],
                summary: "No reviewer assignments were found in the current analysis window.",
              },
              attentionFlags: [],
              targetCoverage: {
                requestedTargetCount: 0,
                resolvedTargetCount: 0,
                projectsRepresented: 0,
                partialFailure: false,
                deduplicatedMergeRequests: 0,
                items: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await POST(new Request("http://localhost/api/pods/pod-1/report"), {
      params: Promise.resolve({ podId: "pod-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      report: {
        target: { type: "pod", name: "Platform Foundation" },
        targetCoverage: { partialFailure: false },
      },
    });
  });

  it("maps backend upstream failures to a stable pod-report error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "GitLab upstream failed." }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const response = await POST(new Request("http://localhost/api/pods/missing/report"), {
      params: Promise.resolve({ podId: "missing" }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "GitLab returned an upstream error while generating the report.",
    });
  });
});
