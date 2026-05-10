import { NextResponse } from "next/server";
import { z } from "zod";

import { createPod, listPods } from "@/lib/backend/client";
import { respondToBackendError } from "@/lib/backend/route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createPodSchema = z.object({
  name: z.string().trim().min(1, "Enter a pod name."),
  slug: z.string().trim().min(1, "Enter a pod slug.").max(80).optional(),
  description: z.string().trim().max(500).optional(),
  targets: z
    .array(
      z.object({
        targetType: z.enum(["project", "group"]),
        targetId: z.string().trim().regex(/^\d+$/, "Use numeric GitLab target IDs."),
      }),
    )
    .min(1, "Add at least one project or group target."),
});

export async function GET() {
  try {
    return NextResponse.json(await listPods());
  } catch (error) {
    return respondToBackendError(error, {
      genericMessage: "The server could not load pods right now.",
    });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createPodSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid pod request." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await createPod(parsed.data), { status: 201 });
  } catch (error) {
    return respondToBackendError(error, {
      genericMessage: "The server could not create the pod right now.",
    });
  }
}
