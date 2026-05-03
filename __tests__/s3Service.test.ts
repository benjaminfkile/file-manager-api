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
  listUploadedParts,
  ensureZipCacheLifecycleRule,
} from "../src/aws/s3Service";

import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
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

describe("listUploadedParts", () => {
  it("sends ListPartsCommand with correct params and returns mapped parts", async () => {
    mockSend.mockResolvedValueOnce({
      Parts: [
        { PartNumber: 1, ETag: '"abc"', Size: 1024 },
        { PartNumber: 2, ETag: '"def"', Size: 2048 },
      ],
      IsTruncated: false,
    });

    const result = await listUploadedParts("files/u/f/pic.png", "upload-123");

    expect(result).toEqual([
      { partNumber: 1, etag: '"abc"', size: 1024 },
      { partNumber: 2, etag: '"def"', size: 2048 },
    ]);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(ListPartsCommand);
    expect(command.input).toEqual({
      Bucket: "test-bucket",
      Key: "files/u/f/pic.png",
      UploadId: "upload-123",
    });
  });

  it("paginates when IsTruncated is true, following NextPartNumberMarker", async () => {
    mockSend
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 1, ETag: '"a"', Size: 5 }],
        IsTruncated: true,
        NextPartNumberMarker: "1",
      })
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 2, ETag: '"b"', Size: 6 }],
        IsTruncated: true,
        NextPartNumberMarker: "2",
      })
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 3, ETag: '"c"', Size: 7 }],
        IsTruncated: false,
      });

    const result = await listUploadedParts("k", "u");

    expect(result).toEqual([
      { partNumber: 1, etag: '"a"', size: 5 },
      { partNumber: 2, etag: '"b"', size: 6 },
      { partNumber: 3, etag: '"c"', size: 7 },
    ]);
    expect(mockSend).toHaveBeenCalledTimes(3);

    const firstInput = mockSend.mock.calls[0][0].input;
    expect(firstInput.PartNumberMarker).toBeUndefined();
    expect(mockSend.mock.calls[1][0].input.PartNumberMarker).toBe("1");
    expect(mockSend.mock.calls[2][0].input.PartNumberMarker).toBe("2");
  });

  it("returns an empty array when no parts have been uploaded yet", async () => {
    mockSend.mockResolvedValueOnce({ IsTruncated: false });

    const result = await listUploadedParts("k", "u");

    expect(result).toEqual([]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("ensureZipCacheLifecycleRule", () => {
  it("is a noop when a rule with ID 'expire-zip-cache' already exists", async () => {
    mockSend.mockResolvedValueOnce({
      Rules: [
        {
          ID: "expire-zip-cache",
          Status: "Enabled",
          Filter: { Prefix: "zip-cache/" },
          Expiration: { Days: 7 },
        },
      ],
    });

    await ensureZipCacheLifecycleRule();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toBeInstanceOf(
      GetBucketLifecycleConfigurationCommand
    );
  });

  it("puts the rule when no lifecycle configuration exists, preserving an empty rule list", async () => {
    const noSuchConfig: any = new Error("No lifecycle configuration");
    noSuchConfig.name = "NoSuchLifecycleConfiguration";
    mockSend.mockRejectedValueOnce(noSuchConfig);
    mockSend.mockResolvedValueOnce({});

    await ensureZipCacheLifecycleRule();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0]).toBeInstanceOf(
      GetBucketLifecycleConfigurationCommand
    );

    const putCommand = mockSend.mock.calls[1][0];
    expect(putCommand).toBeInstanceOf(PutBucketLifecycleConfigurationCommand);
    expect(putCommand.input).toEqual({
      Bucket: "test-bucket",
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "expire-zip-cache",
            Status: "Enabled",
            Filter: { Prefix: "zip-cache/" },
            Expiration: { Days: 7 },
          },
        ],
      },
    });
  });

  it("merges with existing rules when the zip-cache rule is absent", async () => {
    const existingRule = {
      ID: "archive-old-files",
      Status: "Enabled",
      Filter: { Prefix: "archive/" },
      Expiration: { Days: 365 },
    };
    mockSend.mockResolvedValueOnce({ Rules: [existingRule] });
    mockSend.mockResolvedValueOnce({});

    await ensureZipCacheLifecycleRule();

    expect(mockSend).toHaveBeenCalledTimes(2);
    const putCommand = mockSend.mock.calls[1][0];
    expect(putCommand).toBeInstanceOf(PutBucketLifecycleConfigurationCommand);
    expect(putCommand.input.Bucket).toBe("test-bucket");
    expect(putCommand.input.LifecycleConfiguration.Rules).toEqual([
      existingRule,
      {
        ID: "expire-zip-cache",
        Status: "Enabled",
        Filter: { Prefix: "zip-cache/" },
        Expiration: { Days: 7 },
      },
    ]);
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
