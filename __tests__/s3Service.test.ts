/* ------------------------------------------------------------------ */
/*  Mock @aws-sdk/client-s3                                           */
/* ------------------------------------------------------------------ */

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const actual = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

/* ------------------------------------------------------------------ */
/*  Import after mocks are in place                                   */
/* ------------------------------------------------------------------ */

import {
  initS3,
  initiateMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
} from "../src/aws/s3Service";

import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";

/* ------------------------------------------------------------------ */
/*  Setup                                                             */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  process.env.AWS_REGION = "us-east-1";
  initS3("test-bucket");
});

beforeEach(() => {
  mockSend.mockReset();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("initiateMultipartUpload", () => {
  it("sends CreateMultipartUploadCommand with correct params and returns UploadId", async () => {
    mockSend.mockResolvedValueOnce({ UploadId: "upload-123" });

    const result = await initiateMultipartUpload("files/u/f/pic.png", "image/png");

    expect(result).toBe("upload-123");
    expect(mockSend).toHaveBeenCalledTimes(1);

    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(CreateMultipartUploadCommand);
    expect(command.input).toEqual({
      Bucket: "test-bucket",
      Key: "files/u/f/pic.png",
      ContentType: "image/png",
    });
  });
});

describe("uploadPart", () => {
  it("sends UploadPartCommand with correct params and returns ETag", async () => {
    mockSend.mockResolvedValueOnce({ ETag: '"abc123"' });

    const body = Buffer.from("chunk-data");
    const result = await uploadPart("files/u/f/pic.png", "upload-123", 1, body);

    expect(result).toBe('"abc123"');
    expect(mockSend).toHaveBeenCalledTimes(1);

    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(UploadPartCommand);
    expect(command.input).toEqual({
      Bucket: "test-bucket",
      Key: "files/u/f/pic.png",
      UploadId: "upload-123",
      PartNumber: 1,
      Body: body,
    });
  });
});

describe("completeMultipartUpload", () => {
  it("sends CompleteMultipartUploadCommand with correct params", async () => {
    mockSend.mockResolvedValueOnce({});

    const parts = [
      { PartNumber: 1, ETag: '"abc"' },
      { PartNumber: 2, ETag: '"def"' },
    ];

    await completeMultipartUpload("files/u/f/pic.png", "upload-123", parts);

    expect(mockSend).toHaveBeenCalledTimes(1);

    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect(command.input).toEqual({
      Bucket: "test-bucket",
      Key: "files/u/f/pic.png",
      UploadId: "upload-123",
      MultipartUpload: { Parts: parts },
    });
  });
});

describe("abortMultipartUpload", () => {
  it("sends AbortMultipartUploadCommand with correct params", async () => {
    mockSend.mockResolvedValueOnce({});

    await abortMultipartUpload("files/u/f/pic.png", "upload-123");

    expect(mockSend).toHaveBeenCalledTimes(1);

    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(AbortMultipartUploadCommand);
    expect(command.input).toEqual({
      Bucket: "test-bucket",
      Key: "files/u/f/pic.png",
      UploadId: "upload-123",
    });
  });
});
