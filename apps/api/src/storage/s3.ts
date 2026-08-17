/**
 * S3 storage for deployment.
 *
 * The bucket must be created with public access blocked and default encryption
 * on. Reads are always presigned and short-lived; the application never hands
 * out a bucket URL.
 */

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { assertSafeKey, ObjectNotFound, type StorageAdapter, type StoredObject } from './index.js';

export class S3Storage implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: {
    bucket: string;
    region: string;
    endpoint?: string;
    forcePathStyle?: boolean;
  }) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.forcePathStyle ? { forcePathStyle: true } : {}),
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) throw new ObjectNotFound(key);
      const bytes = await res.Body.transformToByteArray();
      return {
        key,
        bytes,
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if (err instanceof ObjectNotFound) throw err;
      throw new ObjectNotFound(key);
    }
  }

  async signedGetUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: [{ Key: key }], Quiet: true },
      }),
    );
  }

  async removePrefix(prefix: string): Promise<number> {
    assertSafeKey(prefix.replace(/\/+$/, ''));
    let token: string | undefined;
    let removed = 0;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => typeof k === 'string');
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        removed += keys.length;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }
}
