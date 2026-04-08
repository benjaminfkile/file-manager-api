import express, { Request, Response } from "express";
import protectedRoute from "../middleware/protectedRoute";
import { getItemsSharedWithUser } from "../services/sharingService";
import { IUser } from "../interfaces";

const sharedRouter = express.Router();

/**
 * GET /api/shared
 * List all files and folders shared with the current user.
 * Behind protectedRoute.
 */
sharedRouter
  .route("/")
  .get(protectedRoute(), async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;
      const { files, folders } = await getItemsSharedWithUser(user.id);
      return res.status(200).json({ files, folders });
    } catch (err: any) {
      console.error("[GET /api/shared] Error:", err);
      return res
        .status(500)
        .json({ status: "error", error: true, errorMsg: err.message });
    }
  });

export default sharedRouter;
