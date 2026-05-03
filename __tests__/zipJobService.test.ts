import { IZipJob } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Mock the knex DB client                                            */
/* ------------------------------------------------------------------ */

const mockQueryBuilder: Record<string, jest.Mock> = {
  where: jest.fn().mockReturnThis(),
  whereIn: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  first: jest.fn(),
  select: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
};

const mockDb = jest.fn((): any => mockQueryBuilder) as jest.Mock & {
  raw: jest.Mock;
  fn: { now: jest.Mock };
};
mockDb.raw = jest.fn();
mockDb.fn = { now: jest.fn(() => "NOW()") };

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

/* ------------------------------------------------------------------ */
/*  Mock the S3 service                                                */
/* ------------------------------------------------------------------ */

const mockS3KeyExists = jest.fn() as jest.Mock<Promise<boolean>, [string]>;
const mockGetObjectStream = jest.fn() as jest.Mock<Promise<unknown>, [string]>;
mockGetObjectStream.mockResolvedValue("<stream>");

jest.mock("../src/aws/s3Service", () => ({
  s3KeyExists: (key: string) => mockS3KeyExists(key),
  getS3Client: jest.fn(() => ({})),
  getBucketName: jest.fn(() => "test-bucket"),
  getObjectStream: (key: string) => mockGetObjectStream(key),
}));

/* ------------------------------------------------------------------ */
/*  Mock app secrets                                                   */
/* ------------------------------------------------------------------ */

jest.mock("../src/aws/getAppSecrets", () => ({
  getAppSecrets: jest.fn(async () => ({})),
}));

/* ------------------------------------------------------------------ */
/*  Mock folderService (collectFolderFiles + getFolderById)            */
/* ------------------------------------------------------------------ */

const mockCollectFolderFiles = jest.fn() as jest.Mock<Promise<unknown[]>, [string]>;
const mockGetFolderById = jest.fn() as jest.Mock<Promise<unknown>, [string]>;

jest.mock("../src/services/folderService", () => ({
  collectFolderFiles: (id: string) => mockCollectFolderFiles(id),
  getFolderById: (id: string) => mockGetFolderById(id),
}));

/* ------------------------------------------------------------------ */
/*  Mock archiver                                                      */
/* ------------------------------------------------------------------ */

const mockArchivePipe = jest.fn();
const mockArchiveAppend = jest.fn();
const mockArchiveFinalize = jest.fn(async () => undefined);
const mockArchiverFactory = jest.fn() as jest.Mock<
  { pipe: jest.Mock; append: jest.Mock; finalize: jest.Mock },
  [string, unknown?]
>;
mockArchiverFactory.mockImplementation(() => ({
  pipe: mockArchivePipe,
  append: mockArchiveAppend,
  finalize: mockArchiveFinalize,
}));

jest.mock("archiver", () => ({
  __esModule: true,
  default: (format: string, options?: unknown) =>
    mockArchiverFactory(format, options),
}));

/* ------------------------------------------------------------------ */
/*  Mock @aws-sdk/lib-storage Upload                                   */
/* ------------------------------------------------------------------ */

const mockUploadDone = jest.fn(async () => ({}));
const mockUploadCtor = jest.fn();

jest.mock("@aws-sdk/lib-storage", () => ({
  Upload: jest.fn().mockImplementation((args: any) => {
    mockUploadCtor(args);
    return { done: mockUploadDone };
  }),
}));

/* ------------------------------------------------------------------ */
/*  Import after mocks are in place                                    */
/* ------------------------------------------------------------------ */

import {
  computeFolderHash,
  getOrCreateZipJob,
  runZipJob,
  Semaphore,
  _setSemaphoreCap,
} from "../src/services/zipJobService";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fakeJob: IZipJob = {
  id: "job-1",
  user_id: "user-1",
  folder_id: "folder-1",
  zip_hash: "abc123",
  s3_key: "zip-cache/user-1/abc123.zip",
  status: "pending",
  error: null,
  created_at: "2026-05-03T00:00:00Z",
  completed_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();

  // Re-wire chainable methods after clearAllMocks
  mockQueryBuilder.where.mockReturnThis();
  mockQueryBuilder.whereIn.mockReturnThis();
  mockQueryBuilder.insert.mockReturnThis();
  mockQueryBuilder.update.mockReturnThis();
  mockQueryBuilder.select.mockReturnThis();
  mockQueryBuilder.orderBy.mockReturnThis();

  mockArchiveFinalize.mockImplementation(async () => undefined);
  mockUploadDone.mockImplementation(async () => ({}));
  mockArchiverFactory.mockImplementation(() => ({
    pipe: mockArchivePipe,
    append: mockArchiveAppend,
    finalize: mockArchiveFinalize,
  }));

  // Pre-initialize semaphore so runZipJob doesn't hit getAppSecrets.
  _setSemaphoreCap(2);
});

/* ================================================================== */
/*  computeFolderHash                                                  */
/* ================================================================== */

describe("computeFolderHash", () => {
  it("returns the same hash for identical folder content", async () => {
    const folderRows = { rows: [{ id: "folder-1" }] };
    const files = [
      { s3_key: "k1", updated_at: "2026-01-01T00:00:00Z" },
      { s3_key: "k2", updated_at: "2026-01-02T00:00:00Z" },
    ];

    mockDb.raw.mockResolvedValueOnce(folderRows);
    mockQueryBuilder.orderBy.mockResolvedValueOnce(files);
    const hash1 = await computeFolderHash("folder-1");

    mockDb.raw.mockResolvedValueOnce(folderRows);
    mockQueryBuilder.orderBy.mockResolvedValueOnce(files);
    const hash2 = await computeFolderHash("folder-1");

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns a different hash when a file's updated_at changes", async () => {
    const folderRows = { rows: [{ id: "folder-1" }] };

    mockDb.raw.mockResolvedValueOnce(folderRows);
    mockQueryBuilder.orderBy.mockResolvedValueOnce([
      { s3_key: "k1", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    const hash1 = await computeFolderHash("folder-1");

    mockDb.raw.mockResolvedValueOnce(folderRows);
    mockQueryBuilder.orderBy.mockResolvedValueOnce([
      { s3_key: "k1", updated_at: "2026-01-02T00:00:00Z" },
    ]);
    const hash2 = await computeFolderHash("folder-1");

    expect(hash1).not.toBe(hash2);
  });

  it("returns the empty-folder hash when no folders are visible", async () => {
    mockDb.raw.mockResolvedValueOnce({ rows: [] });
    const hash = await computeFolderHash("missing");
    // sha256('[]')
    expect(hash).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
    );
  });
});

/* ================================================================== */
/*  getOrCreateZipJob                                                  */
/* ================================================================== */

describe("getOrCreateZipJob", () => {
  it("returns a ready job from S3 cache without inserting or running", async () => {
    // computeFolderHash mock chain
    mockDb.raw.mockResolvedValueOnce({ rows: [{ id: "folder-1" }] });
    mockQueryBuilder.orderBy.mockResolvedValueOnce([
      { s3_key: "k1", updated_at: "2026-01-01" },
    ]);

    mockS3KeyExists.mockResolvedValueOnce(true);

    const job = await getOrCreateZipJob("user-1", "folder-1");

    expect(job.status).toBe("ready");
    expect(job.user_id).toBe("user-1");
    expect(job.folder_id).toBe("folder-1");
    expect(job.s3_key).toMatch(/^zip-cache\/user-1\/[a-f0-9]{64}\.zip$/);
    expect(job.completed_at).not.toBeNull();

    // No row inserted, no archive started
    expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
    // Allow any background promise microtasks to drain
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockArchiverFactory).not.toHaveBeenCalled();
    expect(mockUploadCtor).not.toHaveBeenCalled();
  });

  it("inserts a pending job and kicks off runZipJob when no cache exists", async () => {
    // computeFolderHash mock chain
    mockDb.raw.mockResolvedValueOnce({ rows: [{ id: "folder-1" }] });
    mockQueryBuilder.orderBy.mockResolvedValueOnce([
      { s3_key: "k1", updated_at: "2026-01-01" },
    ]);

    mockS3KeyExists.mockResolvedValueOnce(false);
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeJob]);

    // The background runZipJob will issue further DB calls; satisfy them
    // so the unhandled-rejection handler doesn't fire on a real failure.
    mockQueryBuilder.first.mockResolvedValueOnce(fakeJob);
    mockGetFolderById.mockResolvedValueOnce({ id: "folder-1", name: "Photos" });
    mockCollectFolderFiles.mockResolvedValueOnce([]);

    const job = await getOrCreateZipJob("user-1", "folder-1");

    expect(job).toEqual(fakeJob);
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        folder_id: "folder-1",
        status: "pending",
      })
    );
    // Drain background runZipJob
    await new Promise((resolve) => setImmediate(resolve));
  });
});

/* ================================================================== */
/*  Semaphore                                                          */
/* ================================================================== */

describe("Semaphore", () => {
  it("queues calls beyond the cap until release", async () => {
    const sem = new Semaphore(2);
    const acquired: number[] = [];

    const t1 = sem.acquire().then(() => acquired.push(1));
    const t2 = sem.acquire().then(() => acquired.push(2));
    const t3 = sem.acquire().then(() => acquired.push(3));

    // Flush microtasks
    await new Promise((resolve) => setImmediate(resolve));
    expect(acquired).toEqual([1, 2]);

    sem.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(acquired).toEqual([1, 2, 3]);

    sem.release();
    sem.release();
    sem.release();
    await Promise.all([t1, t2, t3]);
  });

  it("queues runZipJob calls beyond the cap", async () => {
    _setSemaphoreCap(1);

    // Each runZipJob will:
    //   db(ZIP_JOBS).where(...).update(...) -> running
    //   db(ZIP_JOBS).where(...).first()     -> job
    //   getFolderById(...)                  -> folder
    //   collectFolderFiles(...)             -> []
    //   archive.finalize() / upload.done()  -> resolve only when we say
    //   db(ZIP_JOBS).where(...).update(...) -> ready

    // 'first' is called twice (once per job)
    mockQueryBuilder.first
      .mockResolvedValueOnce({ ...fakeJob, id: "job-A" })
      .mockResolvedValueOnce({ ...fakeJob, id: "job-B" });

    mockGetFolderById.mockResolvedValue({ id: "folder-1", name: "F" });
    mockCollectFolderFiles.mockResolvedValue([]);

    // Hold the first job's upload until we release it.
    let releaseFirst: () => void = () => {};
    const firstUpload = new Promise<{}>((resolve) => {
      releaseFirst = () => resolve({});
    });
    mockUploadDone
      .mockImplementationOnce(() => firstUpload)
      .mockImplementationOnce(async () => ({}));

    const p1 = runZipJob("job-A");
    const p2 = runZipJob("job-B");

    // Allow microtasks: only the first should have started the upload.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockUploadCtor).toHaveBeenCalledTimes(1);

    // Release the first; second should now proceed.
    releaseFirst();
    await Promise.all([p1, p2]);

    expect(mockUploadCtor).toHaveBeenCalledTimes(2);
  });
});

/* ================================================================== */
/*  runZipJob — failure path                                           */
/* ================================================================== */

describe("runZipJob failure path", () => {
  it("marks the job as failed with the error message when the upload throws", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeJob);
    mockGetFolderById.mockResolvedValueOnce({ id: "folder-1", name: "Photos" });
    mockCollectFolderFiles.mockResolvedValueOnce([
      { s3_key: "files/user-1/f1/a.txt", zipPath: "a.txt" },
    ]);

    mockUploadDone.mockRejectedValueOnce(new Error("s3 boom"));

    await runZipJob("job-1");

    expect(mockQueryBuilder.update).toHaveBeenCalledWith({
      status: "failed",
      error: "s3 boom",
    });
  });

  it("bakes the folder name into the upload's ContentDisposition on success", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeJob);
    mockGetFolderById.mockResolvedValueOnce({
      id: "folder-1",
      name: "Vacation 2026",
    });
    mockCollectFolderFiles.mockResolvedValueOnce([]);

    await runZipJob("job-1");

    expect(mockUploadCtor).toHaveBeenCalledTimes(1);
    const call = mockUploadCtor.mock.calls[0][0];
    expect(call.params.ContentDisposition).toBe(
      'attachment; filename="Vacation 2026.zip"'
    );
    expect(call.params.Bucket).toBe("test-bucket");
    expect(call.params.Key).toBe(fakeJob.s3_key);
    expect(mockArchiverFactory).toHaveBeenCalledWith(
      "zip",
      expect.objectContaining({ zlib: expect.objectContaining({ level: 0 }) })
    );
  });
});
