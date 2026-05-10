export type TargetType = "project" | "group";
export type ReportTargetType = TargetType | "pod";
export type DataSource = "live" | "fixture";
export type ReviewerRisk = "balanced" | "watch" | "high";

export interface GitLabPerson {
  id: number;
  name: string;
  username: string;
  webUrl?: string | null;
}

export interface GitLabTarget {
  id: string;
  type: ReportTargetType;
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
  activeProjects: number;
}

export interface ReportMergeRequestRow {
  id: number;
  iid: number;
  title: string;
  webUrl: string;
  state: GitLabMergeRequest["state"];
  authorName: string;
  reviewerCount: number;
  reviewerNames: string[];
  changesCount: number | null;
  updatedAt: string;
  createdAt: string;
  ageDays: number;
  projectPath: string | null;
  stale: boolean;
  isOversized: boolean;
  draft: boolean;
  unreviewed: boolean;
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
  concentrationShare: number;
  isOverloaded: boolean;
}

export interface ReportAttentionFlag {
  kind: "stale" | "oversized" | "unreviewed" | "reviewer-concentration";
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

export interface OpenQueue {
  total: number;
  stale: number;
  draft: number;
  oversized: number;
  unreviewed: number;
}

export interface ProjectBreakdownRow {
  projectId: number;
  projectPath: string;
  mergeRequestsAnalyzed: number;
  openMergeRequests: number;
  staleMergeRequests: number;
  mergedLast30Days: number;
  medianMergeTimeHours: number | null;
  activeAuthors: number;
  activeReviewers: number;
}

export interface TargetCoverageItem {
  id: string;
  type: TargetType;
  name: string;
  path: string;
  resolved: boolean;
  mergeRequestsAnalyzed: number;
  deduplicatedMergeRequests: number;
  error?: string | null;
}

export interface TargetCoverage {
  requestedTargetCount: number;
  resolvedTargetCount: number;
  projectsRepresented: number;
  partialFailure: boolean;
  deduplicatedMergeRequests: number;
  items: TargetCoverageItem[];
}

export interface ReviewerLoadSignal {
  topReviewerName: string | null;
  topReviewerShare: number;
  risk: ReviewerRisk;
  overloadedReviewers: string[];
  summary: string;
}

export interface PodTargetInput {
  targetType: TargetType;
  targetId: string;
}

export interface PodTarget extends PodTargetInput {
  id: string;
  displayOrder: number;
}

export interface PodSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  targetCount: number;
}

export interface PodDetail extends PodSummary {
  targets: PodTarget[];
}

export interface CreatePodRequest {
  name: string;
  slug?: string;
  description?: string;
  targets: PodTargetInput[];
}

export interface ExecutiveReport {
  generatedAt: string;
  dataSource: DataSource;
  target: GitLabTarget;
  window: ReportWindow;
  kpis: ReportKpis;
  summary: string[];
  openQueue: OpenQueue;
  recentMergeRequests: ReportMergeRequestRow[];
  staleOpenMergeRequests: ReportMergeRequestRow[];
  projectBreakdown: ProjectBreakdownRow[];
  contributorRollup: ContributorRollupRow[];
  reviewerRollup: ReviewerRollupRow[];
  reviewerLoadSignal: ReviewerLoadSignal;
  attentionFlags: ReportAttentionFlag[];
  targetCoverage: TargetCoverage;
}