import { NextResponse } from "next/server";

import { BackendHttpError } from "@/lib/backend/client";

export function respondToBackendError(
  error: unknown,
  options?: {
    upstreamMessage?: string;
    genericMessage?: string;
  },
) {
  if (error instanceof BackendHttpError) {
    if (error.status === 400 || error.status === 404 || error.status === 409) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error.status === 502) {
      return NextResponse.json(
        {
          error:
            options?.upstreamMessage ??
            "GitLab returned an upstream error while generating the report.",
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    {
      error: options?.genericMessage ?? "The server could not complete the request right now.",
    },
    { status: 500 },
  );
}
