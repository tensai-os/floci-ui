import { EndpointRegistry, HttpClient } from "./HttpClient";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required before calling the API.");
    this.name = "AuthenticationRequiredError";
  }
}

export const apiEndpointKeys = {
  aws: {
    s3: {
      buckets: {
        list: "aws.s3.buckets.list",
        create: "aws.s3.buckets.create",
        delete: "aws.s3.buckets.delete",
        getBucketTagging: "aws.s3.buckets.get-bucket-tagging",
        getBucketVersioning: "aws.s3.buckets.get-bucket-versioning",
        versioning: {
          get: "aws.s3.buckets.get-bucket-versioning",
          put: "aws.s3.buckets.versioning.put",
        },
        tags: {
          get: "aws.s3.buckets.get-bucket-tagging",
          put: "aws.s3.buckets.tags.put",
        },
      },
      objects: {
        list: "aws.s3.objects.list",
        upload: "aws.s3.objects.upload",
        delete: "aws.s3.objects.delete",
        deleteMany: "aws.s3.objects.delete-many",
        copy: "aws.s3.objects.copy",
        metadata: "aws.s3.objects.metadata",
        tags: {
          get: "aws.s3.objects.tags.get",
          put: "aws.s3.objects.tags.put",
        },
      },
    },
  },
} as const;

export const endpointRegistry: EndpointRegistry = new Map([
  // AWS S3
  [
    apiEndpointKeys.aws.s3.buckets.list,
    {
      path: "/s3/buckets",
      method: "GET",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.buckets.create,
    {
      path: "/s3/buckets",
      method: "POST",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.buckets.delete,
    {
      path: "/s3/:bucket",
      method: "DELETE",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.objects.list,
    {
      path: "/s3/:bucket/objects",
      method: "GET",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.objects.upload,
    {
      path: "/s3/:bucket/object",
      method: "PUT",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.objects.delete,
    {
      path: "/s3/:bucket/object",
      method: "DELETE",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.objects.deleteMany,
    {
      path: "/s3/:bucket/objects/delete",
      method: "POST",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.objects.copy,
    {
      path: "/s3/copy",
      method: "POST",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.objects.metadata,
    {
      path: "/s3/:bucket/object/metadata",
      method: "GET",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.objects.tags.get,
    {
      path: "/s3/:bucket/object/tags",
      method: "GET",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.objects.tags.put,
    {
      path: "/s3/:bucket/object/tags",
      method: "PUT",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.buckets.getBucketVersioning,
    {
      path: "/s3/:bucket/versioning",
      method: "GET",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.buckets.versioning.put,
    {
      path: "/s3/:bucket/versioning",
      method: "PUT",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.buckets.getBucketTagging,
    {
      path: "/s3/:bucket/tags",
      method: "GET",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],
  [
    apiEndpointKeys.aws.s3.buckets.tags.put,
    {
      path: "/s3/:bucket/tags",
      method: "PUT",
      telemetry: { provider: "aws", service: "s3" },
    },
  ],

  // TODO: migrate remaining services into this registry.
]);

// ─── Client Factory ───────────────────────────────────────────────────────────

export function createApiClient(
  getToken?: () => string | null | Promise<string | null>,
) {
  const client = new HttpClient(
    {
      baseUrl: import.meta.env.VITE_API_BASE_URL ?? "/api",
      defaultHeaders: { Accept: "application/json" },
      timeout: 10_000,
    },
    endpointRegistry,
  );

  // Auth interceptor — attaches Bearer token if available
  if (getToken) {
    client.addRequestInterceptor(async (url, init) => {
      const token = await getToken();
      if (token) {
        (init.headers as Record<string, string>)["Authorization"] =
          `Bearer ${token}`;
      }
      return { url, init };
    });
  }

  // Logging interceptor (dev only)
  if (import.meta.env.DEV) {
    client.addResponseInterceptor((res) => {
      console.debug(`[HTTP] ${res.status} ${res.url}`);
      return res;
    });
  }

  //  client.addResponseInterceptor((res) => {
  //    if (res.status === 401) {
  //      handleUnauthorizedApiResponse();
  //    }
  //    return res;
  //  });

  return client;
}

export const apiClient = createApiClient();
