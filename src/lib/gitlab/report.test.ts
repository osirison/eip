import { describe, expect, it } from "vitest";

import { getFixtureMergeRequests, getFixtureTarget } from "@/lib/gitlab/fixtures";
import { aggregateExecutiveReport } from "@/lib/gitlab/report";

describe("aggregateExecutiveReport", () => {
  it("builds high-signal KPIs and flags for a project report", () => {
    const report = aggregateExecutiveReport({
      target: getFixtureTarget("project", "1042"),
      mergeRequests: getFixtureMergeRequests("project"),
      dataSource: "fixture",
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    expect(report.kpis.mergeRequestsAnalyzed).toBe(9);
    expect(report.kpis.openMergeRequests).toBe(4);
    expect(report.kpis.mergedLast30Days).toBe(3);
    expect(report.kpis.medianMergeTimeHours).toBe(92.1);
    expect(report.summary[0]).toContain("4 of 9 analyzed merge requests are currently open");
    expect(report.attentionFlags.map((flag) => flag.kind)).toEqual([
      "stale",
      "oversized",
      "unreviewed",
    ]);
    expect(report.contributorRollup[0]?.username).toBe("avachen");
    expect(report.reviewerRollup[0]?.username).toBe("npatel");
  });

  it("returns a stable empty report when no merge requests are available", () => {
    const report = aggregateExecutiveReport({
      target: getFixtureTarget("group", "7"),
      mergeRequests: [],
      dataSource: "fixture",
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    expect(report.kpis.mergeRequestsAnalyzed).toBe(0);
    expect(report.reviewerRollup).toEqual([]);
    expect(report.attentionFlags).toEqual([]);
    expect(report.summary).toEqual([
      "No merge requests were returned for the selected target in the current analysis window.",
    ]);
  });
});