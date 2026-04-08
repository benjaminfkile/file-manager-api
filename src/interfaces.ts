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
