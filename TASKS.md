# Upload Refactor — file-manager-api

Replace the multer `memoryStorage()` upload (which buffers the entire file in RAM before touching S3) with a client-driven S3 multipart upload flow. The client initiates a session, sends fixed-size chunks as separate requests, then completes the upload. The server holds at most one chunk in memory at a time, and each HTTP request is small enough to never hit a load balancer timeout.

**Run `npm test` after every task. All tests must pass before starting the next task.**

---

## Task 1 — Install `@aws-sdk/lib-storage`

**Goal:** Add the AWS SDK package that exposes the low-level S3 multipart upload commands needed in Task 3.

**Steps:**
1. Run `npm install @aws-sdk/lib-storage`
2. Confirm `@aws-sdk/lib-storage` appears in `package.json` under `dependencies`

**Acceptance criteria:**
- `@aws-sdk/lib-storage` is in `package.json` dependencies
- `npm run build` completes without TypeScript errors
- All existing tests pass

---

## Task 2 — Add DB Migration for `upload_sessions` Table

**Goal:** Create a Knex migration that adds an `upload_sessions` table. This table ties an S3 multipart `UploadId` to the authenticated user so every part request and the complete/abort request can verify ownership without the client having to prove it separately.

**File to create:** `src/db/migrations/20260418000000_create_upload_sessions_table.ts`

Follow the exact structure of existing migrations (see `src/db/migrations/20260412000000_create_share_links_table.ts` for the pattern). The file must export `up` and `down` functions.

**`up` schema:**
```sql
CREATE TABLE upload_sessions (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  s3_key         VARCHAR      NOT NULL,
  s3_upload_id   VARCHAR      NOT NULL,
  filename       VARCHAR      NOT NULL,
  mime_type      VARCHAR      NOT NULL,
  size_bytes     BIGINT       NOT NULL,
  folder_id      UUID         REFERENCES folders(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**`down`** must drop the `upload_sessions` table.

**Acceptance criteria:**
- Migration file exists at the path above
- `up` creates the `upload_sessions` table with all columns and the FK to `users`
- `down` drops the table
- All existing tests pass

---

## Task 3 — Add `IUploadSession` Interface to `src/interfaces.ts`

**Goal:** Define the TypeScript shape for an `upload_sessions` row so routers and services share one type.

**File to change:** `src/interfaces.ts`

**Add:**
```typescript
export interface IUploadSession {
  id: string;
  user_id: string;
  s3_key: string;
  s3_upload_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  folder_id: string | null;
  created_at: string;
}
```

**Acceptance criteria:**
- `IUploadSession` is exported from `src/interfaces.ts`
- `npm run build` completes without errors
- All existing tests pass

---

## Task 4 — Add S3 Multipart Functions to `src/aws/s3Service.ts` + Unit Tests

**Goal:** Expose four functions in `src/aws/s3Service.ts` that wrap the S3 multipart upload API. All four use the existing `getClient()` and `getBucket()` helpers already in that file.

**File to change:** `src/aws/s3Service.ts`

**New imports to add** (from `@aws-sdk/client-s3`):
```
CreateMultipartUploadCommand
UploadPartCommand
CompleteMultipartUploadCommand
AbortMultipartUploadCommand
```

**Functions to add — exact signatures:**

```typescript
/** Starts a multipart upload. Returns the S3 UploadId. */
export async function initiateMultipartUpload(
  key: string,
  contentType: string
): Promise<string>

/** Uploads one part. Returns the ETag string (include surrounding quotes — S3 returns them). */
export async function uploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  body: Buffer
): Promise<string>

/** Finalises the multipart upload. `parts` must be sorted by PartNumber ascending. */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[]
): Promise<void>

/** Aborts an in-progress upload and releases its staged S3 storage. */
export async function abortMultipartUpload(
  key: string,
  uploadId: string
): Promise<void>
```

**Test file to create:** `__tests__/s3Service.test.ts`

Mock `S3Client.prototype.send` (or use `jest.mock('@aws-sdk/client-s3')`) and write a test for each function:
- `initiateMultipartUpload` — verify `CreateMultipartUploadCommand` is sent with correct `Bucket`, `Key`, `ContentType`; verify it returns the `UploadId` from the mocked response
- `uploadPart` — verify `UploadPartCommand` is sent with `Bucket`, `Key`, `UploadId`, `PartNumber`, `Body`; verify it returns the `ETag`
- `completeMultipartUpload` — verify `CompleteMultipartUploadCommand` is sent with `Bucket`, `Key`, `UploadId`, and `MultipartUpload.Parts`
- `abortMultipartUpload` — verify `AbortMultipartUploadCommand` is sent with `Bucket`, `Key`, `UploadId`

**Acceptance criteria:**
- All four functions are exported from `src/aws/s3Service.ts`
- `__tests__/s3Service.test.ts` exists and every test in it passes
- All existing tests continue to pass

---

## Task 5 — Add Upload Session Service Functions to `src/services/fileService.ts` + Tests

**Goal:** Add three thin DB helper functions to `src/services/fileService.ts` for creating, reading, and deleting rows in `upload_sessions`.

**File to change:** `src/services/fileService.ts`

Import `IUploadSession` from `../interfaces`.

**Functions to add — exact signatures:**

```typescript
/** Inserts a new upload session row and returns the created row. */
export async function createUploadSession(data: {
  id: string;
  userId: string;
  s3Key: string;
  s3UploadId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string | null;
}): Promise<IUploadSession>

/** Returns the session by its id, or null if not found. */
export async function getUploadSession(
  sessionId: string
): Promise<IUploadSession | null>

/** Deletes the session row. Called after complete or abort. */
export async function deleteUploadSession(sessionId: string): Promise<void>
```

Use the table name `'upload_sessions'` and follow the same knex patterns used by the existing functions in that file.

**File to change:** `__tests__/fileService.test.ts`

Add a test block for each new function following the existing mock patterns:
- `createUploadSession` — mock db insert; verify it returns the inserted row
- `getUploadSession` — test found case (returns session) and not-found case (returns null)
- `deleteUploadSession` — verify it issues a delete query for the given id

**Acceptance criteria:**
- All three functions are exported from `src/services/fileService.ts`
- New tests in `__tests__/fileService.test.ts` all pass
- All existing tests continue to pass

---

## Task 6 — Add `POST /api/files/uploads/initiate` Endpoint + Tests

**Goal:** Add the first new upload route to `src/routers/filesRouter.ts`. The client calls this once to start a multipart upload and receives the identifiers it needs to upload parts. **Do not touch or remove the existing `POST /api/files/upload` route in this task.**

**File to change:** `src/routers/filesRouter.ts`

**Route:** `POST /api/files/uploads/initiate` — must be behind `protectedRoute()`

**Request body (JSON):**
```json
{ "filename": "video.mp4", "mimeType": "video/mp4", "size": 1073741824, "folderId": "uuid-optional" }
```

**Handler logic (in order):**
1. Validate `filename` is a non-empty string → 400 if missing/empty
2. Validate `mimeType` is a non-empty string → 400 if missing/empty
3. Validate `size` is a positive integer → 400 if not
4. If `MAX_UPLOAD_BYTES` secret is ≥ 1 and `size > MAX_UPLOAD_BYTES` → 413 with message `"File exceeds maximum upload size of N bytes"` (same message format as the old endpoint)
5. Generate `fileId = randomUUID()`
6. Build S3 key: `buildS3Key(user.id, fileId, filename)`
7. Call `initiateMultipartUpload(s3Key, mimeType)` → `s3UploadId`
8. Call `createUploadSession({ id: fileId, userId: user.id, s3Key, s3UploadId, filename, mimeType, sizeBytes: size, folderId: folderId ?? null })`
9. Return `201`: `{ uploadId: s3UploadId, fileId, key: s3Key }`

**File to change:** `__tests__/filesRouter.test.ts`

Add `describe('POST /api/files/uploads/initiate', () => { ... })` with tests for:
- 201 with `{ uploadId, fileId, key }` on valid body
- 400 when `filename` is absent
- 400 when `mimeType` is absent
- 400 when `size` is absent, zero, or negative
- 413 when `size` exceeds `MAX_UPLOAD_BYTES`
- 401 when unauthenticated
- Verify `initiateMultipartUpload` is called with the built key and mimeType (mock s3Service)
- Verify `createUploadSession` is called with correct arguments (mock fileService)

**Acceptance criteria:**
- Route returns correct status and body for all cases above
- All new tests pass
- All existing tests continue to pass

---

## Task 7 — Add `PUT /api/files/uploads/:fileId/parts/:partNumber` Endpoint + Tests

**Goal:** Add the route that receives a single raw binary chunk and forwards it to S3 as a multipart part. This route must use `express.raw()` scoped to this route only — do not apply raw body parsing globally.

**File to change:** `src/routers/filesRouter.ts`

**Route:** `PUT /api/files/uploads/:fileId/parts/:partNumber` — behind `protectedRoute()`

Apply `express.raw({ type: 'application/octet-stream', limit: '15mb' })` as route-level middleware (the first middleware argument before the handler).

**Request:**
- Body: raw binary, `Content-Type: application/octet-stream`
- `:fileId` — UUID identifying the upload session
- `:partNumber` — 1-based integer

**Handler logic (in order):**
1. Parse `:partNumber` as an integer; if not a valid integer between 1 and 10000 → 400
2. Validate `req.body` is a non-empty `Buffer` → 400 if empty
3. Call `getUploadSession(fileId)` → 404 if null
4. If `session.user_id !== user.id` → 403
5. Call `uploadPart(session.s3_key, session.s3_upload_id, partNumber, req.body as Buffer)` → `etag`
6. Return `200`: `{ partNumber, etag }`

**File to change:** `__tests__/filesRouter.test.ts`

Add `describe('PUT /api/files/uploads/:fileId/parts/:partNumber', () => { ... })` with tests for:
- 200 with `{ partNumber, etag }` on valid binary body
- 400 when `:partNumber` is not a number (e.g., `"abc"`)
- 400 when `:partNumber` is out of range (0 or 10001)
- 400 when body is empty
- 404 when `fileId` does not exist in `upload_sessions`
- 403 when session belongs to a different user
- 401 when unauthenticated
- Verify `uploadPart` is called with correct `key`, `uploadId`, `partNumber`, and body buffer

**Acceptance criteria:**
- Route returns correct status and body for all cases above
- All new tests pass
- All existing tests continue to pass

---

## Task 8 — Add `POST /api/files/uploads/:fileId/complete` Endpoint + Tests

**Goal:** Add the route that finalises the multipart upload, creates the `files` DB record, and cleans up the session.

**File to change:** `src/routers/filesRouter.ts`

**Route:** `POST /api/files/uploads/:fileId/complete` — behind `protectedRoute()`

**Request body (JSON):**
```json
{
  "parts": [
    { "partNumber": 1, "etag": "\"abc123\"" },
    { "partNumber": 2, "etag": "\"def456\"" }
  ]
}
```

**Handler logic (in order):**
1. Call `getUploadSession(fileId)` → 404 if null
2. If `session.user_id !== user.id` → 403
3. Validate `parts` is a non-empty array where every element has a positive integer `partNumber` and a non-empty string `etag` → 400 if invalid
4. Sort `parts` by `partNumber` ascending
5. Map to `{ PartNumber: number; ETag: string }[]`
6. Call `completeMultipartUpload(session.s3_key, session.s3_upload_id, parts)`
7. Call `createFileRecord(session.user_id, session.folder_id, session.filename, session.s3_key, session.size_bytes, session.mime_type)` → `fileRecord`
8. Call `deleteUploadSession(fileId)`
9. Return `201`: `{ file: fileRecord }`

**File to change:** `__tests__/filesRouter.test.ts`

Add `describe('POST /api/files/uploads/:fileId/complete', () => { ... })` with tests for:
- 201 with `{ file }` on valid parts array
- 404 when `fileId` does not exist
- 403 when session belongs to a different user
- 400 when `parts` is missing, empty, or has malformed entries (missing `partNumber`, missing `etag`, non-integer `partNumber`)
- 401 when unauthenticated
- Verify `completeMultipartUpload` is called with parts sorted by `PartNumber` ascending
- Verify `createFileRecord` is called with values from the session
- Verify `deleteUploadSession` is called

**Acceptance criteria:**
- Route returns correct status and body for all cases above
- All new tests pass
- All existing tests continue to pass

---

## Task 9 — Add `DELETE /api/files/uploads/:fileId` Endpoint + Tests

**Goal:** Add the abort route. The client calls this when a chunk fails fatally or the user cancels. It aborts the S3 multipart upload (releasing staged storage) and deletes the session row.

**File to change:** `src/routers/filesRouter.ts`

**Route:** `DELETE /api/files/uploads/:fileId` — behind `protectedRoute()`

**Handler logic (in order):**
1. Call `getUploadSession(fileId)` → 404 if null
2. If `session.user_id !== user.id` → 403
3. Call `abortMultipartUpload(session.s3_key, session.s3_upload_id)`
4. Call `deleteUploadSession(fileId)`
5. Return `204` with no body

**File to change:** `__tests__/filesRouter.test.ts`

Add `describe('DELETE /api/files/uploads/:fileId', () => { ... })` with tests for:
- 204 on success
- 404 when `fileId` does not exist
- 403 when session belongs to a different user
- 401 when unauthenticated
- Verify `abortMultipartUpload` is called with the correct `key` and `uploadId`
- Verify `deleteUploadSession` is called

**Acceptance criteria:**
- Route returns correct status for all cases above
- All new tests pass
- All existing tests continue to pass

---

## Task 10 — Remove Old Multer Upload Endpoint

**Prerequisite:** All tasks in `FileManager/TASKS.md` must be complete and deployed before this task. The frontend must no longer call `POST /api/files/upload`.

**Goal:** Remove the `POST /api/files/upload` route and multer from the codebase entirely.

**Steps:**
1. In `src/routers/filesRouter.ts`: delete the `.route('/upload').post(...)` block (lines 41–106). Remove the `multer` and `memoryStorage` imports at the top of the file.
2. In `__tests__/filesRouter.test.ts`: delete all test cases inside any `describe` block that tests `POST /api/files/upload`.
3. Run `npm uninstall multer` — remove it from `package.json` and `package-lock.json`.

**Acceptance criteria:**
- The route `POST /api/files/upload` no longer exists in `filesRouter.ts`
- `multer` and `memoryStorage` are not imported anywhere in the project
- `multer` does not appear in `package.json` dependencies
- `npm run build` completes without errors
- All remaining tests pass
