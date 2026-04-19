import { IFile, IUploadSession } from "../src/interfaces";

/* ------------------------------------------------------------------ */
/*  Mock the knex DB client                                           */
/* ------------------------------------------------------------------ */

const mockQueryBuilder: Record<string, jest.Mock> = {
  where: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  first: jest.fn(),
  select: jest.fn().mockReturnThis(),
  del: jest.fn(),
};

const mockDb = jest.fn((): any => mockQueryBuilder) as jest.Mock & {
  fn: { now: jest.Mock };
};
mockDb.fn = { now: jest.fn(() => "NOW()") };

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

/* ------------------------------------------------------------------ */
/*  Import after mocks are in place                                   */
/* ------------------------------------------------------------------ */

import {
  createFileRecord,
  moveFile,
  softDeleteFile,
  restoreFile,
  hardDeleteFile,
  createUploadSession,
  getUploadSession,
  deleteUploadSession,
} from "../src/services/fileService";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const fakeFile: IFile = {
  id: "file-1",
  user_id: "user-1",
  folder_id: "folder-1",
  name: "report.pdf",
  s3_key: "files/user-1/file-1/report.pdf",
  size_bytes: 1024,
  mime_type: "application/pdf",
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-04-08T00:00:00.000Z",
  updated_at: "2026-04-08T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();

  // Re-wire chainable methods after clearAllMocks
  mockQueryBuilder.where.mockReturnThis();
  mockQueryBuilder.insert.mockReturnThis();
  mockQueryBuilder.update.mockReturnThis();
  mockQueryBuilder.select.mockReturnThis();
});

/* ================================================================== */
/*  createFileRecord                                                  */
/* ================================================================== */

describe("createFileRecord", () => {
  it("inserts a file record and returns it", async () => {
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeFile]);

    const result = await createFileRecord(
      "user-1",
      "folder-1",
      "report.pdf",
      "files/user-1/file-1/report.pdf",
      1024,
      "application/pdf"
    );

    expect(mockDb).toHaveBeenCalledWith("files");
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      folder_id: "folder-1",
      name: "report.pdf",
      s3_key: "files/user-1/file-1/report.pdf",
      size_bytes: 1024,
      mime_type: "application/pdf",
    });
    expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");
    expect(result).toEqual(fakeFile);
  });

  it("creates a file with no folder (root level)", async () => {
    const rootFile: IFile = { ...fakeFile, folder_id: null };
    mockQueryBuilder.returning.mockResolvedValueOnce([rootFile]);

    const result = await createFileRecord(
      "user-1",
      null,
      "report.pdf",
      "files/user-1/file-1/report.pdf",
      1024,
      "application/pdf"
    );

    expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ folder_id: null })
    );
    expect(result).toEqual(rootFile);
  });
});

/* ================================================================== */
/*  moveFile                                                          */
/* ================================================================== */

describe("moveFile", () => {
  it("moves a file to a folder", async () => {
    const movedFile: IFile = { ...fakeFile, folder_id: "some-folder-id" };
    mockQueryBuilder.returning.mockResolvedValueOnce([movedFile]);

    const result = await moveFile("file-1", "some-folder-id");

    expect(mockDb).toHaveBeenCalledWith("files");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({ id: "file-1" });
    expect(mockQueryBuilder.update).toHaveBeenCalledWith({
      folder_id: "some-folder-id",
      updated_at: "NOW()",
    });
    expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");
    expect(result).toEqual(movedFile);
  });

  it("moves a file to root (null folder)", async () => {
    const rootFile: IFile = { ...fakeFile, folder_id: null };
    mockQueryBuilder.returning.mockResolvedValueOnce([rootFile]);

    const result = await moveFile("file-1", null);

    expect(mockQueryBuilder.update).toHaveBeenCalledWith({
      folder_id: null,
      updated_at: "NOW()",
    });
    expect(result).toEqual(rootFile);
  });
});

/* ================================================================== */
/*  softDeleteFile                                                    */
/* ================================================================== */

describe("softDeleteFile", () => {
  it("marks the file as deleted with a timestamp", async () => {
    mockQueryBuilder.update.mockResolvedValueOnce(1);

    await softDeleteFile("file-1");

    expect(mockDb).toHaveBeenCalledWith("files");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({ id: "file-1" });
    expect(mockQueryBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_deleted: true,
        deleted_at: expect.any(String),
        updated_at: expect.any(String),
      })
    );
  });
});

/* ================================================================== */
/*  restoreFile                                                       */
/* ================================================================== */

describe("restoreFile", () => {
  it("restores a soft-deleted file", async () => {
    // First query: look up the file's folder_id
    mockQueryBuilder.first.mockResolvedValueOnce({ folder_id: "folder-1" });
    // Second query: check if parent folder is deleted — not found (not deleted)
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);
    // Third query: the update
    mockQueryBuilder.update.mockResolvedValueOnce(1);

    await restoreFile("file-1");

    expect(mockQueryBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_deleted: false,
        deleted_at: null,
        updated_at: expect.any(String),
      })
    );
  });

  it("restores a file with no parent folder", async () => {
    // File has no folder_id
    mockQueryBuilder.first.mockResolvedValueOnce({ folder_id: null });
    mockQueryBuilder.update.mockResolvedValueOnce(1);

    await restoreFile("file-1");

    expect(mockQueryBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_deleted: false, deleted_at: null })
    );
  });

  it("throws when the parent folder is also soft-deleted", async () => {
    // First query: look up the file's folder_id
    mockQueryBuilder.first.mockResolvedValueOnce({ folder_id: "folder-1" });
    // Second query: parent folder IS deleted
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "folder-1",
      is_deleted: true,
    });

    await expect(restoreFile("file-1")).rejects.toThrow(
      "The parent folder is also in the recycle bin. Restore the parent folder first."
    );

    // The update should NOT have been called
    expect(mockQueryBuilder.update).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  hardDeleteFile                                                    */
/* ================================================================== */

describe("hardDeleteFile", () => {
  it("calls s3DeleteFn with the file key and deletes the DB row", async () => {
    const mockS3Delete = jest.fn().mockResolvedValue(undefined);

    // select("s3_key").first() returns the file
    mockQueryBuilder.first.mockResolvedValueOnce({
      s3_key: "files/user-1/file-1/report.pdf",
    });
    mockQueryBuilder.del.mockResolvedValueOnce(1);

    await hardDeleteFile("file-1", mockS3Delete);

    // Looked up the s3 key
    expect(mockDb).toHaveBeenCalledWith("files");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({ id: "file-1" });
    expect(mockQueryBuilder.select).toHaveBeenCalledWith("s3_key");

    // S3 delete called with the correct key
    expect(mockS3Delete).toHaveBeenCalledWith("files/user-1/file-1/report.pdf");

    // DB row deleted
    expect(mockQueryBuilder.del).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the file does not exist", async () => {
    const mockS3Delete = jest.fn().mockResolvedValue(undefined);

    // File not found
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    await hardDeleteFile("nonexistent", mockS3Delete);

    expect(mockS3Delete).not.toHaveBeenCalled();
    expect(mockQueryBuilder.del).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  Upload Session helpers                                             */
/* ================================================================== */

const fakeSession: IUploadSession = {
  id: "session-1",
  user_id: "user-1",
  s3_key: "uploads/user-1/session-1/photo.png",
  s3_upload_id: "aws-upload-id-abc",
  filename: "photo.png",
  mime_type: "image/png",
  size_bytes: 2048,
  folder_id: null,
  created_at: "2026-04-18T00:00:00.000Z",
};

/* ================================================================== */
/*  createUploadSession                                                */
/* ================================================================== */

describe("createUploadSession", () => {
  it("inserts an upload session row and returns it", async () => {
    mockQueryBuilder.returning.mockResolvedValueOnce([fakeSession]);

    const result = await createUploadSession({
      id: "session-1",
      userId: "user-1",
      s3Key: "uploads/user-1/session-1/photo.png",
      s3UploadId: "aws-upload-id-abc",
      filename: "photo.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      folderId: null,
    });

    expect(mockDb).toHaveBeenCalledWith("upload_sessions");
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
      id: "session-1",
      user_id: "user-1",
      s3_key: "uploads/user-1/session-1/photo.png",
      s3_upload_id: "aws-upload-id-abc",
      filename: "photo.png",
      mime_type: "image/png",
      size_bytes: 2048,
      folder_id: null,
    });
    expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");
    expect(result).toEqual(fakeSession);
  });
});

/* ================================================================== */
/*  getUploadSession                                                   */
/* ================================================================== */

describe("getUploadSession", () => {
  it("returns the session when found", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(fakeSession);

    const result = await getUploadSession("session-1");

    expect(mockDb).toHaveBeenCalledWith("upload_sessions");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({ id: "session-1" });
    expect(result).toEqual(fakeSession);
  });

  it("returns null when not found", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(undefined);

    const result = await getUploadSession("nonexistent");

    expect(result).toBeNull();
  });
});

/* ================================================================== */
/*  deleteUploadSession                                                */
/* ================================================================== */

describe("deleteUploadSession", () => {
  it("issues a delete query for the given id", async () => {
    mockQueryBuilder.del.mockResolvedValueOnce(1);

    await deleteUploadSession("session-1");

    expect(mockDb).toHaveBeenCalledWith("upload_sessions");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith({ id: "session-1" });
    expect(mockQueryBuilder.del).toHaveBeenCalledTimes(1);
  });
});
