# CDN-Safe Signed URL Caching Strategy

## Overview

All file downloads are served through CloudFront with signed URLs. The S3 bucket has no public access; only CloudFront can reach it. Clients never talk to S3 directly.

## Architecture

```
Client  -->  API (x-api-key)  -->  Signed CloudFront URL (15-min TTL)
                                        |
                                   CloudFront Edge
                                   (signed URL required)
                                        |
                                   S3 (private, OAC only)
```

### 1. Private S3 Bucket

- All objects are private; no public-read ACLs or bucket policies granting open access.
- The bucket policy allows access **only** from the CloudFront distribution via Origin Access Control (OAC).
- Direct S3 URLs are unreachable from the internet.

### 2. CloudFront with Origin Access Control (OAC)

- A CloudFront distribution is configured with OAC so that CloudFront authenticates to S3 on behalf of viewers.
- OAC replaces the legacy Origin Access Identity (OAI) approach and supports SSE-KMS encrypted objects.
- The S3 bucket policy grants `s3:GetObject` only to the CloudFront distribution's OAC principal.

### 3. Signed URL Requirement

- The CloudFront distribution's default cache behavior requires **signed URLs** via a trusted key group.
- Unsigned requests receive a `403 Forbidden` at the edge — no content is ever served without a valid signature.
- The trusted key group references one or more public keys; the corresponding private key is held by the API for signing.

### 4. API-Generated Signed URLs

When a client requests a file download:

1. The API validates the request's `x-api-key` header and verifies the user has access to the file.
2. The API calls `generateSignedCloudFrontUrl()` (see `src/aws/s3Service.ts`) to produce a short-lived signed URL.
3. The signed URL has a **15-minute TTL** (`dateLessThan` policy), after which CloudFront rejects it.
4. The client uses this URL to fetch the file directly from CloudFront.

```
generateSignedCloudFrontUrl(domain, key, keyPairId, privateKey, expiresInSeconds)
```

The signature is generated using the `@aws-sdk/cloudfront-signer` package with the CloudFront key pair ID and private key retrieved from AWS Secrets Manager.

### 5. Cache Key Configuration

CloudFront's cache key is configured to **exclude the signature query string parameters** (`Expires`, `Signature`, `Key-Pair-Id`). This means:

- Multiple signed URLs for the **same object** hit the same cache entry at the edge.
- The first authenticated request populates the edge cache; subsequent requests for the same file are served from cache without hitting S3 again.
- Cache benefits apply across different signed URLs as long as they resolve to the same S3 key.

**CloudFront cache policy settings:**

| Setting              | Value                                                        |
|----------------------|--------------------------------------------------------------|
| Query strings        | None (or whitelist excluding `Expires`, `Signature`, `Key-Pair-Id`) |
| Headers              | None (default)                                               |
| Cookies              | None (default)                                               |
| TTL                  | Align `Default TTL` with content freshness needs             |

### 6. Expiry Enforces Re-Authentication

- After the signed URL's TTL expires, CloudFront rejects the URL with `403 Access Denied`.
- The client must call the API again, which re-validates `x-api-key` and access permissions before issuing a fresh signed URL.
- This ensures that revoked access is enforced within the TTL window — a user who loses access can only use a previously issued URL until it expires.

## Security Properties

| Threat                        | Mitigation                                                    |
|-------------------------------|---------------------------------------------------------------|
| Direct S3 access              | Bucket is private; only OAC can read                          |
| Unsigned CloudFront request   | Trusted key group rejects unsigned requests at the edge       |
| Stale/shared signed URL       | 15-minute TTL limits exposure window                          |
| Leaked signed URL             | Short TTL + re-auth on expiry bounds the damage               |
| Access revocation delay       | At most 15 minutes until the signed URL expires               |
| Cache poisoning via signature | Signature params excluded from cache key; cache is keyed on the object path only |

## Request Flow

```
1.  Client ---- GET /files/:id/download (x-api-key) ---->  API
2.  API validates x-api-key and checks file access permissions
3.  API calls generateSignedCloudFrontUrl() with 15-min TTL
4.  API <---- 200 { url: "https://d111.cloudfront.net/files/..." } ---->  Client
5.  Client ---- GET signed URL ---->  CloudFront Edge
6.  CloudFront verifies signature + expiry
7a. Cache HIT  --> CloudFront returns cached object
7b. Cache MISS --> CloudFront fetches from S3 via OAC, caches, returns object
8.  Client receives the file
```

## Infrastructure Requirements

- **S3 bucket policy**: Grant `s3:GetObject` only to the CloudFront OAC principal.
- **CloudFront distribution**: OAC origin pointing to the S3 bucket; default behavior requires signed URLs with a trusted key group.
- **CloudFront cache policy**: Exclude `Expires`, `Signature`, and `Key-Pair-Id` from the cache key.
- **Trusted key group**: At least one public key registered; the matching private key stored in AWS Secrets Manager.
- **API environment**: `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID`, and access to the private key via Secrets Manager.
