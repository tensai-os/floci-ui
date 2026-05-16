import { FlociError } from "./types";
import {
  emitApiRequest,
  subscribeApiRequests,
  type ApiRequestEvent,
} from "@/telemetry";

export const API_BASE = "/api";

export type FlociRequestEvent = ApiRequestEvent;

export function subscribeRequests(
  cb: (event: FlociRequestEvent) => void,
): () => void {
  return subscribeApiRequests(cb);
}

async function apiFetch<T>(
  path: string,
  service: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const started = performance.now();
  let statusCode = 0;
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal }).catch(
      (cause: unknown) => {
        const message =
          cause instanceof Error ? cause.message : "Network error";
        throw new FlociError(
          `Cannot reach floci-api: ${message}`,
          undefined,
          path,
        );
      },
    );
    statusCode = res.status;
    if (!res.ok) throw new FlociError(`HTTP ${res.status}`, res.status, path);
    return res.json() as Promise<T>;
  } finally {
    if (statusCode > 0) {
      emitApiRequest({
        provider: "aws",
        service,
        method: init.method ?? "GET",
        path,
        statusCode,
        latencyMs: Math.round(performance.now() - started),
        timestamp: Date.now(),
      });
    }
  }
}

export function apiGet<T>(
  path: string,
  service: string,
  signal?: AbortSignal,
): Promise<T> {
  return apiFetch<T>(path, service, {}, signal);
}

export function apiPost<T>(
  path: string,
  service: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return apiFetch<T>(
    path,
    service,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    signal,
  );
}

export function apiPut<T>(
  path: string,
  service: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return apiFetch<T>(
    path,
    service,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    signal,
  );
}

export function apiDelete<T>(
  path: string,
  service: string,
  signal?: AbortSignal,
): Promise<T> {
  return apiFetch<T>(path, service, { method: "DELETE" }, signal);
}
