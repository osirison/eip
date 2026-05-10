import { NextResponse } from "next/server";

import { createPodReport } from "@/lib/backend/client";
import { respondToBackendError } from "@/lib/backend/route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ podId: string }> },
) {
  const { podId } = await context.params;

  try {
    return NextResponse.json(await createPodReport(podId));
  } catch (error) {
    return respondToBackendError(error, {
      genericMessage: "The server could not generate a pod report right now.",
    });
  }
}
