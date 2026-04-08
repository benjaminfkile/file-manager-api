import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

let s3: S3Client | null = null;
let bucket: string | null = null;

export function initS3(bucketName: string): void {
  if (s3) return;

  s3 = new S3Client({ region: process.env.AWS_REGION });
  bucket = bucketName;
}

function getClient(): S3Client {
  if (!s3) {
    throw new Error("S3 has not been initialized. Call initS3() first.");
  }
  return s3;
}

function getBucket(): string {
  if (!bucket) {
    throw new Error("S3 has not been initialized. Call initS3() first.");
  }
  return bucket;
}

export async function uploadObject(
  key: string,
  body: Buffer | Readable,
  contentType: string,
  size: number
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: size,
    })
  );
}

export async function getObjectStream(key: string): Promise<Readable> {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error(`S3 object body is empty for key: ${key}`);
  }

  return response.Body as Readable;
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  await getClient().send(
    new DeleteObjectsCommand({
      Bucket: getBucket(),
      Delete: {
        Objects: keys.map((key) => ({ Key: key })),
      },
    })
  );
}

export async function generatePresignedDownloadUrl(
  key: string,
  expiresInSeconds: number
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });

  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

export async function headObject(
  key: string
): Promise<{ contentLength: number; contentType: string }> {
  const response = await getClient().send(
    new HeadObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );

  return {
    contentLength: response.ContentLength ?? 0,
    contentType: response.ContentType ?? "application/octet-stream",
  };
}
