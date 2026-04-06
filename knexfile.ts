import type { Knex } from "knex";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const config: Knex.Config = {
  client: "pg",
  connection: {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "postgres",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
  },
  migrations: {
    directory: path.join(__dirname, "src/db/migrations"),
    extension: "ts",
    loadExtensions: [".ts"],
  },
};

export default config;
