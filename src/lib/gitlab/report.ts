import type {
  ContributorRollupRow,
  DataSource,
  ExecutiveReport,
  GitLabMergeRequest,
  GitLabTarget,
  ReportAttentionFlag,
  ReviewerRollupRow,
} from "@/lib/gitlab/types";

export const ANALYSIS_LIMIT = 25;
export const STALE_DAYS_THRESHOLD = 7;
export const OVERSIZED_CHANGES_THRESHOLD = 800;

export function aggregateExecutiveReport({
  target,
  mergeRequests,
  dataSource,
  now = new Date(),
}: {
  target: GitLabTarget;
  mergeRequests: GitLabMergeRequest[];
  dataSource: DataSource;
  now?: Date;
}): ExecutiveReport {
  const sortedMergeRequests = [...mergeRequests].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );

  const openMergeRequests = sortedMergeRequests.filter((mergeRequest) => mergeRequest.state === "opened");
  const mergedMergeRequests = sortedMergeRequests.filter(
    (mergeRequest) => mergeRequest.state === "merged" && mergeRequest.mergedAt,
  );
  const staleCutoff = now.getTime() - STALE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
  const thirtyDayCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const staleMergeRequests = openMergeRequests.filter(
    (mergeRequest) => Date.parse(mergeRequest.updatedAt) <= staleCutoff,
  );
  const oversizedMergeRequests = sortedMergeRequests.filter(
    (mergeRequest) => (mergeRequest.changesCount ?? 0) >= OVERSIZED_CHANGES_THRESHOLD,
  );
  const unreviewedMergeRequests = openMergeRequests.filter(
    (mergeRequest) => mergeRequest.reviewers.length === 0,
  );

  const mergedLast30Days = mergedMergeRequests.filter(
    (mergeRequest) => Date.parse(mergeRequest.mergedAt ?? "") >= thirtyDayCutoff,
  );

  const contributorRollup = buildContributorRollup(sortedMergeRequests);
  const reviewerRollup = buildReviewerRollup(sortedMergeRequests);
  const medianMergeTimeHours = median(
    mergedMergeRequests
      .map((mergeRequest) => {
        if (!mergeRequest.mergedAt) {
          return null;
        }

        return (
          (Date.parse(mergeRequest.mergedAt) - Date.parse(mergeRequest.createdAt)) /
          (1000 * 60 * 60)
        );
      })
      .filter((value): value is number => value !== null && Number.isFinite(value)),
  );

  const attentionFlags = buildAttentionFlags({
    staleMergeRequests,
    oversizedMergeRequests,
    unreviewedMergeRequests,
  });

  return {
    generatedAt: now.toISOString(),
    dataSource,
    target,
    window: {
      mergeRequestsAnalyzed: sortedMergeRequests.length,
      label: `Last ${sortedMergeRequests.length} merge requests analyzed`,
    },
    kpis: {
      mergeRequestsAnalyzed: sortedMergeRequests.length,
      openMergeRequests: openMergeRequests.length,
      mergedLast30Days: mergedLast30Days.length,
      medianMergeTimeHours,
      activeAuthors: contributorRollup.length,
      activeReviewers: reviewerRollup.length,
    },
    summary: buildExecutiveSummary({
      totalCount: sortedMergeRequests.length,
      openCount: openMergeRequests.length,
      staleCount: staleMergeRequests.length,
      mergedLast30DaysCount: mergedLast30Days.length,
      medianMergeTimeHours,
      topContributor: contributorRollup[0],
      topReviewer: reviewerRollup[0],
      oversizedCount: oversizedMergeRequests.length,
    }),
    recentMergeRequests: sortedMergeRequests.slice(0, 8).map((mergeRequest) => ({
      id: mergeRequest.id,
      title: mergeRequest.title,
      webUrl: mergeRequest.webUrl,
      state: mergeRequest.state,
      authorName: mergeRequest.author.name,
      reviewerCount: mergeRequest.reviewers.length,
      changesCount: mergeRequest.changesCount,
      updatedAt: mergeRequest.updatedAt,
      projectPath: mergeRequest.projectPath,
      stale: staleMergeRequests.some((staleMergeRequest) => staleMergeRequest.id === mergeRequest.id),
      isOversized: oversizedMergeRequests.some(
        (oversizedMergeRequest) => oversizedMergeRequest.id === mergeRequest.id,
      ),
    })),
    contributorRollup,
    reviewerRollup,
    attentionFlags,
  };
}

function buildContributorRollup(mergeRequests: GitLabMergeRequest[]): ContributorRollupRow[] {
  const contributors = new Map<string, ContributorRollupRow>();

  for (const mergeRequest of mergeRequests) {
    const key = mergeRequest.author.username;
    const contributor = contributors.get(key) ?? {
      name: mergeRequest.author.name,
      username: mergeRequest.author.username,
      authoredCount: 0,
      mergedCount: 0,
      openCount: 0,
    };

    contributor.authoredCount += 1;

    if (mergeRequest.state === "merged") {
      contributor.mergedCount += 1;
    }

    if (mergeRequest.state === "opened") {
      contributor.openCount += 1;
    }

    contributors.set(key, contributor);
  }

  return [...contributors.values()].sort((left, right) => {
    if (right.authoredCount !== left.authoredCount) {
      return right.authoredCount - left.authoredCount;
    }

    return left.name.localeCompare(right.name);
  });
}

function buildReviewerRollup(mergeRequests: GitLabMergeRequest[]): ReviewerRollupRow[] {
  const reviewers = new Map<string, ReviewerRollupRow>();

  for (const mergeRequest of mergeRequests) {
    for (const reviewer of mergeRequest.reviewers) {
      const key = reviewer.username;
      const reviewerRollup = reviewers.get(key) ?? {
        name: reviewer.name,
        username: reviewer.username,
        assignmentCount: 0,
        openAssignmentCount: 0,
        mergedAssignmentCount: 0,
      };

      reviewerRollup.assignmentCount += 1;

      if (mergeRequest.state === "opened") {
        reviewerRollup.openAssignmentCount += 1;
      }

      if (mergeRequest.state === "merged") {
        reviewerRollup.mergedAssignmentCount += 1;
      }

      reviewers.set(key, reviewerRollup);
    }
  }

  return [...reviewers.values()].sort((left, right) => {
    if (right.assignmentCount !== left.assignmentCount) {
      return right.assignmentCount - left.assignmentCount;
    }

    return left.name.localeCompare(right.name);
  });
}

function buildAttentionFlags({
  staleMergeRequests,
  oversizedMergeRequests,
  unreviewedMergeRequests,
}: {
  staleMergeRequests: GitLabMergeRequest[];
  oversizedMergeRequests: GitLabMergeRequest[];
  unreviewedMergeRequests: GitLabMergeRequest[];
}): ReportAttentionFlag[] {
  const flags: ReportAttentionFlag[] = [];

  if (staleMergeRequests.length > 0) {
    flags.push({
      kind: "stale",
      title: "Stale open merge requests",
      description: `${staleMergeRequests.length} open merge requests have been idle for ${STALE_DAYS_THRESHOLD}+ days.`,
      severity: staleMergeRequests.length >= 2 ? "high" : "medium",
      count: staleMergeRequests.length,
      examples: staleMergeRequests.slice(0, 3).map((mergeRequest) => mergeRequest.title),
    });
  }

  if (oversizedMergeRequests.length > 0) {
    flags.push({
      kind: "oversized",
      title: "Oversized change sets",
      description: `${oversizedMergeRequests.length} merge requests exceed ${OVERSIZED_CHANGES_THRESHOLD.toLocaleString()} changed lines.`,
      severity: oversizedMergeRequests.length >= 2 ? "high" : "medium",
      count: oversizedMergeRequests.length,
      examples: oversizedMergeRequests.slice(0, 3).map((mergeRequest) => mergeRequest.title),
    });
  }

  if (unreviewedMergeRequests.length > 0) {
    flags.push({
      kind: "unreviewed",
      title: "Open merge requests without reviewers",
      description: `${unreviewedMergeRequests.length} open merge requests do not currently list a reviewer.`,
      severity: unreviewedMergeRequests.length >= 2 ? "high" : "medium",
      count: unreviewedMergeRequests.length,
      examples: unreviewedMergeRequests.slice(0, 3).map((mergeRequest) => mergeRequest.title),
    });
  }

  return flags;
}

function buildExecutiveSummary({
  totalCount,
  openCount,
  staleCount,
  mergedLast30DaysCount,
  medianMergeTimeHours,
  topContributor,
  topReviewer,
  oversizedCount,
}: {
  totalCount: number;
  openCount: number;
  staleCount: number;
  mergedLast30DaysCount: number;
  medianMergeTimeHours: number | null;
  topContributor?: ContributorRollupRow;
  topReviewer?: ReviewerRollupRow;
  oversizedCount: number;
}) {
  if (totalCount === 0) {
    return ["No merge requests were returned for the selected target in the current analysis window."];
  }

  const summary = [
    `${openCount} of ${totalCount} analyzed merge requests are currently open, with ${staleCount} already idle beyond ${STALE_DAYS_THRESHOLD} days.`,
    `${mergedLast30DaysCount} merge requests were merged in the last 30 days within the current analysis window${
      medianMergeTimeHours === null ? "." : ` and the median merge time is ${formatHours(medianMergeTimeHours)}.`
    }`,
  ];

  if (topContributor) {
    summary.push(
      `${topContributor.name} authored the highest volume in this window with ${topContributor.authoredCount} merge requests.`,
    );
  }

  if (topReviewer) {
    summary.push(
      `${topReviewer.name} carries the heaviest review load with ${topReviewer.assignmentCount} assignments in the current window.`,
    );
  }

  if (oversizedCount > 0) {
    summary.push(
      `${oversizedCount} large merge requests may be increasing review and merge risk because they exceed the oversized-change threshold.`,
    );
  }

  return summary;
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 0) {
    return Number(((sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2).toFixed(1));
  }

  return Number(sortedValues[middleIndex].toFixed(1));
}

function formatHours(value: number) {
  if (value < 24) {
    return `${value.toFixed(1)} hours`;
  }

  return `${(value / 24).toFixed(1)} days`;
}