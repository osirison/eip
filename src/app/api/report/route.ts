import { NextResponse } from "next/server";
import { z } from "zod";

import { GitLabHttpError } from "@/lib/gitlab/client";
import { generateExecutiveReport } from "@/lib/gitlab/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  targetType: z.enum(["project", "group"]),
  targetId: z.string().trim().regex(/^\d+$/, "Use a numeric GitLab ID."),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid report request." },
      { status: 400 },
    );
  }

  try {
    const report = await generateExecutiveReport(parsed.data.targetType, parsed.data.targetId);
    return NextResponse.json({ report });
  } catch (error) {
    if (error instanceof GitLabHttpError) {
      if (error.status === 404) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }

      return NextResponse.json(
        { error: "GitLab returned an upstream error while generating the report." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { error: "The server could not generate a report right now." },
      { status: 500 },
    );
  }
}