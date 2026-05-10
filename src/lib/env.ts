import "server-only";

import { z } from "zod";

const envSchema = z.object({
  GITLAB_BASE_URL: z.string().trim().url().optional(),
  GITLAB_TOKEN: z.string().trim().min(1).optional(),
  GITLAB_USE_FIXTURES: z.enum(["true", "false"]).optional(),
});

export function getGitLabRuntimeConfig() {
  const env = envSchema.parse({
    GITLAB_BASE_URL: process.env.GITLAB_BASE_URL,
    GITLAB_TOKEN: process.env.GITLAB_TOKEN,
    GITLAB_USE_FIXTURES: process.env.GITLAB_USE_FIXTURES,
  });

  const baseUrl = normalizeGitLabBaseUrl(env.GITLAB_BASE_URL ?? "https://gitlab.com");
  const token = env.GITLAB_TOKEN ?? null;

  return {
    baseUrl,
    token,
    useFixtures: env.GITLAB_USE_FIXTURES === "true" || !token,
  };
}

function normalizeGitLabBaseUrl(baseUrl: string) {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  const apiBaseUrl = trimmedBaseUrl.endsWith("/api/v4")
    ? trimmedBaseUrl
    : `${trimmedBaseUrl}/api/v4`;

  return new URL(apiBaseUrl).toString().replace(/\/$/, "");
}