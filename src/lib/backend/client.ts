import "server-only";

import type {
  CreatePodRequest,
  ExecutiveReport,
  PodDetail,
  PodSummary,
  TargetType,
} from "@/lib/gitlab/types";

const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8000";

export class BackendHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "BackendHttpError";
  }
}

export interface PodEnvelope {
  pod: PodDetail;
}

export interface PodsEnvelope {
  pods: PodSummary[];
}

export interface ReportEnvelope {
  report: ExecutiveReport;
}

export interface AdHocReportRequest {
  targetType: TargetType;
  targetId: string;
}

export async function createAdHocReport(request: AdHocReportRequest) {
  return requestBackend<ReportEnvelope>("/v1/reports/ad-hoc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

export async function listPods() {
  return requestBackend<PodsEnvelope>("/v1/pods", {
    method: "GET",
  });
}

export async function getPod(podId: string) {
  return requestBackend<PodEnvelope>(`/v1/pods/${encodeURIComponent(podId)}`, {
    method: "GET",
  });
}

export async function createPod(request: CreatePodRequest) {
  return requestBackend<PodEnvelope>("/v1/pods", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

export async function createPodReport(podId: string) {
  return requestBackend<ReportEnvelope>(`/v1/reports/pods/${encodeURIComponent(podId)}`, {
    method: "POST",
  });
}

async function requestBackend<T>(path: string, init: RequestInit) {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new BackendHttpError(await extractErrorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

function getBackendBaseUrl() {
  const configuredBaseUrl = process.env.EIP_BACKEND_BASE_URL?.trim();
  return (configuredBaseUrl && configuredBaseUrl.length > 0
    ? configuredBaseUrl
    : DEFAULT_BACKEND_BASE_URL
  ).replace(/\/+$/, "");
}

async function extractErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; detail?: string | { msg?: string }[] }
      | null;

    if (payload?.error) {
      return payload.error;
    }

    if (typeof payload?.detail === "string") {
      return payload.detail;
    }

    const firstValidationIssue = Array.isArray(payload?.detail) ? payload.detail[0]?.msg : null;
    if (firstValidationIssue) {
      return firstValidationIssue;
    }
  }

  const text = await response.text().catch(() => "");

  if (text) {
    return text;
  }

  if (response.status === 404) {
    return "The requested backend resource was not found.";
  }

  return "Backend request failed.";
}