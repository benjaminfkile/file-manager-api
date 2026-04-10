import { Request, Response, NextFunction } from "express";
import { verifyCognitoToken } from "../aws/cognitoAuth";

declare global {
  namespace Express {
    interface Request {
      cognitoSub?: string;
    }
  }
}

const verifyToken = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7);
    try {
      const { sub } = await verifyCognitoToken(token);
      req.cognitoSub = sub;
      next();
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }
  };
};

export default verifyToken;
