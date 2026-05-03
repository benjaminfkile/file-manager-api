/* ------------------------------------------------------------------ */
/*  Mock the knex DB client                                            */
/* ------------------------------------------------------------------ */

const mockSelectChain: { whereRaw: jest.Mock } = {
  whereRaw: jest.fn(),
};

const mockTableBuilder = {
  select: jest.fn(() => mockSelectChain),
};

const mockDb: jest.Mock = jest.fn(() => mockTableBuilder);

jest.mock("../src/db/db", () => ({
  getDb: jest.fn(() => mockDb),
}));

/* ------------------------------------------------------------------ */
/*  Mock S3 + fileService                                              */
/* ------------------------------------------------------------------ */

jest.mock("../src/aws/s3Service", () => ({
  abortMultipartUpload: jest.fn(),
}));

jest.mock("../src/services/fileService", () => ({
  deleteUploadSession: jest.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Imports after mocks                                                */
/* ------------------------------------------------------------------ */

import {
  sweepAbandonedUploadSessions,
  startUploadSweeper,
  stopUploadSweeper,
} from "../src/services/uploadSweeper";
import { abortMultipartUpload } from "../src/aws/s3Service";
import { deleteUploadSession } from "../src/services/fileService";

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectChain.whereRaw.mockReset();
});

afterEach(() => {
  stopUploadSweeper();
  delete process.env.DISABLE_UPLOAD_SWEEPER;
});

describe("sweepAbandonedUploadSessions", () => {
  it("aborts S3 upload and deletes the session row for each old session", async () => {
    const oldSessions = [
      { id: "sess-1", s3_key: "k1", s3_upload_id: "u1" },
      { id: "sess-2", s3_key: "k2", s3_upload_id: "u2" },
    ];
    mockSelectChain.whereRaw.mockResolvedValue(oldSessions);
    (abortMultipartUpload as jest.Mock).mockResolvedValue(undefined);
    (deleteUploadSession as jest.Mock).mockResolvedValue(undefined);

    const count = await sweepAbandonedUploadSessions();

    expect(count).toBe(2);
    expect(abortMultipartUpload).toHaveBeenCalledTimes(2);
    expect(abortMultipartUpload).toHaveBeenNthCalledWith(1, "k1", "u1");
    expect(abortMultipartUpload).toHaveBeenNthCalledWith(2, "k2", "u2");
    expect(deleteUploadSession).toHaveBeenCalledTimes(2);
    expect(deleteUploadSession).toHaveBeenNthCalledWith(1, "sess-1");
    expect(deleteUploadSession).toHaveBeenNthCalledWith(2, "sess-2");
  });

  it("does not call abort or delete when there are no old sessions", async () => {
    mockSelectChain.whereRaw.mockResolvedValue([]);

    const count = await sweepAbandonedUploadSessions();

    expect(count).toBe(0);
    expect(abortMultipartUpload).not.toHaveBeenCalled();
    expect(deleteUploadSession).not.toHaveBeenCalled();
  });

  it("uses a 48-hour cutoff in the where clause", async () => {
    mockSelectChain.whereRaw.mockResolvedValue([]);

    await sweepAbandonedUploadSessions();

    expect(mockSelectChain.whereRaw).toHaveBeenCalledTimes(1);
    const arg = mockSelectChain.whereRaw.mock.calls[0][0];
    expect(arg).toMatch(/48 hours/i);
    expect(arg).toMatch(/created_at/);
  });

  it("swallows abortMultipartUpload errors and still deletes the session", async () => {
    const oldSessions = [{ id: "sess-1", s3_key: "k1", s3_upload_id: "u1" }];
    mockSelectChain.whereRaw.mockResolvedValue(oldSessions);
    (abortMultipartUpload as jest.Mock).mockRejectedValue(new Error("S3 down"));
    (deleteUploadSession as jest.Mock).mockResolvedValue(undefined);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const count = await sweepAbandonedUploadSessions();

    expect(count).toBe(1);
    expect(deleteUploadSession).toHaveBeenCalledWith("sess-1");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("startUploadSweeper toggle", () => {
  it("does not register an interval when DISABLE_UPLOAD_SWEEPER=true", () => {
    process.env.DISABLE_UPLOAD_SWEEPER = "true";
    const setSpy = jest.spyOn(global, "setInterval");

    startUploadSweeper();

    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("registers an hourly interval when not disabled", () => {
    mockSelectChain.whereRaw.mockResolvedValue([]);
    const setSpy = jest.spyOn(global, "setInterval");

    startUploadSweeper();

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][1]).toBe(60 * 60 * 1000);

    setSpy.mockRestore();
  });
});
