import "server-only";

import { getGitLabRuntimeConfig } from "@/lib/env";

import { fetchGitLabTarget, fetchRecentGitLabMergeRequests } from "@/lib/gitlab/client";
import { getFixtureMergeRequests, getFixtureTarget } from "@/lib/gitlab/fixtures";
import { ANALYSIS_LIMIT, aggregateExecutiveReport } from "@/lib/gitlab/report";
import type { ExecutiveReport, TargetType } from "@/lib/gitlab/types";

export async function generateExecutiveReport(
  targetType: TargetType,
  targetId: string,
): Promise<ExecutiveReport> {
  const runtimeConfig = getGitLabRuntimeConfig();

  if (runtimeConfig.useFixtures) {
    return aggregateExecutiveReport({
      target: getFixtureTarget(targetType, targetId),
      mergeRequests: getFixtureMergeRequests(targetType).slice(0, ANALYSIS_LIMIT),
      dataSource: "fixture",
    });
  }

  const target = await fetchGitLabTarget(targetType, targetId);
  const mergeRequests = await fetchRecentGitLabMergeRequests({
    targetType,
    targetId,
    targetPath: target.path,
    limit: ANALYSIS_LIMIT,
  });

  return aggregateExecutiveReport({
    target,
    mergeRequests,
    dataSource: "live",
  });
}