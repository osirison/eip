"use client";

import { useEffect, useState, useTransition } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  FolderKanban,
  GitPullRequestArrow,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Target,
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
import type {
  ContributorRollupRow,
  CreatePodRequest,
  ExecutiveReport,
  PodDetail,
  PodSummary,
  ProjectBreakdownRow,
  ReportAttentionFlag,
  ReportMergeRequestRow,
  ReviewerRollupRow,
  TargetCoverageItem,
  TargetType,
} from "@/lib/gitlab/types";
import { cn } from "@/lib/utils";

interface PodsResponse {
  pods: PodSummary[];
}

interface PodResponse {
  pod: PodDetail;
}

interface ReportResponse {
  report: ExecutiveReport;
}

type ActiveScope =
  | { kind: "pod"; podId: string }
  | { kind: "ad-hoc"; targetType: TargetType; targetId: string }
  | null;

const requestHint: Record<TargetType, string> = {
  project: "Run an ad-hoc check for a single repository delivery stream.",
  group: "Run an ad-hoc rollup across the most recent group activity window.",
};

const sectionLinks: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "pods", label: "Pods", icon: FolderKanban },
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "attention", label: "Attention", icon: AlertTriangle },
  { id: "targets", label: "Targets", icon: Target },
  { id: "merge-requests", label: "Merge Requests", icon: GitPullRequestArrow },
  { id: "contributors", label: "Contributors", icon: Users },
  { id: "reviewers", label: "Reviewers", icon: ShieldCheck },
];

export function ReportWorkbench() {
  const [pods, setPods] = useState<PodSummary[]>([]);
  const [selectedPod, setSelectedPod] = useState<PodDetail | null>(null);
  const [activeScope, setActiveScope] = useState<ActiveScope>(null);
  const [report, setReport] = useState<ExecutiveReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [targetType, setTargetType] = useState<TargetType>("project");
  const [targetId, setTargetId] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    projectIds: "",
    groupIds: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const podList = await fetchPods();
        if (cancelled) {
          return;
        }

        setPods(podList.pods);
        if (podList.pods.length === 0) {
          setIsCreateOpen(true);
          return;
        }

        const firstPodId = podList.pods[0]?.id;
        if (!firstPodId) {
          return;
        }

        const podWorkspace = await fetchPodWorkspace(firstPodId);
        if (cancelled) {
          return;
        }

        setSelectedPod(podWorkspace.pod);
        setReport(podWorkspace.report);
        setActiveScope({ kind: "pod", podId: firstPodId });
        setError(null);
      } catch (nextError) {
        if (!cancelled) {
          setError(getErrorMessage(nextError, "Unable to load pods and reports right now."));
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  function handlePodSelect(podId: string) {
    setError(null);

    startTransition(() => {
      void fetchPodWorkspace(podId)
        .then((podWorkspace) => {
          setSelectedPod(podWorkspace.pod);
          setReport(podWorkspace.report);
          setActiveScope({ kind: "pod", podId });
        })
        .catch((nextError: unknown) => {
          setError(getErrorMessage(nextError, "Unable to load the selected pod."));
        });
    });
  }

  function handleAdHocSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTargetId = targetId.trim();
    if (!/^\d+$/.test(trimmedTargetId)) {
      setError("Enter a numeric GitLab project or group ID.");
      return;
    }

    setError(null);

    startTransition(() => {
      void fetchAdHocReport(targetType, trimmedTargetId)
        .then((nextReport) => {
          setReport(nextReport.report);
          setActiveScope({ kind: "ad-hoc", targetType, targetId: trimmedTargetId });
        })
        .catch((nextError: unknown) => {
          setError(getErrorMessage(nextError, "Unable to generate the report."));
        });
    });
  }

  function handleCreatePod(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const projectIds = splitTargetIds(createForm.projectIds);
    const groupIds = splitTargetIds(createForm.groupIds);

    if (!createForm.name.trim()) {
      setCreateError("Enter a pod name.");
      return;
    }

    if (projectIds.length === 0 && groupIds.length === 0) {
      setCreateError("Add at least one project or group target.");
      return;
    }

    const request: CreatePodRequest = {
      name: createForm.name.trim(),
      description: createForm.description.trim() || undefined,
      targets: [
        ...projectIds.map((targetIdValue) => ({ targetType: "project" as const, targetId: targetIdValue })),
        ...groupIds.map((targetIdValue) => ({ targetType: "group" as const, targetId: targetIdValue })),
      ],
    };

    setCreateError(null);
    setError(null);

    startTransition(() => {
      void createPodWorkspace(request)
        .then(({ pods: nextPods, pod, report: nextReport }) => {
          setPods(nextPods);
          setSelectedPod(pod);
          setReport(nextReport);
          setActiveScope({ kind: "pod", podId: pod.id });
          setCreateForm({ name: "", description: "", projectIds: "", groupIds: "" });
          setIsCreateOpen(false);
        })
        .catch((nextError: unknown) => {
          setCreateError(getErrorMessage(nextError, "Unable to create the pod right now."));
        });
    });
  }

  const activePodId = activeScope?.kind === "pod" ? activeScope.podId : null;

  return (
    <main className="min-h-screen">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-white/10 bg-slate-950 text-slate-100 lg:sticky lg:top-0 lg:h-screen lg:w-[19rem] lg:border-b-0 lg:border-r">
          <div className="border-b border-white/10 px-6 py-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-orange-300/90">
              Engineering Intelligence Platform
            </p>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">
              GitLab Delivery Intelligence
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Pods, groups, and projects in one operating view with server-side GitLab access only.
            </p>
          </div>

          <div className="space-y-6 overflow-y-auto px-4 py-6">
            <section id="pods" className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Pods</p>
                  <p className="mt-1 text-sm text-slate-500">Named collections of project and group IDs.</p>
                </div>
                <Button
                  className="h-9 rounded-xl border border-white/10 bg-white/10 px-3 text-white hover:bg-white/15"
                  onClick={() => setIsCreateOpen((value) => !value)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus className="h-4 w-4" />
                  New
                </Button>
              </div>

              <div className="space-y-2">
                {pods.length > 0 ? (
                  pods.map((pod) => (
                    <button
                      className={cn(
                        "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                        activePodId === pod.id
                          ? "border-orange-400/60 bg-orange-500/10 text-white"
                          : "border-white/8 bg-white/5 text-slate-100 hover:border-white/15 hover:bg-white/8",
                      )}
                      key={pod.id}
                      onClick={() => handlePodSelect(pod.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium tracking-tight">{pod.name}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                            {pod.slug}
                          </p>
                        </div>
                        <Badge className="border-orange-400/30 bg-orange-500/15 text-orange-100" variant="outline">
                          {pod.targetCount}
                        </Badge>
                      </div>
                      {pod.description ? (
                        <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-400">{pod.description}</p>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">No description provided.</p>
                      )}
                    </button>
                  ))
                ) : isBootstrapping ? (
                  <div className="space-y-2">
                    {[0, 1].map((item) => (
                      <Skeleton className="h-24 rounded-2xl bg-white/10" key={item} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-5 text-sm text-slate-400">
                    No pods are available yet. Create one to persist a reusable GitLab scope.
                  </div>
                )}
              </div>

              {isCreateOpen ? (
                <form className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4" onSubmit={handleCreatePod}>
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400" htmlFor="pod-name">
                      Pod name
                    </label>
                    <Input
                      className="border-white/10 bg-white/10 text-white placeholder:text-slate-500"
                      id="pod-name"
                      placeholder="Platform Foundation"
                      value={createForm.name}
                      onChange={(event) =>
                        setCreateForm((currentValue) => ({ ...currentValue, name: event.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400" htmlFor="pod-description">
                      Description
                    </label>
                    <textarea
                      className="min-h-[84px] w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                      id="pod-description"
                      placeholder="Core platform delivery across shared services and groups."
                      value={createForm.description}
                      onChange={(event) =>
                        setCreateForm((currentValue) => ({ ...currentValue, description: event.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400" htmlFor="pod-projects">
                      Project IDs
                    </label>
                    <textarea
                      className="min-h-[72px] w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                      id="pod-projects"
                      placeholder="1042, 4021"
                      value={createForm.projectIds}
                      onChange={(event) =>
                        setCreateForm((currentValue) => ({ ...currentValue, projectIds: event.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400" htmlFor="pod-groups">
                      Group IDs
                    </label>
                    <textarea
                      className="min-h-[72px] w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                      id="pod-groups"
                      placeholder="7"
                      value={createForm.groupIds}
                      onChange={(event) =>
                        setCreateForm((currentValue) => ({ ...currentValue, groupIds: event.target.value }))
                      }
                    />
                    <p className="text-xs leading-5 text-slate-500">
                      Separate IDs with commas, spaces, or new lines.
                    </p>
                  </div>

                  {createError ? (
                    <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">
                      {createError}
                    </div>
                  ) : null}

                  <Button
                    className="w-full justify-between bg-orange-500 text-slate-950 hover:bg-orange-400"
                    disabled={isPending}
                    type="submit"
                  >
                    <span>{isPending ? "Creating pod" : "Create pod"}</span>
                    {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </form>
              ) : null}

              {selectedPod ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">Selected pod context</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{selectedPod.slug}</p>
                    </div>
                    <Badge className="border-white/10 bg-white/10 text-slate-100" variant="outline">
                      {selectedPod.targetCount} targets
                    </Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedPod.targets.map((targetItem) => (
                      <Badge
                        className="border-white/10 bg-slate-900 text-slate-200"
                        key={targetItem.id}
                        variant="outline"
                      >
                        {targetItem.targetType}:{targetItem.targetId}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <nav className="space-y-1">
              {sectionLinks.map(({ icon: Icon, id, label }) => (
                <a
                  className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/6 hover:text-white"
                  href={`#${id}`}
                  key={id}
                >
                  <Icon className="h-4 w-4 text-orange-300/90" />
                  <span>{label}</span>
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <section className="flex-1 px-4 py-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            <Card className="overflow-hidden border-black/5 bg-white/82 shadow-[0_18px_80px_rgba(15,23,42,0.08)] backdrop-blur">
              <CardContent className="grid gap-6 p-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-orange-300 bg-orange-50 text-orange-700" variant="outline">
                      {activeScope?.kind === "ad-hoc" ? "Ad-hoc" : "Pod"}
                    </Badge>
                    {report ? (
                      <Badge
                        className={cn(
                          report.dataSource === "fixture"
                            ? "border-slate-300 bg-slate-100 text-slate-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700",
                        )}
                        variant="outline"
                      >
                        {report.dataSource === "fixture" ? "Fixture mode" : "Live GitLab"}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="space-y-3">
                    <h2 className="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                      Executive reporting for pods, projects, and groups.
                    </h2>
                    <p className="max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
                      Review delivery throughput, stale queue risk, target coverage, reviewer concentration,
                      and cross-project merge-request posture from a single workbench.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-slate-500">
                    <span>Server-to-server FastAPI integration</span>
                    <span className="text-slate-300">/</span>
                    <span>Persistent pods in Postgres</span>
                    <span className="text-slate-300">/</span>
                    <span>GitLab secrets stay off the client</span>
                  </div>
                </div>

                <Card className="border-black/5 bg-slate-950 text-slate-100 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">Ad-hoc target</CardTitle>
                    <CardDescription className="text-slate-400">
                      Keep a single-target flow for quick project or group checks.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-5" onSubmit={handleAdHocSubmit}>
                      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
                        {(["project", "group"] as const).map((value) => (
                          <button
                            className={cn(
                              "rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                              targetType === value
                                ? "bg-orange-500 text-slate-950"
                                : "text-slate-300 hover:bg-white/5 hover:text-white",
                            )}
                            key={value}
                            onClick={() => setTargetType(value)}
                            type="button"
                          >
                            {value === "project" ? "Project" : "Group"}
                          </button>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400" htmlFor="target-id">
                          GitLab ID
                        </label>
                        <Input
                          className="border-white/10 bg-white/10 text-white placeholder:text-slate-500"
                          id="target-id"
                          inputMode="numeric"
                          placeholder={targetType === "project" ? "1042" : "7"}
                          value={targetId}
                          onChange={(event) => setTargetId(event.target.value)}
                        />
                        <p className="text-xs leading-5 text-slate-500">{requestHint[targetType]}</p>
                      </div>

                      <Button
                        className="w-full justify-between bg-white text-slate-950 hover:bg-slate-100"
                        disabled={isPending}
                        type="submit"
                      >
                        <span>{isPending ? "Generating report" : "Generate report"}</span>
                        {isPending ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>

            {error ? <ErrorState message={error} /> : null}

            {isBootstrapping ? (
              <LoadingState />
            ) : report ? (
              <ReportPanel activeScope={activeScope} report={report} selectedPod={selectedPod} />
            ) : (
              <IdleState />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function IdleState() {
  return (
    <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
      <CardHeader>
        <CardTitle>Ready for portfolio reporting</CardTitle>
        <CardDescription>
          Select a pod from the rail or run an ad-hoc target to populate the operating view.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <FeatureCard
          description="Review freshest merge activity with stronger queue and signal treatment."
          icon={GitPullRequestArrow}
          title="Richer merge-request surfaces"
        />
        <FeatureCard
          description="Inspect coverage, overlap deduplication, and per-project posture across a pod."
          icon={Target}
          title="Pod-aware target coverage"
        />
        <FeatureCard
          description="Spot stale work, overloaded reviewers, and unreviewed drafts before they linger."
          icon={AlertTriangle}
          title="Attention-driven operations"
        />
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <Skeleton className="h-28 rounded-3xl bg-white/60" key={item} />
        ))}
      </div>
      <Skeleton className="h-[420px] rounded-3xl bg-white/60" />
      <Skeleton className="h-[320px] rounded-3xl bg-white/60" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-orange-300/60 bg-orange-50 shadow-[0_18px_80px_rgba(249,115,22,0.1)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-orange-900">
          <AlertTriangle className="h-5 w-5" />
          Report generation failed
        </CardTitle>
        <CardDescription className="text-orange-800/80">
          Check the backend service, pod configuration, or GitLab target and try again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border border-orange-300/60 bg-white px-4 py-3 text-sm text-slate-800">
          {message}
        </div>
      </CardContent>
    </Card>
  );
}

function ReportPanel({
  report,
  activeScope,
  selectedPod,
}: {
  report: ExecutiveReport;
  activeScope: ActiveScope;
  selectedPod: PodDetail | null;
}) {
  return (
    <div className="space-y-6">
      <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
        <CardHeader className="gap-5 md:flex-row md:items-start md:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-slate-200 bg-slate-50 text-slate-700" variant="outline">
                {report.target.type}
              </Badge>
              <Badge className="border-orange-300 bg-orange-50 text-orange-700" variant="outline">
                {activeScope?.kind === "ad-hoc" ? `${activeScope.targetType} ${activeScope.targetId}` : report.target.path}
              </Badge>
            </div>
            <div>
              <CardTitle className="text-3xl text-slate-950">{report.target.name}</CardTitle>
              <CardDescription className="mt-2 max-w-3xl text-base leading-7 text-slate-600">
                {selectedPod?.description && report.target.type === "pod"
                  ? selectedPod.description
                  : "Delivery posture derived from the most recent merge-request analysis window."}
              </CardDescription>
            </div>
          </div>
          <div className="space-y-3 text-sm text-slate-500 md:text-right">
            <p>Generated {formatDateTime(report.generatedAt)}</p>
            <p>{report.window.label}</p>
            {report.target.webUrl ? (
              <a
                className="inline-flex items-center gap-2 font-medium text-slate-700 hover:text-orange-600"
                href={report.target.webUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open target in GitLab
                <ArrowUpRight className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6" id="overview">
        <MetricCard detail="Current analysis window" icon={GitPullRequestArrow} label="MRs analyzed" value={String(report.kpis.mergeRequestsAnalyzed)} />
        <MetricCard detail="Current open load" icon={Clock3} label="Open MRs" value={String(report.kpis.openMergeRequests)} />
        <MetricCard detail="Merged within 30 days" icon={ArrowUpRight} label="Merged in 30d" value={String(report.kpis.mergedLast30Days)} />
        <MetricCard detail="Distinct repositories in scope" icon={FolderKanban} label="Active projects" value={String(report.kpis.activeProjects)} />
        <MetricCard detail="Created to merged" icon={LayoutDashboard} label="Median merge time" value={formatHours(report.kpis.medianMergeTimeHours)} />
        <MetricCard detail={reviewerRiskCopy(report.reviewerLoadSignal.risk)} icon={ShieldCheck} label="Top reviewer share" value={formatPercentage(report.reviewerLoadSignal.topReviewerShare)} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>Operating signals distilled from the current delivery window.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.summary.map((item) => (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700" key={item}>
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle>Open queue breakdown</CardTitle>
            <CardDescription>Current open load split by queue condition.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <QueueTile label="Total open" value={report.openQueue.total} />
            <QueueTile label="Stale" value={report.openQueue.stale} tone="warning" />
            <QueueTile label="Draft" value={report.openQueue.draft} />
            <QueueTile label="Oversized" value={report.openQueue.oversized} tone="warning" />
            <QueueTile label="Unreviewed" value={report.openQueue.unreviewed} tone="warning" />
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]" id="attention">
        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle>Attention</CardTitle>
            <CardDescription>Signals that need intervention before queue quality degrades further.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {report.attentionFlags.length > 0 ? (
              report.attentionFlags.map((flag) => <AttentionFlagCard flag={flag} key={`${flag.kind}-${flag.title}`} />)
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                No immediate attention flags were triggered in the current window.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle>Stale open merge requests</CardTitle>
            <CardDescription>Oldest open work items ordered by age.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.staleOpenMergeRequests.length > 0 ? (
              report.staleOpenMergeRequests.map((mergeRequest) => (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4" key={mergeRequest.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <a
                        className="font-medium text-slate-900 hover:text-orange-600"
                        href={mergeRequest.webUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {mergeRequest.title}
                      </a>
                      <p className="mt-1 text-sm text-slate-500">{mergeRequest.projectPath ?? "Single project target"}</p>
                    </div>
                    <div className="text-right text-sm text-slate-500">
                      <p>{mergeRequest.ageDays}d open</p>
                      <p>Updated {formatRelativeTime(mergeRequest.updatedAt)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mergeRequest.draft ? <SignalBadge label="draft" tone="neutral" /> : null}
                    {mergeRequest.isOversized ? <SignalBadge label="oversized" tone="warning" /> : null}
                    {mergeRequest.unreviewed ? <SignalBadge label="unreviewed" tone="warning" /> : null}
                    <SignalBadge label={`${mergeRequest.reviewerCount} reviewers`} tone="neutral" />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                No stale open merge requests were identified in the current window.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]" id="targets">
        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle>Target coverage</CardTitle>
            <CardDescription>
              Coverage resolved {report.targetCoverage.resolvedTargetCount} of {report.targetCoverage.requestedTargetCount} configured targets across {report.targetCoverage.projectsRepresented} projects.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.targetCoverage.items.map((item) => (
              <TargetCoverageCard item={item} key={`${item.type}-${item.id}`} />
            ))}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {report.targetCoverage.deduplicatedMergeRequests.toLocaleString()} deduplicated merge requests contributed to the final report after overlap removal.
            </div>
          </CardContent>
        </Card>

        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle>Per-project breakdown</CardTitle>
            <CardDescription>Repository-level posture across the current report scope.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectBreakdownTable rows={report.projectBreakdown} />
          </CardContent>
        </Card>
      </section>

      <section id="merge-requests">
        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle>Merge requests</CardTitle>
            <CardDescription>Most recently updated merge requests with richer queue and review signals.</CardDescription>
          </CardHeader>
          <CardContent>
            <MergeRequestTable rows={report.recentMergeRequests} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]" id="contributors">
        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle>Contributors</CardTitle>
            <CardDescription>Who is driving authored throughput in the current window.</CardDescription>
          </CardHeader>
          <CardContent>
            <ContributorTable rows={report.contributorRollup} />
          </CardContent>
        </Card>

        <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]" id="reviewers">
          <CardHeader>
            <CardTitle>Reviewers</CardTitle>
            <CardDescription>{report.reviewerLoadSignal.summary}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReviewerTable rows={report.reviewerRollup} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <Icon className="mb-4 h-5 w-5 text-orange-500" />
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="border-black/5 bg-white/84 shadow-[0_18px_80px_rgba(15,23,42,0.08)]">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-500">{label}</span>
          <Icon className="h-4 w-4 text-orange-500" />
        </div>
        <div>
          <div className="text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
          <p className="mt-2 text-sm text-slate-500">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function QueueTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        tone === "warning"
          ? "border-orange-200 bg-orange-50 text-orange-900"
          : "border-slate-200 bg-slate-50 text-slate-900",
      )}
    >
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value.toLocaleString()}</p>
    </div>
  );
}

function AttentionFlagCard({ flag }: { flag: ReportAttentionFlag }) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        flag.severity === "high"
          ? "border-orange-300 bg-orange-50"
          : "border-slate-200 bg-slate-50",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-slate-900">{flag.title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">{flag.description}</p>
        </div>
        <Badge
          className={cn(
            flag.severity === "high"
              ? "border-orange-300 bg-orange-100 text-orange-800"
              : "border-slate-200 bg-slate-100 text-slate-700",
          )}
          variant="outline"
        >
          {flag.count}
        </Badge>
      </div>
      {flag.examples.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {flag.examples.map((example) => (
            <SignalBadge key={example} label={example} tone="neutral" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TargetCoverageCard({ item }: { item: TargetCoverageItem }) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        item.resolved ? "border-slate-200 bg-slate-50" : "border-orange-300 bg-orange-50",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{item.name}</p>
            <Badge
              className={cn(
                item.resolved
                  ? "border-slate-200 bg-white text-slate-700"
                  : "border-orange-300 bg-white text-orange-700",
              )}
              variant="outline"
            >
              {item.type}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{item.path}</p>
        </div>
        <div className="text-right text-sm text-slate-500">
          <p>{item.mergeRequestsAnalyzed.toLocaleString()} analyzed</p>
          <p>{item.deduplicatedMergeRequests.toLocaleString()} contributed</p>
        </div>
      </div>
      {!item.resolved && item.error ? (
        <p className="mt-3 text-sm text-orange-700">{item.error}</p>
      ) : null}
    </div>
  );
}

function ProjectBreakdownTable({ rows }: { rows: ProjectBreakdownRow[] }) {
  if (rows.length === 0) {
    return <EmptyTable message="No project breakdown is available for this report." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead>Analyzed</TableHead>
          <TableHead>Open</TableHead>
          <TableHead>Stale</TableHead>
          <TableHead>Merged 30d</TableHead>
          <TableHead>Median merge</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.projectId}-${row.projectPath}`}>
            <TableCell>
              <div>
                <div className="font-medium text-slate-900">{row.projectPath}</div>
                <div className="text-xs text-slate-500">Project {row.projectId}</div>
              </div>
            </TableCell>
            <TableCell>{row.mergeRequestsAnalyzed}</TableCell>
            <TableCell>{row.openMergeRequests}</TableCell>
            <TableCell>{row.staleMergeRequests}</TableCell>
            <TableCell>{row.mergedLast30Days}</TableCell>
            <TableCell>{formatHours(row.medianMergeTimeHours)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MergeRequestTable({ rows }: { rows: ReportMergeRequestRow[] }) {
  if (rows.length === 0) {
    return <EmptyTable message="No merge requests were returned for this report." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Merge request</TableHead>
          <TableHead>Signals</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Reviewers</TableHead>
          <TableHead>Age / size</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow className="hover:bg-orange-50/50" key={row.id}>
            <TableCell className="min-w-[280px] align-top">
              <div className="space-y-1">
                <a className="font-medium text-slate-900 hover:text-orange-600" href={row.webUrl} rel="noreferrer" target="_blank">
                  {row.title}
                </a>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {row.projectPath ?? "Single project target"}
                </div>
              </div>
            </TableCell>
            <TableCell className="align-top">
              <div className="flex min-w-[180px] flex-wrap gap-2">
                <SignalBadge label={row.state} tone={row.state === "opened" ? "warning" : row.state === "merged" ? "positive" : "neutral"} />
                {row.draft ? <SignalBadge label="draft" tone="neutral" /> : null}
                {row.stale ? <SignalBadge label="stale" tone="warning" /> : null}
                {row.isOversized ? <SignalBadge label="oversized" tone="warning" /> : null}
                {row.unreviewed ? <SignalBadge label="unreviewed" tone="warning" /> : null}
              </div>
            </TableCell>
            <TableCell className="align-top text-slate-700">{row.authorName}</TableCell>
            <TableCell className="align-top">
              <div className="space-y-1 text-slate-700">
                <div>{row.reviewerCount}</div>
                <div className="text-xs text-slate-500">
                  {row.reviewerNames.length > 0 ? row.reviewerNames.join(", ") : "No reviewers assigned"}
                </div>
              </div>
            </TableCell>
            <TableCell className="align-top text-slate-700">
              <div>{row.ageDays}d</div>
              <div className={cn("text-xs", row.isOversized ? "text-orange-700" : "text-slate-500")}>
                {row.changesCount !== null ? `${row.changesCount.toLocaleString()} lines` : "Size unavailable"}
              </div>
            </TableCell>
            <TableCell className="align-top text-slate-500">{formatRelativeTime(row.updatedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ContributorTable({ rows }: { rows: ContributorRollupRow[] }) {
  if (rows.length === 0) {
    return <EmptyTable message="No contributors were found in the current window." />;
  }

  return (
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
        {rows.map((row) => (
          <TableRow key={row.username}>
            <TableCell>
              <div className="font-medium text-slate-900">{row.name}</div>
              <div className="text-xs text-slate-500">@{row.username}</div>
            </TableCell>
            <TableCell>{row.authoredCount}</TableCell>
            <TableCell>{row.mergedCount}</TableCell>
            <TableCell>{row.openCount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReviewerTable({ rows }: { rows: ReviewerRollupRow[] }) {
  if (rows.length === 0) {
    return <EmptyTable message="No reviewers were found in the current window." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reviewer</TableHead>
          <TableHead>Assignments</TableHead>
          <TableHead>Open</TableHead>
          <TableHead>Merged</TableHead>
          <TableHead>Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.username}>
            <TableCell>
              <div className="font-medium text-slate-900">{row.name}</div>
              <div className="text-xs text-slate-500">@{row.username}</div>
            </TableCell>
            <TableCell>{row.assignmentCount}</TableCell>
            <TableCell>{row.openAssignmentCount}</TableCell>
            <TableCell>{row.mergedAssignmentCount}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <span>{formatPercentage(row.concentrationShare)}</span>
                {row.isOverloaded ? <SignalBadge label="loaded" tone="warning" /> : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SignalBadge({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "warning" | "positive";
}) {
  return (
    <Badge
      className={cn(
        tone === "warning"
          ? "border-orange-300 bg-orange-50 text-orange-800"
          : tone === "positive"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-white text-slate-700",
      )}
      variant="outline"
    >
      {label}
    </Badge>
  );
}

function EmptyTable({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
      {message}
    </div>
  );
}

async function fetchPods() {
  return requestApi<PodsResponse>("/api/pods");
}

async function fetchPodWorkspace(podId: string) {
  const [pod, report] = await Promise.all([fetchPod(podId), fetchPodReport(podId)]);
  return {
    pod: pod.pod,
    report: report.report,
  };
}

async function fetchPod(podId: string) {
  return requestApi<PodResponse>(`/api/pods/${podId}`);
}

async function fetchPodReport(podId: string) {
  return requestApi<ReportResponse>(`/api/pods/${podId}/report`, {
    method: "POST",
  });
}

async function fetchAdHocReport(targetType: TargetType, targetId: string) {
  return requestApi<ReportResponse>("/api/report", {
    method: "POST",
    body: JSON.stringify({ targetType, targetId }),
  });
}

async function createPodWorkspace(request: CreatePodRequest) {
  const createdPod = await requestApi<PodResponse>("/api/pods", {
    method: "POST",
    body: JSON.stringify(request),
  });

  const [pods, report] = await Promise.all([fetchPods(), fetchPodReport(createdPod.pod.id)]);
  return {
    pods: pods.pods,
    pod: createdPod.pod,
    report: report.report,
  };
}

async function requestApi<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;

  if (!response.ok) {
    throw new Error(
      payload && typeof payload === "object" && "error" in payload && payload.error
        ? payload.error
        : "The server could not complete the request.",
    );
  }

  if (!payload) {
    throw new Error("The server returned an incomplete response.");
  }

  return payload as T;
}

function splitTargetIds(value: string) {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatHours(value: number | null) {
  if (value === null) {
    return "n/a";
  }

  if (value < 24) {
    return `${value.toFixed(1)}h`;
  }

  return `${(value / 24).toFixed(1)}d`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRelativeTime(value: string) {
  const diffMilliseconds = Date.now() - new Date(value).getTime();
  const diffHours = Math.max(Math.round(diffMilliseconds / (1000 * 60 * 60)), 0);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.round(diffHours / 24)}d ago`;
}

function formatPercentage(value: number) {
  return `${value.toFixed(1)}%`;
}

function reviewerRiskCopy(risk: ExecutiveReport["reviewerLoadSignal"]["risk"]) {
  if (risk === "high") {
    return "High reviewer concentration";
  }

  if (risk === "watch") {
    return "Watch reviewer concentration";
  }

  return "Healthy distribution";
}
