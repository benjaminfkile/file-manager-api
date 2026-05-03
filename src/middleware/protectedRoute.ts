import { Request, Response, NextFunction } from "express";
import { verifyCognitoToken } from "../aws/cognitoAuth";
import { getUserByCognitoSub } from "../services/userService";

const protectedRoute = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7);
    try {
      const { sub } = await verifyCognitoToken(token);
      const user = await getUserByCognitoSub(sub);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (user.expires_at && new Date(user.expires_at).getTime() <= Date.now()) {
        // Demo session is up — distinct error so the FE shows "session expired"
        // instead of the generic logout flow.
        return res.status(401).json({ error: "Session expired" });
      }
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }
  };
};

export default protectedRoute;
