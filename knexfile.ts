import type { Knex } from "knex";
import path from "path";
import dotenv from "dotenv";
import { ExtensionAgnosticMigrationSource } from "./src/db/migrationSource";

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
      process.env.DB_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  },
  migrations: {
    // Setting `directory`, `extension`, or `loadExtensions` here would silently
    // override `migrationSource`. To create a new migration file run
    //   npx knex --knexfile knexfile.ts migrate:make NAME \
    //     --migrations-directory src/db/migrations -x ts
    // or use the `migrate:make` script in package.json.
    migrationSource: new ExtensionAgnosticMigrationSource(
      path.join(__dirname, "src/db/migrations")
    ),
  },
};

export default config;
