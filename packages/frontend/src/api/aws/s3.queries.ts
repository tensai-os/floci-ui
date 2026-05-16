import { useQuery } from "@tanstack/react-query";
import { s3Client } from "./s3.api";

export const s3QueryKeys = {
  buckets: ["resources", "s3"] as const,
  objects: (bucket: string | null, prefix: string) =>
    ["s3-objects", bucket, prefix] as const,
  objectMetadata: (bucket: string, key: string | null) =>
    ["s3-meta", bucket, key] as const,
  objectTags: (bucket: string, key: string | null) =>
    ["s3-obj-tags", bucket, key] as const,
  bucketVersioning: (bucket: string) => ["s3-versioning", bucket] as const,
  bucketTags: (bucket: string) => ["s3-bucket-tags", bucket] as const,
};

export function useS3BucketsQuery() {
  return useQuery({
    queryKey: s3QueryKeys.buckets,
    queryFn: ({ signal }) => s3Client.listBuckets(signal),
  });
}

export function useS3ObjectsQuery(bucket: string | null, prefix: string) {
  return useQuery({
    queryKey: s3QueryKeys.objects(bucket, prefix),
    queryFn: ({ signal }) =>
      s3Client.listObjects(bucket!, prefix || undefined, signal),
    enabled: Boolean(bucket),
  });
}

export function useS3ObjectMetadataQuery(bucket: string, objectKey: string | null) {
  return useQuery({
    queryKey: s3QueryKeys.objectMetadata(bucket, objectKey),
    queryFn: ({ signal }) =>
      s3Client.getObjectMetadata(bucket, objectKey!, signal),
    enabled: Boolean(objectKey),
  });
}

export function useS3ObjectTagsQuery(bucket: string, objectKey: string | null) {
  return useQuery({
    queryKey: s3QueryKeys.objectTags(bucket, objectKey),
    queryFn: ({ signal }) => s3Client.getObjectTags(bucket, objectKey!, signal),
    enabled: Boolean(objectKey),
  });
}

export function useBucketVersioningQuery(bucket: string, enabled: boolean) {
  return useQuery({
    queryKey: s3QueryKeys.bucketVersioning(bucket),
    queryFn: ({ signal }) => s3Client.getBucketVersioning(bucket, signal),
    enabled,
  });
}

export function useBucketTagsQuery(bucket: string, enabled: boolean) {
  return useQuery({
    queryKey: s3QueryKeys.bucketTags(bucket),
    queryFn: ({ signal }) => s3Client.getBucketTags(bucket, signal),
    enabled,
  });
}
