import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./src/app";
import { getAppSecrets } from "./src/aws/getAppSecrets";
import { getDBSecrets } from "./src/aws/getDBSecrets";
import { initDb } from "./src/db/db";
import { initS3, ensureZipCacheLifecycleRule } from "./src/aws/s3Service";
import { startUploadSweeper } from "./src/services/uploadSweeper";
import morgan from "morgan";

process.on("uncaughtException", (err) => {
  console.error("[Fatal] Uncaught exception:", err);
  console.log("Node NOT Exiting...");
});

async function start() {
  try {
    const appSecrets = await getAppSecrets();
    const dbSecrets = await getDBSecrets();

    app.set("secrets", appSecrets);

    initS3(appSecrets.S3_BUCKET_NAME);

    try {
      await ensureZipCacheLifecycleRule();
    } catch (err) {
      console.error(
        "[Startup] Failed to ensure zip-cache lifecycle rule (continuing):",
        err
      );
    }

    const morganFormat =
      appSecrets.NODE_ENV === "production" ? "tiny" : "common";
    app.use(morgan(morganFormat));

    const port = parseInt(appSecrets.PORT) || 8000;

    await initDb(dbSecrets, appSecrets);

    startUploadSweeper();

    const server = http.createServer(app);

    process.on("SIGINT", () => {
      server.close(() => {
        console.log("Server closed (SIGINT)");
        process.exit(0);
      });
    });

    process.on("SIGTERM", () => {
      server.close(() => {
        console.log("Server closed (SIGTERM)");
        process.exit(0);
      });
    });

    server.listen(port, () => {
      console.log(`⚡️[server]: Running at http://localhost:${port}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
