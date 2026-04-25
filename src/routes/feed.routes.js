import { Router } from "express";
import {
  createUserPost,
  getHomeFeed,
  getUserFeedPosts,
  toggleFeedLike,
  createFeedComment,
  deleteFeedPost,
} from "../services/profile/feedService.js";

// 🔥 CORRETO AQUI
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;

    const posts = await getHomeFeed({ userId });

    return res.json(posts);
  } catch (error) {
    console.error("Erro ao buscar feed:", error);
    return res.status(500).json({
      message: "Erro ao buscar feed.",
    });
  }
});

router.get("/user/:userId", async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const profileUserId = req.params.userId;

    const posts = await getUserFeedPosts({
      profileUserId,
      currentUserId,
    });

    return res.json(posts);
  } catch (error) {
    console.error("Erro ao buscar feed do usuário:", error);
    return res.status(500).json({
      message: "Erro ao buscar feed do usuário.",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { text, imageUrl } = req.body;

    const post = await createUserPost({
      userId,
      text,
      imageUrl,
    });

    if (!post) {
      return res.status(400).json({
        message: "Texto do post é obrigatório.",
      });
    }

    return res.status(201).json(post);
  } catch (error) {
    console.error("Erro ao criar post:", error);
    return res.status(500).json({
      message: "Erro ao criar post.",
    });
  }
});

router.post("/:postId/like", async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId } = req.params;

    const post = await toggleFeedLike({
      postId,
      userId,
    });

    return res.json(post);
  } catch (error) {
    console.error("Erro ao curtir post:", error);
    return res.status(500).json({
      message: "Erro ao curtir post.",
    });
  }
});

router.post("/:postId/comments", async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId } = req.params;
    const { text } = req.body;

    const post = await createFeedComment({
      postId,
      userId,
      text,
    });

    if (!post) {
      return res.status(400).json({
        message: "Comentário é obrigatório.",
      });
    }

    return res.status(201).json(post);
  } catch (error) {
    console.error("Erro ao comentar post:", error);
    return res.status(500).json({
      message: "Erro ao comentar post.",
    });
  }
});

router.delete("/:postId", async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId } = req.params;

    const result = await deleteFeedPost({
      postId,
      userId,
    });

    if (!result.ok) {
      return res.status(result.status).json({
        message: result.message,
      });
    }

    return res.json({
      ok: true,
    });
  } catch (error) {
    console.error("Erro ao excluir post:", error);
    return res.status(500).json({
      message: "Erro ao excluir post.",
    });
  }
});

export default router;