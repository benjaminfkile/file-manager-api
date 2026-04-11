import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPrivateKey, createSign } from "crypto";
import { Readable } from "stream";

/**
 * S3 key naming strategy
 *
 * All S3 objects follow this key structure to prevent collisions:
 *
 *   files/{userId}/{fileId}/{originalFilename}
 *
 * - `userId`   – the authenticated user's unique identifier
 * - `fileId`   – a unique identifier for the file record
 * - `filename` – the original name of the uploaded file
 */
export function buildS3Key(userId: string, fileId: string, filename: string): string {
  return `files/${userId}/${fileId}/${filename}`;
}

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

export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 900
): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: getBucket(), Key: key, ContentType: contentType }),
    { expiresIn }
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

export function generateSignedCloudFrontUrl(
  domain: string,
  key: string,
  keyPairId: string,
  privateKey: string,
  expiresInSeconds: number
): string {
  // URL-encode the S3 key path segments so the policy URL matches browser requests
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `https://${domain}/${encodedKey}`;

  // Coerce to number (secrets come back as strings) and clamp to 24h max
  const ttlSeconds = Math.min(Number(expiresInSeconds), 86400);
  const expiresEpoch = Math.floor(Date.now() / 1000) + ttlSeconds;

  console.log(`[CF Debug] ttl=${ttlSeconds} expires=${expiresEpoch} url=${url}`);

  // Canned policy document (what CloudFront expects to be signed)
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: url,
        Condition: { DateLessThan: { "AWS:EpochTime": expiresEpoch } },
      },
    ],
  });

  // Normalize literal \n sequences from Secrets Manager JSON storage
  let normalized = privateKey.replace(/\\n/g, "\n");

  // If the key still has no newlines (stored with spaces instead of \n),
  // reconstruct proper PEM by stripping all whitespace from the body and re-chunking
  if (!normalized.includes("\n")) {
    const headerMatch = normalized.match(/-----BEGIN ([^-]+)-----/);
    const footerMatch = normalized.match(/-----END ([^-]+)-----/);
    if (headerMatch && footerMatch) {
      const header = `-----BEGIN ${headerMatch[1]}-----`;
      const footer = `-----END ${footerMatch[1]}-----`;
      const body = normalized
        .replace(/-----BEGIN [^-]+-----/, "")
        .replace(/-----END [^-]+-----/, "")
        .replace(/\s+/g, ""); // strip all whitespace/spaces
      const chunked = body.match(/.{1,64}/g)?.join("\n") ?? body;
      normalized = `${header}\n${chunked}\n${footer}`;
    }
  }

  // Parse as a KeyObject — works with both PKCS#1 and PKCS#8 in Node 24 / OpenSSL 3
  const keyObject = createPrivateKey(normalized);

  const signature = createSign("RSA-SHA1")
    .update(policy)
    .sign(keyObject, "base64")
    .replace(/\+/g, "-")
    .replace(/=/g, "_")
    .replace(/\//g, "~");

  return `${url}?Expires=${expiresEpoch}&Signature=${signature}&Key-Pair-Id=${keyPairId}`;
}
