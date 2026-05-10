export type TargetType = "project" | "group";
export type DataSource = "live" | "fixture";

export interface GitLabPerson {
  id: number;
  name: string;
  username: string;
  webUrl?: string | null;
}

export interface GitLabTarget {
  id: string;
  type: TargetType;
  name: string;
  path: string;
  webUrl?: string | null;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  projectId: number;
  projectPath: string | null;
  title: string;
  webUrl: string;
  state: "opened" | "merged" | "closed" | "locked";
  draft: boolean;
  author: GitLabPerson;
  reviewers: GitLabPerson[];
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  changesCount: number | null;
}

export interface ReportKpis {
  mergeRequestsAnalyzed: number;
  openMergeRequests: number;
  mergedLast30Days: number;
  medianMergeTimeHours: number | null;
  activeAuthors: number;
  activeReviewers: number;
}

export interface ReportMergeRequestRow {
  id: number;
  title: string;
  webUrl: string;
  state: GitLabMergeRequest["state"];
  authorName: string;
  reviewerCount: number;
  changesCount: number | null;
  updatedAt: string;
  projectPath: string | null;
  stale: boolean;
  isOversized: boolean;
}

export interface ContributorRollupRow {
  name: string;
  username: string;
  authoredCount: number;
  mergedCount: number;
  openCount: number;
}

export interface ReviewerRollupRow {
  name: string;
  username: string;
  assignmentCount: number;
  openAssignmentCount: number;
  mergedAssignmentCount: number;
}

export interface ReportAttentionFlag {
  kind: "stale" | "oversized" | "unreviewed";
  title: string;
  description: string;
  severity: "medium" | "high";
  count: number;
  examples: string[];
}

export interface ReportWindow {
  mergeRequestsAnalyzed: number;
  label: string;
}

export interface ExecutiveReport {
  generatedAt: string;
  dataSource: DataSource;
  target: GitLabTarget;
  window: ReportWindow;
  kpis: ReportKpis;
  summary: string[];
  recentMergeRequests: ReportMergeRequestRow[];
  contributorRollup: ContributorRollupRow[];
  reviewerRollup: ReviewerRollupRow[];
  attentionFlags: ReportAttentionFlag[];
}