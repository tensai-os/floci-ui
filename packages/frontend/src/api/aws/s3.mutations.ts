import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import {
  s3Client,
  type CreateS3BucketInput,
  type S3Tag,
} from "./s3.api";
import { s3QueryKeys } from "./s3.queries";

export type UploadS3ObjectInput = {
  bucket: string;
  key: string;
  file: File | Blob;
};

export type DeleteS3ObjectInput = {
  bucket: string;
  key: string;
};

export type DeleteS3ObjectsInput = {
  bucket: string;
  keys: string[];
};

export type PutS3ObjectTagsInput = {
  bucket: string;
  key: string;
  tags: S3Tag[];
};

export type PutBucketVersioningInput = {
  bucket: string;
  enabled: boolean;
};

export type PutBucketTagsInput = {
  bucket: string;
  tags: S3Tag[];
};

export type CopyS3ObjectInput = {
  srcBucket: string;
  srcKey: string;
  destBucket: string;
  destKey: string;
};

export function useCreateS3BucketMutation(
  options?: UseMutationOptions<void, Error, CreateS3BucketInput>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => s3Client.createBucket(input),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: s3QueryKeys.buckets });
      options?.onSuccess?.(...args);
    },
  });
}

export function useDeleteS3BucketMutation(
  options?: UseMutationOptions<void, Error, string>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name) => s3Client.deleteBucket(name),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: s3QueryKeys.buckets });
      options?.onSuccess?.(...args);
    },
  });
}

export function useUploadS3ObjectMutation(
  options?: UseMutationOptions<void, Error, UploadS3ObjectInput>,
) {
  return useMutation({
    mutationFn: ({ bucket, key, file }) =>
      s3Client.uploadObject(bucket, key, file),
    ...options,
  });
}

export function useDeleteS3ObjectMutation(
  options?: UseMutationOptions<void, Error, DeleteS3ObjectInput>,
) {
  return useMutation({
    mutationFn: ({ bucket, key }) => s3Client.deleteObject(bucket, key),
    ...options,
  });
}

export function useDeleteS3ObjectsMutation(
  options?: UseMutationOptions<void, Error, DeleteS3ObjectsInput>,
) {
  return useMutation({
    mutationFn: ({ bucket, keys }) => s3Client.deleteObjects(bucket, keys),
    ...options,
  });
}

export function usePutS3ObjectTagsMutation(
  options?: UseMutationOptions<void, Error, PutS3ObjectTagsInput>,
) {
  return useMutation({
    mutationFn: ({ bucket, key, tags }) =>
      s3Client.putObjectTags(bucket, key, tags),
    ...options,
  });
}

export function usePutBucketVersioningMutation(
  options?: UseMutationOptions<void, Error, PutBucketVersioningInput>,
) {
  return useMutation({
    mutationFn: ({ bucket, enabled }) =>
      s3Client.putBucketVersioning(bucket, enabled),
    ...options,
  });
}

export function usePutBucketTagsMutation(
  options?: UseMutationOptions<void, Error, PutBucketTagsInput>,
) {
  return useMutation({
    mutationFn: ({ bucket, tags }) => s3Client.putBucketTags(bucket, tags),
    ...options,
  });
}

export function useCopyS3ObjectMutation(
  options?: UseMutationOptions<void, Error, CopyS3ObjectInput>,
) {
  return useMutation({
    mutationFn: ({ srcBucket, srcKey, destBucket, destKey }) =>
      s3Client.copyObject(srcBucket, srcKey, destBucket, destKey),
    ...options,
  });
}
