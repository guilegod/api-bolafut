import { Router } from "express";
import {
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
} from "../controllers/friends.controller.js";

import { authRequired } from "../middleware/auth.js";

const router = Router();

router.use(authRequired);

router.get("/", listFriends);

router.get("/incoming", listIncomingRequests);
router.get("/outgoing", listOutgoingRequests);

router.post("/request/:toUserId", sendFriendRequest);
router.post("/accept/:fromUserId", acceptFriendRequest);
router.post("/decline/:fromUserId", declineFriendRequest);

router.delete("/:userId", removeFriend);

export default router;