import { apiClient, apiEndpointKeys } from "@/api/api";
import type { ResourceSummary } from "@/api/types";

export interface S3Bucket {
  name: string;
  createdAt?: string;
  tags?: S3Tag[];
}

export interface S3Object {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
}

export interface S3Contents {
  folders: string[];
  files: S3Object[];
}

export interface S3ObjectMetadata {
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: string;
  versionId?: string;
  cacheControl?: string;
  contentEncoding?: string;
  contentDisposition?: string;
}

export interface S3Tag {
  key: string;
  value: string;
}

export type BucketVersioningStatus = "Enabled" | "Suspended" | "Unversioned";

export interface CreateS3BucketInput {
  name: string;
  tags?: S3Tag[];
  versioningEnabled?: boolean;
}

export async function listS3Buckets(
  signal?: AbortSignal,
): Promise<ResourceSummary[]> {
  const res = await apiClient.call<S3Bucket[]>(
    apiEndpointKeys.aws.s3.buckets.list,
    { signal },
  );

  return res.data.map((bucket) => ({
    id: bucket.name,
    name: bucket.name,
    status: "available",
    metadata: { createdAt: bucket.createdAt, tags: bucket.tags ?? [] },
  }));
}

export async function listS3Objects(
  bucket: string,
  prefix?: string,
  signal?: AbortSignal,
): Promise<S3Contents> {
  const res = await apiClient.call<S3Contents>(
    apiEndpointKeys.aws.s3.objects.list,
    {
      signal,
      params: { prefix },
    },
    { bucket },
  );

  return res.data;
}

export async function uploadS3Object(
  bucket: string,
  key: string,
  file: File | Blob,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void, never>(
    apiEndpointKeys.aws.s3.objects.upload,
    {
      signal,
      params: { key },
      headers: { "Content-Type": file.type || "application/octet-stream" },
      rawBody: file,
    },
    { bucket },
  );
}

export function s3ObjectDownloadUrl(bucket: string, key: string): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";
  return `${baseUrl}/s3/${encodeURIComponent(bucket)}/object/download?key=${encodeURIComponent(key)}`;
}

export async function deleteS3Object(
  bucket: string,
  key: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void>(
    apiEndpointKeys.aws.s3.objects.delete,
    {
      signal,
      params: { key },
    },
    { bucket },
  );
}

export async function deleteS3Objects(
  bucket: string,
  keys: string[],
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void, { keys: string[] }>(
    apiEndpointKeys.aws.s3.objects.deleteMany,
    {
      signal,
      body: { keys },
    },
    { bucket },
  );
}

export async function getS3ObjectMetadata(
  bucket: string,
  key: string,
  signal?: AbortSignal,
): Promise<S3ObjectMetadata> {
  const res = await apiClient.call<S3ObjectMetadata>(
    apiEndpointKeys.aws.s3.objects.metadata,
    {
      signal,
      params: { key },
    },
    { bucket },
  );

  return res.data;
}

export async function getS3ObjectTags(
  bucket: string,
  key: string,
  signal?: AbortSignal,
): Promise<S3Tag[]> {
  const res = await apiClient.call<S3Tag[]>(
    apiEndpointKeys.aws.s3.objects.tags.get,
    {
      signal,
      params: { key },
    },
    { bucket },
  );

  return res.data;
}

export async function putS3ObjectTags(
  bucket: string,
  key: string,
  tags: S3Tag[],
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void, { key: string; tags: S3Tag[] }>(
    apiEndpointKeys.aws.s3.objects.tags.put,
    {
      signal,
      body: { key, tags },
    },
    { bucket },
  );
}

export async function getBucketVersioning(
  bucket: string,
  signal?: AbortSignal,
): Promise<BucketVersioningStatus> {
  const res = await apiClient.call<{ status: string }>(
    apiEndpointKeys.aws.s3.buckets.getBucketVersioning,
    { signal },
    { bucket },
  );

  return res.data.status as BucketVersioningStatus;
}

export async function putBucketVersioning(
  bucket: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void, { enabled: boolean }>(
    apiEndpointKeys.aws.s3.buckets.versioning.put,
    {
      signal,
      body: { enabled },
    },
    { bucket },
  );
}

export async function getBucketTags(
  bucket: string,
  signal?: AbortSignal,
): Promise<S3Tag[]> {
  const res = await apiClient.call<S3Tag[]>(
    apiEndpointKeys.aws.s3.buckets.getBucketTagging,
    { signal },
    { bucket },
  );

  return res.data;
}

export async function putBucketTags(
  bucket: string,
  tags: S3Tag[],
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void, { tags: S3Tag[] }>(
    apiEndpointKeys.aws.s3.buckets.tags.put,
    {
      signal,
      body: { tags },
    },
    { bucket },
  );
}

export async function createS3Bucket(
  input: CreateS3BucketInput,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void, CreateS3BucketInput>(
    apiEndpointKeys.aws.s3.buckets.create,
    {
      signal,
      body: input,
    },
  );
}

export async function deleteS3Bucket(
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void>(
    apiEndpointKeys.aws.s3.buckets.delete,
    { signal },
    { bucket: name },
  );
}

export async function copyS3Object(
  srcBucket: string,
  srcKey: string,
  destBucket: string,
  destKey: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<
    void,
    {
      srcBucket: string;
      srcKey: string;
      destBucket: string;
      destKey: string;
    }
  >(
    apiEndpointKeys.aws.s3.objects.copy,
    {
      signal,
      body: { srcBucket, srcKey, destBucket, destKey },
    },
  );
}

export const s3Client = {
  listBuckets: listS3Buckets,
  listObjects: listS3Objects,
  uploadObject: uploadS3Object,
  objectDownloadUrl: s3ObjectDownloadUrl,
  deleteObject: deleteS3Object,
  deleteObjects: deleteS3Objects,
  getObjectMetadata: getS3ObjectMetadata,
  getObjectTags: getS3ObjectTags,
  putObjectTags: putS3ObjectTags,
  getBucketVersioning,
  putBucketVersioning,
  getBucketTags,
  putBucketTags,
  createBucket: createS3Bucket,
  deleteBucket: deleteS3Bucket,
  copyObject: copyS3Object,
};
