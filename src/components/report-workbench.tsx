"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  FolderKanban,
  GitPullRequestArrow,
  LoaderCircle,
  ShieldAlert,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ExecutiveReport,
  ReportAttentionFlag,
  TargetType,
} from "@/lib/gitlab/types";
import { cn } from "@/lib/utils";

const requestHint: Record<TargetType, string> = {
  project: "Use a GitLab project ID to analyze a single repository flow.",
  group: "Use a GitLab group ID to analyze recent activity across a team or portfolio slice.",
};

export function ReportWorkbench() {
  const [targetType, setTargetType] = useState<TargetType>("project");
  const [targetId, setTargetId] = useState("");
  const [report, setReport] = useState<ExecutiveReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRequested, setHasRequested] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function requestReport(nextTargetType: TargetType, nextTargetId: string) {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetType: nextTargetType, targetId: nextTargetId }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { report: ExecutiveReport }
      | { error: string }
      | null;

    if (!response.ok) {
      throw new Error(payload && "error" in payload ? payload.error : "Unable to generate the report.");
    }

    if (!payload || !("report" in payload)) {
      throw new Error("The report response was incomplete.");
    }

    setReport(payload.report);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTargetId = targetId.trim();
    setHasRequested(true);
    setError(null);

    if (!/^\d+$/.test(trimmedTargetId)) {
      setReport(null);
      setError("Enter a numeric GitLab project or group ID.");
      return;
    }

    startTransition(() => {
      void requestReport(targetType, trimmedTargetId)
        .then(() => {
          setError(null);
        })
        .catch((nextError: unknown) => {
          setReport(null);
          setError(
            nextError instanceof Error ? nextError.message : "Unable to generate the report.",
          );
        });
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-primary/75">
            Engineering Intelligence Platform
          </p>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              GitLab executive reporting for a single project or group target.
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
              Generate a concise delivery snapshot from recent merge-request activity. The POC keeps
              GitLab access on the server and renders only executive-ready signals.
            </p>
          </div>
        </div>

        <Card className="border-border/70 bg-card/90 shadow-panel backdrop-blur">
          <CardHeader>
            <CardTitle>POC posture</CardTitle>
            <CardDescription>
              Fast, narrow delivery for GitLab reporting with clean seams for later platform
              extraction.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/70 p-4">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-primary" />
              <p>Secrets stay server-side. If credentials are unavailable, the app falls back to fixtures.</p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/70 p-4">
              <FolderKanban className="mt-0.5 h-4 w-4 text-primary" />
              <p>Use project IDs for repository-level reporting and group IDs for a broader portfolio slice.</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-border/70 bg-card/92 shadow-panel backdrop-blur">
          <CardHeader>
            <CardTitle>Generate a report</CardTitle>
            <CardDescription>
              Choose the GitLab target type, enter an ID, and generate a report over recent merge
              requests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Target type</p>
                <Tabs value={targetType} onValueChange={(value) => setTargetType(value as TargetType)}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="project">Project</TabsTrigger>
                    <TabsTrigger value="group">Group</TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-sm text-muted-foreground">{requestHint[targetType]}</p>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground" htmlFor="target-id">
                  GitLab ID
                </label>
                <Input
                  id="target-id"
                  inputMode="numeric"
                  placeholder={targetType === "project" ? "1042" : "7"}
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                />
              </div>

              <Button className="w-full justify-between" disabled={isPending} type="submit">
                <span>{isPending ? "Generating report" : "Generate report"}</span>
                {isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {!hasRequested && !report && !error ? (
          <IdleState />
        ) : isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : report ? (
          <ReportPanel report={report} />
        ) : (
          <IdleState />
        )}
      </section>
    </main>
  );
}

function IdleState() {
  return (
    <Card className="border-dashed border-border/80 bg-card/80 shadow-panel">
      <CardHeader>
        <CardTitle>Ready for report generation</CardTitle>
        <CardDescription>
          The report will summarize recent throughput, reviewer concentration, and merge-request risk
          signals.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
        <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
          <GitPullRequestArrow className="mb-3 h-5 w-5 text-primary" />
          <p className="font-medium text-foreground">Recent merge requests</p>
          <p className="mt-2">Review the freshest activity instead of digging through raw API output.</p>
        </div>
        <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
          <Users className="mb-3 h-5 w-5 text-primary" />
          <p className="font-medium text-foreground">Contributor and reviewer load</p>
          <p className="mt-2">Spot who is carrying delivery and review capacity inside the current window.</p>
        </div>
        <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
          <AlertTriangle className="mb-3 h-5 w-5 text-primary" />
          <p className="font-medium text-foreground">Attention flags</p>
          <p className="mt-2">Highlight stale, oversized, and unreviewed merge requests before they linger.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/90 shadow-panel">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton className="h-28 rounded-2xl" key={item} />
          ))}
        </CardContent>
      </Card>
      <Skeleton className="h-80 rounded-3xl" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40 bg-card/92 shadow-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Report generation failed
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Check the target ID and GitLab connectivity, then try again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground">
          {message}
        </div>
      </CardContent>
    </Card>
  );
}

function ReportPanel({ report }: { report: ExecutiveReport }) {
  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/92 shadow-panel">
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{report.target.type}</Badge>
              <Badge variant={report.dataSource === "fixture" ? "secondary" : "default"}>
                {report.dataSource === "fixture" ? "Fixture mode" : "Live GitLab"}
              </Badge>
            </div>
            <div>
              <CardTitle className="text-2xl">{report.target.name}</CardTitle>
              <CardDescription className="mt-1 text-sm">
                {report.target.path} · {report.window.label}
              </CardDescription>
            </div>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground md:text-right">
            <p>Generated {formatDateTime(report.generatedAt)}</p>
            {report.target.webUrl ? (
              <a href={report.target.webUrl} rel="noreferrer" target="_blank">
                Open target in GitLab
              </a>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          icon={GitPullRequestArrow}
          label="MRs analyzed"
          value={String(report.kpis.mergeRequestsAnalyzed)}
          detail="Recent activity window"
        />
        <MetricCard
          icon={Clock3}
          label="Open merge requests"
          value={String(report.kpis.openMergeRequests)}
          detail="Current open load"
        />
        <MetricCard
          icon={ArrowRight}
          label="Merged in 30d window"
          value={String(report.kpis.mergedLast30Days)}
          detail="Inside the current MR slice"
        />
        <MetricCard
          icon={FolderKanban}
          label="Median merge time"
          value={formatHours(report.kpis.medianMergeTimeHours)}
          detail="Created to merged"
        />
        <MetricCard
          icon={Users}
          label="Active reviewers"
          value={String(report.kpis.activeReviewers)}
          detail="Assigned in this window"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border/70 bg-card/92 shadow-panel">
          <CardHeader>
            <CardTitle>Executive summary</CardTitle>
            <CardDescription>Short signals derived from the recent activity window.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {report.summary.map((item) => (
                <li
                  className="rounded-2xl border border-border/75 bg-background/70 px-4 py-3 text-sm leading-6 text-foreground"
                  key={item}
                >
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/92 shadow-panel">
          <CardHeader>
            <CardTitle>Attention flags</CardTitle>
            <CardDescription>Simple risk signals that need human review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {report.attentionFlags.length > 0 ? (
              report.attentionFlags.map((flag) => <AttentionFlagCard flag={flag} key={flag.kind} />)
            ) : (
              <div className="rounded-2xl border border-border/80 bg-background/70 p-4 text-sm text-muted-foreground">
                No immediate attention flags were triggered in the current window.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-card/92 shadow-panel">
        <CardHeader>
          <CardTitle>Recent merge requests</CardTitle>
          <CardDescription>Most recently updated merge requests in the analysis window.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.recentMergeRequests.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merge request</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>Reviewers</TableHead>
                  <TableHead>Changes</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.recentMergeRequests.map((mergeRequest) => (
                  <TableRow key={mergeRequest.id}>
                    <TableCell className="min-w-[240px] align-top">
                      <div className="space-y-1">
                        <a href={mergeRequest.webUrl} rel="noreferrer" target="_blank">
                          {mergeRequest.title}
                        </a>
                        <div className="text-xs text-muted-foreground">
                          {mergeRequest.projectPath ?? "Single project target"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={stateVariant(mergeRequest.state)}>{mergeRequest.state}</Badge>
                        {mergeRequest.stale ? <Badge variant="secondary">stale</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>{mergeRequest.authorName}</TableCell>
                    <TableCell>{mergeRequest.reviewerCount}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "font-mono text-xs",
                          mergeRequest.isOversized ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {formatCount(mergeRequest.changesCount)}
                      </span>
                    </TableCell>
                    <TableCell>{formatDateShort(mergeRequest.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-border/80 bg-background/70 p-4 text-sm text-muted-foreground">
              No merge requests were available for this target in the current analysis window.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/70 bg-card/92 shadow-panel">
          <CardHeader>
            <CardTitle>Contributor rollup</CardTitle>
            <CardDescription>Authorship mix across the analyzed merge requests.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contributor</TableHead>
                  <TableHead>Authored</TableHead>
                  <TableHead>Merged</TableHead>
                  <TableHead>Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.contributorRollup.map((contributor) => (
                  <TableRow key={contributor.username}>
                    <TableCell>
                      <div>
                        <div>{contributor.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          @{contributor.username}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{contributor.authoredCount}</TableCell>
                    <TableCell>{contributor.mergedCount}</TableCell>
                    <TableCell>{contributor.openCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/92 shadow-panel">
          <CardHeader>
            <CardTitle>Reviewer rollup</CardTitle>
            <CardDescription>Review capacity concentration inside the same analysis window.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Assignments</TableHead>
                  <TableHead>Open</TableHead>
                  <TableHead>Merged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.reviewerRollup.map((reviewer) => (
                  <TableRow key={reviewer.username}>
                    <TableCell>
                      <div>
                        <div>{reviewer.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">@{reviewer.username}</div>
                      </div>
                    </TableCell>
                    <TableCell>{reviewer.assignmentCount}</TableCell>
                    <TableCell>{reviewer.openAssignmentCount}</TableCell>
                    <TableCell>{reviewer.mergedAssignmentCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AttentionFlagCard({ flag }: { flag: ReportAttentionFlag }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">{flag.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{flag.description}</p>
        </div>
        <Badge variant={flag.severity === "high" ? "destructive" : "secondary"}>{flag.count}</Badge>
      </div>
      {flag.examples.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {flag.examples.map((example) => (
            <Badge key={example} variant="outline">
              {example}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="border-border/70 bg-card/92 shadow-panel">
      <CardContent className="flex h-full flex-col justify-between gap-6 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
          </div>
          <div className="rounded-2xl bg-secondary p-2 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function formatDateShort(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatHours(value: number | null) {
  if (value === null) {
    return "—";
  }

  if (value < 24) {
    return `${value.toFixed(1)}h`;
  }

  return `${(value / 24).toFixed(1)}d`;
}

function formatCount(value: number | null) {
  return value === null ? "—" : value.toLocaleString();
}

function stateVariant(state: string): "default" | "secondary" | "outline" {
  if (state === "merged") {
    return "default";
  }

  if (state === "opened") {
    return "secondary";
  }

  return "outline";
}