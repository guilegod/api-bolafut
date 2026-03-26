import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import {
  ensurePlayerRank,
  buildRankSummary,
  getGlobalRanking,
} from "../services/rankService.js";

const router = Router();

router.get("/me/rank", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    const rank = await ensurePlayerRank(userId);

    return res.json(buildRankSummary(rank));
  } catch (error) {
    console.error("GET /me/rank error:", error);
    return res.status(500).json({
      error: "Erro ao buscar rank do jogador.",
    });
  }
});

router.get("/ranking/global", async (_req, res) => {
  try {
    const ranking = await getGlobalRanking({ take: 100 });
    return res.json(ranking);
  } catch (error) {
    console.error("GET /ranking/global error:", error);
    return res.status(500).json({
      error: "Erro ao buscar ranking global.",
    });
  }
});

export default router;