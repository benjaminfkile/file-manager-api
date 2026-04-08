import { IUser } from "./interfaces";

export type TNodeEnvironment = "local" | "development" | "production";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}
