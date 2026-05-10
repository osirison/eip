import { NextResponse } from "next/server";

import { getPod } from "@/lib/backend/client";
import { respondToBackendError } from "@/lib/backend/route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ podId: string }> },
) {
  const { podId } = await context.params;

  try {
    return NextResponse.json(await getPod(podId));
  } catch (error) {
    return respondToBackendError(error, {
      genericMessage: "The server could not load this pod right now.",
    });
  }
}
