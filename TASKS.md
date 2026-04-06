# File Manager API — Task List

> All tasks required to build the full file manager API.
> Repo: https://github.com/benjaminfkile/file-manager-api
> Run `bash create-github-issues.sh` from the project root to upload all tasks to GitHub Issues.

---

## Epic 1 — Database Setup & Migrations

### TASK-01 · Set up knex migrations infrastructure
**Labels:** `database`

Configure knex to manage DB schema via migrations. Add `migrate:latest`, `migrate:rollback`, and `migrate:make` scripts to `package.json`. Create the `src/db/migrations/` directory and configure the knex migration source in `db.ts`. Migrations should run automatically on `initDb` in non-production or be called explicitly via npm script in production.

---

### TASK-02 · Create users table migration
**Labels:** `database`

Create migration for the `users` table:
- `id` — UUID primary key (gen_random_uuid())
- `first_name` — varchar NOT NULL
- `last_name` — varchar NOT NULL
- `username` — varchar UNIQUE NOT NULL
- `api_key_hash` — varchar NOT NULL (bcrypt hash of the user's API key)
- `created_at` — timestamptz NOT NULL DEFAULT now()
- `updated_at` — timestamptz NOT NULL DEFAULT now()

Add index on `username` for fast lookup during sharing and auth.

---

### TASK-03 · Create folders table migration
**Labels:** `database`

Create migration for the `folders` table:
- `id` — UUID primary key
- `user_id` — UUID NOT NULL FK → users.id
- `parent_folder_id` — UUID NULLABLE FK → folders.id (self-referential, for sub-folders)
- `name` — varchar NOT NULL
- `is_deleted` — boolean NOT NULL DEFAULT false
- `deleted_at` — timestamptz NULLABLE
- `created_at` — timestamptz NOT NULL DEFAULT now()
- `updated_at` — timestamptz NOT NULL DEFAULT now()

Add index on `(user_id, parent_folder_id)` for efficient folder tree queries.

---

### TASK-04 · Create files table migration
**Labels:** `database`

Create migration for the `files` table:
- `id` — UUID primary key
- `user_id` — UUID NOT NULL FK → users.id
- `folder_id` — UUID NULLABLE FK → folders.id
- `name` — varchar NOT NULL
- `s3_key` — varchar NOT NULL UNIQUE (full S3 object key)
- `size_bytes` — bigint NOT NULL
- `mime_type` — varchar NOT NULL
- `is_deleted` — boolean NOT NULL DEFAULT false
- `deleted_at` — timestamptz NULLABLE
- `created_at` — timestamptz NOT NULL DEFAULT now()
- `updated_at` — timestamptz NOT NULL DEFAULT now()

Add index on `(user_id, folder_id)` and `(user_id, is_deleted)`.

---

### TASK-05 · Create file_shares table migration
**Labels:** `database`, `sharing`

Create migration for the `file_shares` table:
- `id` — UUID primary key
- `file_id` — UUID NOT NULL FK → files.id ON DELETE CASCADE
- `owner_user_id` — UUID NOT NULL FK → users.id
- `shared_with_user_id` — UUID NOT NULL FK → users.id
- `created_at` — timestamptz NOT NULL DEFAULT now()
- UNIQUE constraint on `(file_id, shared_with_user_id)`

---

### TASK-06 · Create folder_shares table migration
**Labels:** `database`, `sharing`

Create migration for the `folder_shares` table:
- `id` — UUID primary key
- `folder_id` — UUID NOT NULL FK → folders.id ON DELETE CASCADE
- `owner_user_id` — UUID NOT NULL FK → users.id
- `shared_with_user_id` — UUID NOT NULL FK → users.id
- `created_at` — timestamptz NOT NULL DEFAULT now()
- UNIQUE constraint on `(folder_id, shared_with_user_id)`

Sharing a folder grants read access to all files and sub-folders within it recursively.

---

## Epic 2 — Authentication & User Management

### TASK-07 · Refactor protectedRoute middleware for per-user API key authentication
**Labels:** `auth`

The existing `protectedRoute` middleware compares the request's `x-api-key` header against a single shared bcrypt hash in app secrets. Refactor it to:
1. Accept the raw `x-api-key` header value
2. Query the `users` table for all users (or use a cache) and `bcrypt.compare` against each `api_key_hash`
3. Attach the matched `IUser` object to `req.user`
4. Return `401` if no user matches

For performance, consider adding a DB index on a fast-lookup prefix (e.g., store the first 8 chars of the key as a plain lookup column, then bcrypt compare only the matching row).

---

### TASK-08 · Extend Express Request type to carry authenticated user
**Labels:** `auth`

Add a TypeScript declaration merge in `src/types.ts` (or a new `src/@types/express/index.d.ts`) to add `user: IUser` to the Express `Request` interface. Add the `IUser` interface to `src/interfaces.ts`.

---

### TASK-09 · POST /api/users/register — create a new user
**Labels:** `auth`, `api`

Endpoint: `POST /api/users/register`
- **Not** behind `protectedRoute` (this is how users get an API key)
- Body: `{ first_name, last_name, username, api_key }`
- Validate all fields are present; validate `username` is alphanumeric + underscores only
- Check `username` is not already taken → `409 Conflict`
- Hash `api_key` with bcrypt and store the hash
- Return `201` with `{ id, first_name, last_name, username, created_at }` (never return the key or hash)

---

### TASK-10 · GET /api/users/me — return current authenticated user
**Labels:** `auth`, `api`

Endpoint: `GET /api/users/me`
- Behind `protectedRoute`
- Returns `{ id, first_name, last_name, username, created_at }` for the authenticated user

---

### TASK-11 · GET /api/users/search — search users by username
**Labels:** `auth`, `api`

Endpoint: `GET /api/users/search?q=<partial_username>`
- Behind `protectedRoute`
- Returns array of `{ id, username, first_name, last_name }` matching the query (ILIKE search)
- Exclude the current user from results
- Used by the React client when sharing files/folders with other users

---

## Epic 3 — S3 Service

### TASK-12 · Install S3 and file-upload npm dependencies
**Labels:** `s3`

Install the following packages:
- `@aws-sdk/client-s3` — S3 SDK
- `@aws-sdk/s3-request-presigner` — presigned URL generation
- `@aws-sdk/cloudfront-signer` — CloudFront signed URL generation (for CDN)
- `multer` — multipart file upload middleware
- `multer-s3` — multer storage engine for S3 (optional; consider streaming directly)
- `archiver` — zip stream for folder downloads
- `uuid` — UUID generation for IDs
- Dev types: `@types/multer`, `@types/archiver`, `@types/uuid`

---

### TASK-13 · Add S3 and CDN configuration to IAppSecrets
**Labels:** `s3`, `cdn`

Add the following fields to the `IAppSecrets` interface in `src/interfaces.ts`:
- `S3_BUCKET_NAME` — the S3 bucket for all file storage
- `CLOUDFRONT_DOMAIN` — the CloudFront distribution domain (optional, for CDN signed URLs)
- `CLOUDFRONT_KEY_PAIR_ID` — CloudFront key pair ID for signed URL generation (optional)
- `CLOUDFRONT_PRIVATE_KEY` — PEM private key string for signing CloudFront URLs (optional)

Update the corresponding AWS Secrets Manager secret to include these values.

---

### TASK-14 · Create S3 service module
**Labels:** `s3`

Create `src/aws/s3Service.ts` with the following functions:
- `uploadObject(key: string, body: Buffer | Readable, contentType: string, size: number): Promise<void>`
- `getObjectStream(key: string): Promise<Readable>`
- `deleteObject(key: string): Promise<void>`
- `deleteObjects(keys: string[]): Promise<void>` — batch delete for folder/recycle-bin purge
- `generatePresignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>`
- `headObject(key: string): Promise<{ contentLength: number; contentType: string }>`

Use the singleton `S3Client` pattern (do not recreate the client per request). The EC2 instance profile already has permissions to the bucket; no explicit credentials needed.

---

### TASK-15 · Define S3 key naming strategy
**Labels:** `s3`

All S3 objects should be stored under a predictable, user-scoped key structure to prevent path collisions and simplify access control auditing:

```
files/{userId}/{fileId}/{originalFilename}
```

Document this convention in `src/aws/s3Service.ts` as a JSDoc comment and create a helper `buildS3Key(userId: string, fileId: string, filename: string): string`.

---

## Epic 4 — Folder Management

### TASK-16 · Create folder model and service layer
**Labels:** `api`

Create `src/services/folderService.ts` with the following functions:
- `createFolder(userId, name, parentFolderId?): Promise<IFolder>`
- `getFolderById(folderId): Promise<IFolder | null>`
- `listRootFolders(userId): Promise<IFolder[]>` — non-deleted root folders owned by or shared with the user
- `listFolderContents(folderId, userId): Promise<{ folders: IFolder[], files: IFile[] }>` — non-deleted direct children
- `renameFolder(folderId, name): Promise<IFolder>`
- `softDeleteFolder(folderId): Promise<void>` — recursively marks folder and all descendants + their files as deleted
- `restoreFolder(folderId): Promise<void>` — recursively restores folder and all descendants + their files
- `hardDeleteFolder(folderId, s3DeleteFn): Promise<void>` — deletes from DB and S3 recursively

Add `IFolder` to `src/interfaces.ts`.

---

### TASK-17 · POST /api/folders — create a new folder
**Labels:** `api`

Endpoint: `POST /api/folders`
- Behind `protectedRoute`
- Body: `{ name: string, parentFolderId?: string }`
- Validate `name` is non-empty and contains no path traversal characters
- If `parentFolderId` is provided, verify it exists, is not deleted, and is owned by the current user
- Returns `201` with the new `IFolder`

---

### TASK-18 · GET /api/folders — list root-level folders
**Labels:** `api`

Endpoint: `GET /api/folders`
- Behind `protectedRoute`
- Returns all non-deleted root folders (`parent_folder_id IS NULL`) that the user owns OR folders shared with them at the root level
- Response: `{ folders: IFolder[] }`

---

### TASK-19 · GET /api/folders/:id — get folder contents
**Labels:** `api`

Endpoint: `GET /api/folders/:id`
- Behind `protectedRoute`
- Returns all non-deleted direct children (sub-folders and files) of the specified folder
- Must verify the requesting user owns the folder or has a `folder_shares` record
- Response: `{ folder: IFolder, subFolders: IFolder[], files: IFile[] }`

---

### TASK-20 · PATCH /api/folders/:id — rename a folder
**Labels:** `api`

Endpoint: `PATCH /api/folders/:id`
- Behind `protectedRoute`
- Body: `{ name: string }`
- Only the owner of the folder can rename it
- Validate the new name contains no path traversal characters
- Returns `200` with the updated `IFolder`

---

### TASK-21 · DELETE /api/folders/:id — soft-delete folder to recycle bin
**Labels:** `api`, `recycle-bin`

Endpoint: `DELETE /api/folders/:id`
- Behind `protectedRoute`
- Only the owner can delete
- Recursively sets `is_deleted = true` and `deleted_at = now()` on the folder, all descendant folders, and all files within them
- Does NOT delete from S3 — recycle bin is purely a DB soft-delete
- Returns `204`

---

### TASK-22 · POST /api/folders/:id/restore — restore folder from recycle bin
**Labels:** `api`, `recycle-bin`

Endpoint: `POST /api/folders/:id/restore`
- Behind `protectedRoute`
- Only the owner can restore
- Recursively sets `is_deleted = false`, `deleted_at = NULL` on the folder and all descendants
- If the parent folder is also soft-deleted, the restore should stop at the immediate folder (do not restore parents automatically; return a `409` explaining the parent is in recycle bin)
- Returns `200` with the restored `IFolder`

---

### TASK-23 · DELETE /api/folders/:id/permanent — permanently delete folder
**Labels:** `api`, `recycle-bin`

Endpoint: `DELETE /api/folders/:id/permanent`
- Behind `protectedRoute`
- Only the owner can permanently delete
- Collects all `s3_key` values for all files in the folder tree, batch-deletes from S3, then deletes all DB records
- Returns `204`

---

### TASK-24 · GET /api/folders/:id/download — download folder as zip
**Labels:** `api`, `s3`

Endpoint: `GET /api/folders/:id/download`
- Behind `protectedRoute`
- User must be owner or have shared access
- Streams a zip file back to the client containing all non-deleted files in the folder and all sub-folders (maintains directory structure within the zip)
- Use `archiver` to pipe the zip stream into the HTTP response
- Set `Content-Disposition: attachment; filename="{folderName}.zip"`
- Returns `200` with octet-stream

---

## Epic 5 — File Management

### TASK-25 · Create file model and service layer
**Labels:** `api`, `s3`

Create `src/services/fileService.ts` with the following functions:
- `createFileRecord(userId, folderId, name, s3Key, sizeBytes, mimeType): Promise<IFile>`
- `getFileById(fileId): Promise<IFile | null>`
- `listFilesInFolder(folderId, userId): Promise<IFile[]>`
- `renameFile(fileId, name): Promise<IFile>`
- `softDeleteFile(fileId): Promise<void>`
- `restoreFile(fileId): Promise<void>`
- `hardDeleteFile(fileId, s3DeleteFn): Promise<void>`

Add `IFile` to `src/interfaces.ts`.

---

### TASK-26 · POST /api/files/upload — upload a file
**Labels:** `api`, `s3`

Endpoint: `POST /api/files/upload`
- Behind `protectedRoute`
- Accepts `multipart/form-data` with fields: `file` (the binary), `folderId` (optional UUID string), `name` (optional override for the filename)
- Use `multer` with memory or stream storage to receive the file
- Generate a UUID for the file record, build the S3 key using the naming strategy from TASK-15, upload to S3
- Record the file metadata in the `files` table
- Return `201` with the new `IFile`
- Enforce a reasonable max file size limit (configurable via `MAX_UPLOAD_BYTES` in secrets)

---

### TASK-27 · GET /api/files/:id/download — download a single file
**Labels:** `api`, `s3`, `cdn`

Endpoint: `GET /api/files/:id/download`
- Behind `protectedRoute`
- User must be owner or have a `file_shares` record (or access via a shared parent folder)
- If CDN/CloudFront is configured: generate a short-lived signed CloudFront URL and return `{ url }` with `302` redirect or `200 { url }` for the React client to handle
- If no CDN: generate a short-lived S3 presigned URL and redirect
- Set appropriate `Content-Disposition` header for download

---

### TASK-28 · GET /api/files/:id/preview — get media preview URL
**Labels:** `api`, `s3`, `cdn`

Endpoint: `GET /api/files/:id/preview`
- Behind `protectedRoute`
- User must be owner or have access
- Intended for the React client to display photos inline or stream video using an `<img>` / `<video>` tag
- Returns `{ url: string, mimeType: string, expiresAt: string }` — a signed URL valid for a configurable TTL (e.g., 15 minutes)
- If CloudFront is configured, return a CloudFront signed URL; otherwise return an S3 presigned URL
- The client must obtain this URL from the API (proving auth) before the browser can fetch the media — this ensures files are always protected

---

### TASK-29 · PATCH /api/files/:id — rename a file
**Labels:** `api`

Endpoint: `PATCH /api/files/:id`
- Behind `protectedRoute`
- Only the owner can rename
- Body: `{ name: string }`
- Validate no path traversal characters; preserve the original file extension if the new name omits it
- Returns `200` with updated `IFile`

---

### TASK-30 · DELETE /api/files/:id — soft-delete file to recycle bin
**Labels:** `api`, `recycle-bin`

Endpoint: `DELETE /api/files/:id`
- Behind `protectedRoute`
- Only the owner can delete
- Sets `is_deleted = true`, `deleted_at = now()` on the file record
- Returns `204`

---

### TASK-31 · POST /api/files/:id/restore — restore file from recycle bin
**Labels:** `api`, `recycle-bin`

Endpoint: `POST /api/files/:id/restore`
- Behind `protectedRoute`
- Only the owner can restore
- Checks that the file's parent folder (if any) is not also soft-deleted; if the parent is deleted, return `409` with a message indicating the parent folder must be restored first
- Sets `is_deleted = false`, `deleted_at = NULL`
- Returns `200` with the restored `IFile`

---

### TASK-32 · DELETE /api/files/:id/permanent — permanently delete a file
**Labels:** `api`, `recycle-bin`, `s3`

Endpoint: `DELETE /api/files/:id/permanent`
- Behind `protectedRoute`
- Only the owner can permanently delete
- Deletes the S3 object first, then deletes the DB record (cascade removes any shares)
- Returns `204`

---

## Epic 6 — Recycle Bin

### TASK-33 · GET /api/recycle-bin — list all soft-deleted items
**Labels:** `api`, `recycle-bin`

Endpoint: `GET /api/recycle-bin`
- Behind `protectedRoute`
- Returns all files and folders owned by the current user where `is_deleted = true`
- Include only top-level deleted items (i.e., folders whose `parent_folder_id` is either NULL or a non-deleted folder) to avoid duplicates when a whole folder tree was deleted
- Response: `{ folders: IFolder[], files: IFile[] }`

---

### TASK-34 · POST /api/recycle-bin/restore-all — restore all items in recycle bin
**Labels:** `api`, `recycle-bin`

Endpoint: `POST /api/recycle-bin/restore-all`
- Behind `protectedRoute`
- Restores all soft-deleted files and folders owned by the current user
- Returns `200` with counts: `{ restoredFolders: number, restoredFiles: number }`

---

### TASK-35 · DELETE /api/recycle-bin/empty — empty the recycle bin
**Labels:** `api`, `recycle-bin`, `s3`

Endpoint: `DELETE /api/recycle-bin/empty`
- Behind `protectedRoute`
- Collects all S3 keys for soft-deleted files owned by the user, batch-deletes from S3, then deletes all soft-deleted file and folder records from the DB
- Returns `204`

---

## Epic 7 — File & Folder Sharing

### TASK-36 · Create sharing service layer
**Labels:** `sharing`

Create `src/services/sharingService.ts` with:
- `shareFile(fileId, ownerUserId, shareWithUsername): Promise<IFileShare>`
- `unshareFile(fileId, ownerUserId, sharedWithUserId): Promise<void>`
- `getFileShares(fileId): Promise<IFileShare[]>`
- `shareFolder(folderId, ownerUserId, shareWithUsername): Promise<IFolderShare>` — sharing a folder grants access to all its contents recursively
- `unshareFolder(folderId, ownerUserId, sharedWithUserId): Promise<void>`
- `getFolderShares(folderId): Promise<IFolderShare[]>`
- `getItemsSharedWithUser(userId): Promise<{ files: IFile[], folders: IFolder[] }>`

Add `IFileShare` and `IFolderShare` to `src/interfaces.ts`.

---

### TASK-37 · POST /api/files/:id/share — share a file with a user
**Labels:** `api`, `sharing`

Endpoint: `POST /api/files/:id/share`
- Behind `protectedRoute`
- Body: `{ username: string }`
- Only the owner of the file can share it
- Look up the target user by username; return `404` if not found
- Create a `file_shares` record; if it already exists return `409`
- Returns `201` with `{ sharedWith: { id, username, first_name, last_name } }`

---

### TASK-38 · DELETE /api/files/:id/share/:sharedUserId — remove a file share
**Labels:** `api`, `sharing`

Endpoint: `DELETE /api/files/:id/share/:sharedUserId`
- Behind `protectedRoute`
- Only the owner can remove a share
- Returns `204`

---

### TASK-39 · GET /api/files/:id/shares — list users a file is shared with
**Labels:** `api`, `sharing`

Endpoint: `GET /api/files/:id/shares`
- Behind `protectedRoute`
- Only the owner can see share list
- Returns `{ sharedWith: [{ id, username, first_name, last_name, sharedAt }] }`

---

### TASK-40 · POST /api/folders/:id/share — share a folder with a user
**Labels:** `api`, `sharing`

Endpoint: `POST /api/folders/:id/share`
- Behind `protectedRoute`
- Body: `{ username: string }`
- Only the owner can share
- Sharing a folder implicitly grants access to all files and sub-folders within it (evaluated at query time via the `folder_shares` table — no need to duplicate share records for each child)
- Returns `201` with `{ sharedWith: { id, username, first_name, last_name } }`

---

### TASK-41 · DELETE /api/folders/:id/share/:sharedUserId — remove a folder share
**Labels:** `api`, `sharing`

Endpoint: `DELETE /api/folders/:id/share/:sharedUserId`
- Behind `protectedRoute`
- Only the owner can remove a share
- Returns `204`

---

### TASK-42 · GET /api/folders/:id/shares — list users a folder is shared with
**Labels:** `api`, `sharing`

Endpoint: `GET /api/folders/:id/shares`
- Behind `protectedRoute`
- Only the owner can view
- Returns `{ sharedWith: [{ id, username, first_name, last_name, sharedAt }] }`

---

### TASK-43 · GET /api/shared — list all items shared with current user
**Labels:** `api`, `sharing`

Endpoint: `GET /api/shared`
- Behind `protectedRoute`
- Returns all files and folders shared with the authenticated user (i.e., records in `file_shares` and `folder_shares` where `shared_with_user_id = req.user.id`)
- Response: `{ files: IFile[], folders: IFolder[] }`

---

## Epic 8 — Access Control

### TASK-44 · Create reusable access-control helpers
**Labels:** `access-control`

Create `src/utils/accessControl.ts` with:
- `canAccessFile(userId: string, fileId: string, db: Knex): Promise<boolean>` — returns true if the user owns the file OR has a `file_shares` record, OR the file is in a folder that is shared with the user (walk up the folder tree checking `folder_shares`)
- `canAccessFolder(userId: string, folderId: string, db: Knex): Promise<boolean>` — returns true if the user owns the folder OR has a `folder_shares` record, OR any ancestor folder is shared with the user

These helpers are used across all file and folder endpoints to gate access without duplicating logic.

---

### TASK-45 · Apply access-control helpers to all file and folder read endpoints
**Labels:** `access-control`, `api`

Update every endpoint that reads file or folder data (GET /api/folders/:id, GET /api/files/:id/download, GET /api/files/:id/preview, GET /api/folders/:id/download) to call `canAccessFile` or `canAccessFolder` before serving the response. Return `403 Forbidden` if access is denied, `404` if the resource does not exist.

---

## Epic 9 — CDN & Caching

### TASK-46 · Design CDN-safe signed URL caching strategy
**Labels:** `cdn`

Document and implement the following CDN caching architecture to ensure files are always protected:

1. The S3 bucket has **no public access** — all objects are private
2. A CloudFront distribution is placed in front of S3 using **Origin Access Control (OAC)**; only CloudFront can fetch from S3
3. CloudFront is configured to **require signed URLs** (trusted key group) — unsigned requests are rejected at the edge
4. The API validates `x-api-key`, then generates a **short-lived CloudFront signed URL** (e.g., 15-minute TTL) for the specific file
5. CloudFront caches the S3 object at the edge keyed on the file path (NOT the signature query params); the cache key must be configured to **exclude signature query string params** so the same content is served from cache on subsequent signed requests for the same file
6. The signed URL expiry enforces re-authentication — users must call the API again to get a fresh URL

Create `docs/cdn-caching-strategy.md` capturing this architecture with a diagram in ASCII or Mermaid.

---

### TASK-47 · Implement CloudFront signed cookies (downloads) and signed URLs (previews)
**Labels:** `cdn`, `s3`

Downloads and previews have different resumability requirements so they must use different CloudFront signing mechanisms.

**`GET /api/files/:id/download` — use CloudFront Signed Cookies:**
- CloudFront signed cookies are sent via `Set-Cookie` response headers and are included automatically by the browser on every subsequent request to the distribution — including `Range` requests issued when a download is interrupted and resumed
- This correctly handles large files (10 GB+) on slow or flaky connections where mid-transfer TCP drops would otherwise invalidate a signed URL
- Use `@aws-sdk/cloudfront-signer` (`getSignedCookies`) with a longer TTL (e.g., 24 hours, configurable via `CLOUDFRONT_DOWNLOAD_COOKIE_TTL_SECONDS` in secrets)
- The API sets three `CloudFront-*` cookies (`CloudFront-Policy`, `CloudFront-Signature`, `CloudFront-Key-Pair-Id`) scoped to the CloudFront domain, then returns `{ url }` pointing to the file path on the distribution
- The React client follows the URL to trigger the download; the browser sends the cookies automatically

**`GET /api/files/:id/preview` — use CloudFront Signed URLs:**
- Photos and video streams played in-browser do not need resumability — a broken stream just restarts from the beginning
- Use `@aws-sdk/cloudfront-signer` (`getSignedUrl`) with a short TTL (e.g., 15 minutes, configurable via `CLOUDFRONT_PREVIEW_URL_TTL_SECONDS`)
- Returns `{ url, mimeType, expiresAt }`

**Fallback (no CloudFront configured):**
- Both endpoints fall back to S3 presigned URLs via `@aws-sdk/s3-request-presigner`
- Note: S3 presigned URLs also only validate at connection time, so large downloads are safe in the fallback path too

This keeps local development working without a CDN while production always routes through CloudFront with full resumption support.

---

## Epic 10 — Testing

### TASK-48 · Unit tests for user service
**Labels:** `testing`

Add unit tests in `__tests__/userService.test.ts` covering:
- `createUser` — happy path, duplicate username error
- `getUserByApiKey` — matching key returns user, wrong key returns null
- `getUserById`, `searchUsersByUsername`

Mock the knex DB client.

---

### TASK-49 · Unit tests for folder service
**Labels:** `testing`

Add unit tests in `__tests__/folderService.test.ts` covering:
- `createFolder` — with and without parent
- `softDeleteFolder` — verify recursive child marking
- `restoreFolder` — verify recursive restore
- `hardDeleteFolder` — verify S3 delete is called for all file keys

---

### TASK-50 · Unit tests for file service
**Labels:** `testing`

Add unit tests in `__tests__/fileService.test.ts` covering:
- `createFileRecord`
- `softDeleteFile`
- `restoreFile` — with blocked parent folder scenario
- `hardDeleteFile` — verify S3 delete called

---

### TASK-51 · Unit tests for sharing service
**Labels:** `testing`, `sharing`

Add unit tests in `__tests__/sharingService.test.ts` covering:
- `shareFile` — happy path, duplicate share conflict
- `unshareFile`
- `shareFolder`
- `getItemsSharedWithUser`

---

### TASK-52 · Integration tests for per-user API key auth middleware
**Labels:** `testing`, `auth`

Add integration tests in `__tests__/auth.test.ts` covering:
- Request with no `x-api-key` header → 401
- Request with invalid key → 401
- Request with valid key → 200 and `req.user` populated
- Two different users with different keys both authenticate correctly

---

### TASK-53 · Integration tests for folder CRUD endpoints
**Labels:** `testing`, `api`

Add integration tests in `__tests__/foldersRouter.test.ts` covering all folder endpoints: create, list root, get contents, rename, soft-delete, restore, permanent delete, and download as zip.

---

### TASK-54 · Integration tests for file upload and download endpoints
**Labels:** `testing`, `api`, `s3`

Add integration tests in `__tests__/filesRouter.test.ts` covering: upload, download (presigned URL returned), preview URL, rename, soft-delete, restore, permanent delete. Mock S3 calls with `@aws-sdk/client-s3` mocks or `jest.mock`.

---

### TASK-55 · Integration tests for recycle bin endpoints
**Labels:** `testing`, `recycle-bin`

Add integration tests in `__tests__/recycleBinRouter.test.ts` covering: list deleted items, restore all, empty recycle bin. Verify S3 batch delete is called on empty.

---

### TASK-56 · Integration tests for sharing endpoints
**Labels:** `testing`, `sharing`

Add integration tests in `__tests__/sharingRouter.test.ts` covering: share file with user, remove share, list shares, share folder, remove folder share, and GET /api/shared returns correct items. Verify a shared user can access the file and the owner can revoke.

---

_Total: 56 tasks across 10 epics._
