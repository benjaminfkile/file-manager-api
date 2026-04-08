// ---- App / API secrets (stored in AWS Secrets Manager via AWS_SECRET_ARN) ----
export interface IAppSecrets {
  NODE_ENV: "development" | "production";
  PORT: string;
  DB_NAME: string;
  DB_HOST: string;
  DB_PROXY_URL: string;
  S3_BUCKET_NAME: string;
  CLOUDFRONT_DOMAIN?: string;
  CLOUDFRONT_KEY_PAIR_ID?: string;
  CLOUDFRONT_PRIVATE_KEY?: string;
  MAX_UPLOAD_BYTES: number;
}

// ---- User record from the users table ----
export interface IUser {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  api_key_hash: string;
  api_key_prefix: string;
  created_at: string;
  updated_at: string;
}

// ---- DB secrets (stored in AWS Secrets Manager via AWS_DB_SECRET_ARN) ----
export interface IDBSecrets {
  username: string;
  password: string;
}

// ---- Folder record from the folders table ----
export interface IFolder {
  id: string;
  user_id: string;
  parent_folder_id: string | null;
  name: string;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---- File record from the files table ----
export interface IFile {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  s3_key: string;
  size_bytes: number;
  mime_type: string;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---- DB health check result ----
export interface IDBHealth {
  connected: boolean;
  connectionUsesProxy: boolean;
  logs?: {
    messages: string[];
    host?: string;
    timestamp: string;
    error?: string;
  };
}
