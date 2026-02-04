import { Router } from "express";
import {
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
} from "../controllers/friends.controller.js";

// supondo que você já tem auth middleware
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

// amigos (lista final)
router.get("/", listFriends);

// pedidos
router.get("/incoming", listIncomingRequests);
router.get("/outgoing", listOutgoingRequests);

// ações
router.post("/request/:toUserId", sendFriendRequest);
router.post("/accept/:fromUserId", acceptFriendRequest);
router.post("/decline/:fromUserId", declineFriendRequest);

export default router;
