import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/pods/[podId]/route";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/pods/[podId]", () => {
  it("loads pod details through the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            pod: {
              id: "pod-1",
              slug: "platform-foundation",
              name: "Platform Foundation",
              description: "Core platform delivery",
              createdAt: "2026-05-10T00:00:00.000Z",
              updatedAt: "2026-05-10T00:00:00.000Z",
              targetCount: 3,
              targets: [
                {
                  id: "target-1",
                  targetType: "group",
                  targetId: "7",
                  displayOrder: 0,
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await GET(new Request("http://localhost/api/pods/pod-1"), {
      params: Promise.resolve({ podId: "pod-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pod: {
        id: "pod-1",
        slug: "platform-foundation",
        name: "Platform Foundation",
        description: "Core platform delivery",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
        targetCount: 3,
        targets: [
          {
            id: "target-1",
            targetType: "group",
            targetId: "7",
            displayOrder: 0,
          },
        ],
      },
    });
  });

  it("preserves backend not-found responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "The requested pod was not found." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const response = await GET(new Request("http://localhost/api/pods/missing"), {
      params: Promise.resolve({ podId: "missing" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "The requested pod was not found.",
    });
  });
});
