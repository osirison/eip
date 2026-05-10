import "server-only";

import { getGitLabRuntimeConfig } from "@/lib/env";

import type { GitLabMergeRequest, GitLabTarget, GitLabPerson, TargetType } from "@/lib/gitlab/types";

type GitLabUserRaw = {
  id: number;
  name: string;
  username: string;
  web_url?: string | null;
};

type GitLabTargetRaw = {
  id: number;
  name?: string;
  full_name?: string;
  path_with_namespace?: string;
  full_path?: string;
  web_url?: string | null;
};

type GitLabReferencesRaw = {
  full?: string;
  relative?: string;
};

type GitLabMergeRequestRaw = {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  author: GitLabUserRaw;
  reviewers?: GitLabUserRaw[];
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  changes_count?: string;
  project_id: number;
  references?: GitLabReferencesRaw;
};

type GitLabMergeRequestDetailsRaw = {
  changes_count?: string;
};

export class GitLabHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitLabHttpError";
  }
}

export async function fetchGitLabTarget(targetType: TargetType, targetId: string): Promise<GitLabTarget> {
  const encodedTargetId = encodeURIComponent(targetId);
  const endpoint = targetType === "project" ? `/projects/${encodedTargetId}` : `/groups/${encodedTargetId}`;
  const target = await requestJson<GitLabTargetRaw>(endpoint);

  return {
    id: String(target.id ?? targetId),
    type: targetType,
    name: target.name ?? target.full_name ?? `GitLab ${targetType}`,
    path:
      target.path_with_namespace ?? target.full_path ?? target.name ?? target.full_name ?? `id:${targetId}`,
    webUrl: target.web_url,
  };
}

export async function fetchRecentGitLabMergeRequests({
  targetType,
  targetId,
  targetPath,
  limit = 25,
}: {
  targetType: TargetType;
  targetId: string;
  targetPath: string;
  limit?: number;
}): Promise<GitLabMergeRequest[]> {
  const encodedTargetId = encodeURIComponent(targetId);
  const query = new URLSearchParams({
    state: "all",
    per_page: String(limit),
    order_by: "updated_at",
    sort: "desc",
  });

  const endpoint =
    targetType === "project"
      ? `/projects/${encodedTargetId}/merge_requests?${query.toString()}`
      : `/groups/${encodedTargetId}/merge_requests?${query.toString()}`;

  const mergeRequests = await requestJson<GitLabMergeRequestRaw[]>(endpoint);

  return Promise.all(
    mergeRequests.map(async (mergeRequest) => {
      const changesCount =
        parseChangesCount(mergeRequest.changes_count) ??
        (await safeFetchChangesCount(mergeRequest.project_id, mergeRequest.iid));

      return {
        id: mergeRequest.id,
        iid: mergeRequest.iid,
        projectId: mergeRequest.project_id,
        projectPath:
          targetType === "project"
            ? targetPath
            : extractProjectPath(mergeRequest.references) ?? `project-${mergeRequest.project_id}`,
        title: mergeRequest.title,
        webUrl: mergeRequest.web_url,
        state: normalizeState(mergeRequest.state),
        draft: Boolean(mergeRequest.draft || mergeRequest.work_in_progress),
        author: mapGitLabUser(mergeRequest.author),
        reviewers: (mergeRequest.reviewers ?? []).map(mapGitLabUser),
        createdAt: mergeRequest.created_at,
        updatedAt: mergeRequest.updated_at,
        mergedAt: mergeRequest.merged_at ?? null,
        changesCount,
      } satisfies GitLabMergeRequest;
    }),
  );
}

async function safeFetchChangesCount(projectId: number, mergeRequestIid: number) {
  try {
    const details = await requestJson<GitLabMergeRequestDetailsRaw>(
      `/projects/${encodeURIComponent(String(projectId))}/merge_requests/${encodeURIComponent(String(mergeRequestIid))}`,
    );

    return parseChangesCount(details.changes_count);
  } catch {
    return null;
  }
}

async function requestJson<T>(path: string): Promise<T> {
  const runtimeConfig = getGitLabRuntimeConfig();

  if (!runtimeConfig.token) {
    throw new GitLabHttpError("GitLab credentials are not configured.", 500);
  }

  const response = await fetch(`${runtimeConfig.baseUrl}${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "PRIVATE-TOKEN": runtimeConfig.token,
    },
  });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new GitLabHttpError(message, response.status);
  }

  return (await response.json()) as T;
}

async function extractErrorMessage(response: Response) {
  const payload = await response.text();

  if (!payload) {
    return response.status === 404 ? "The GitLab target was not found." : "GitLab request failed.";
  }

  try {
    const parsed = JSON.parse(payload) as { message?: string | Record<string, string[]> };

    if (typeof parsed.message === "string") {
      return parsed.message;
    }

    if (parsed.message && typeof parsed.message === "object") {
      const firstEntry = Object.values(parsed.message)[0];
      if (Array.isArray(firstEntry) && firstEntry[0]) {
        return firstEntry[0];
      }
    }
  } catch {
    return payload;
  }

  return response.status === 404 ? "The GitLab target was not found." : "GitLab request failed.";
}

function extractProjectPath(references?: GitLabReferencesRaw) {
  const fullReference = references?.full ?? references?.relative;
  return fullReference ? fullReference.split("!")[0] : null;
}

function mapGitLabUser(user: GitLabUserRaw): GitLabPerson {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    webUrl: user.web_url,
  };
}

function normalizeState(state: string): GitLabMergeRequest["state"] {
  if (state === "merged" || state === "closed" || state === "locked") {
    return state;
  }

  return "opened";
}

function parseChangesCount(changesCount?: string) {
  if (!changesCount) {
    return null;
  }

  const numericChangesCount = Number.parseInt(changesCount, 10);
  return Number.isFinite(numericChangesCount) ? numericChangesCount : null;
}