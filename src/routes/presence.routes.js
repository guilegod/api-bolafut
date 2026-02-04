import express from "express";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middlewares/auth.js";

const router = express.Router();

// MVP in-memory presence
const lastSeen = new Map(); // userId -> timestamp(ms)
const ONLINE_WINDOW_MS = 90 * 1000;

function isOnline(ts) {
  return typeof ts === "number" && Date.now() - ts <= ONLINE_WINDOW_MS;
}

/**
 * POST /presence/heartbeat
 */
router.post("/heartbeat", authRequired, (req, res) => {
  const meId = req.user.id;
  lastSeen.set(meId, Date.now());
  res.json({ ok: true });
});

/**
 * GET /presence/friends
 */
router.get("/friends", authRequired, async (req, res, next) => {
  try {
    const meId = req.user.id;

    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ userAId: meId }, { userBId: meId }],
      },
      select: { userAId: true, userBId: true },
    });

    const friendIds = friendships.map((f) =>
      f.userAId === meId ? f.userBId : f.userAId
    );

    const online = friendIds
      .map((id) => ({ userId: id, ts: lastSeen.get(id) }))
      .filter((x) => isOnline(x.ts))
      .map((x) => ({
        userId: x.userId,
        lastSeenAt: new Date(x.ts).toISOString(),
      }));

    res.json({
      online,
      onlineCount: online.length,
      windowMs: ONLINE_WINDOW_MS,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
