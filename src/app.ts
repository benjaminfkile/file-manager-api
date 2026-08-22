import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import healthRouter from "./routers/healthRouter";
import usersRouter from "./routers/usersRouter";
import foldersRouter from "./routers/foldersRouter";
import filesRouter from "./routers/filesRouter";
import recycleBinRouter from "./routers/recycleBinRouter";
import sharedRouter from "./routers/sharedRouter";
import shareLinkRouter from "./routers/shareLinkRouter";

const app: Express = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging MUST be registered before the routers. It used to live in
// index.ts, which ran app.use(morgan) after every router was already mounted,
// so no routed request was ever logged. Format is picked per request from the
// secrets index.ts stores on the app (tiny in production, common elsewhere).
const morganTiny = morgan("tiny");
const morganCommon = morgan("common");
app.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "test") return next();
  const secrets = req.app.get("secrets") as { NODE_ENV?: string } | undefined;
  const logger = secrets?.NODE_ENV === "production" ? morganTiny : morganCommon;
  return logger(req, res, next);
});

app.get("/", (req: Request, res: Response) => {
  const secrets = req.app.get("secrets") as { NODE_ENV?: string } | undefined;
  const suffix = secrets?.NODE_ENV === "production" ? "" : "-dev";
  res.send(`file-manager-api${suffix}`);
});

app.use("/api/health", healthRouter);
app.use("/api/users", usersRouter);
app.use("/api/folders", foldersRouter);
app.use("/api/files", filesRouter);
app.use("/api/recycle-bin", recycleBinRouter);
app.use("/api/shared", sharedRouter);
app.use("/api/share-links", shareLinkRouter);

app.use(function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) {
    return next(err);
  }
  console.error("[ErrorHandler]", err);
  res.status(500).json({ status: "error", error: true, errorMsg: err.message });
});

export default app;
