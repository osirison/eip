import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/pods/route";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.EIP_BACKEND_BASE_URL;
});

describe("/api/pods", () => {
  it("lists pods through the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            pods: [
              {
                id: "pod-1",
                slug: "platform-foundation",
                name: "Platform Foundation",
                description: "Core platform delivery",
                createdAt: "2026-05-10T00:00:00.000Z",
                updatedAt: "2026-05-10T00:00:00.000Z",
                targetCount: 3,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pods: [
        {
          id: "pod-1",
          slug: "platform-foundation",
          name: "Platform Foundation",
          description: "Core platform delivery",
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
          targetCount: 3,
        },
      ],
    });
  });

  it("validates pod creation requests before reaching the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/pods", {
        method: "POST",
        body: JSON.stringify({ name: "", targets: [] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Enter a pod name." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates pods through the backend service", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pod: {
            id: "pod-2",
            slug: "reliability",
            name: "Reliability",
            description: "Reliability slice",
            createdAt: "2026-05-10T00:00:00.000Z",
            updatedAt: "2026-05-10T00:00:00.000Z",
            targetCount: 2,
            targets: [
              {
                id: "target-1",
                targetType: "project",
                targetId: "1042",
                displayOrder: 0,
              },
              {
                id: "target-2",
                targetType: "group",
                targetId: "7",
                displayOrder: 1,
              },
            ],
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/pods", {
        method: "POST",
        body: JSON.stringify({
          name: "Reliability",
          description: "Reliability slice",
          targets: [
            { targetType: "project", targetId: "1042" },
            { targetType: "group", targetId: "7" },
          ],
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      pod: {
        id: "pod-2",
        slug: "reliability",
        name: "Reliability",
        description: "Reliability slice",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
        targetCount: 2,
        targets: [
          {
            id: "target-1",
            targetType: "project",
            targetId: "1042",
            displayOrder: 0,
          },
          {
            id: "target-2",
            targetType: "group",
            targetId: "7",
            displayOrder: 1,
          },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves backend conflict responses for duplicate pod slugs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "A pod with this slug already exists." }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/pods", {
        method: "POST",
        body: JSON.stringify({
          name: "Reliability",
          slug: "platform-foundation",
          targets: [{ targetType: "project", targetId: "1042" }],
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "A pod with this slug already exists.",
    });
  });
});
