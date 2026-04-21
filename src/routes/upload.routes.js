import express from "express";
import multer from "multer";
import { supabase } from "../lib/supabase.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

// memória (não salva no disco)
const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/avatar",
  authRequired,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;

      if (!file) {
        return res.status(400).json({ message: "Arquivo não enviado" });
      }

      const fileName = `${req.user.id}-${Date.now()}`;

      const { error } = await supabase.storage
        .from("avatars")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
        });

      if (error) throw error;

      const { data } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      return res.json({
        url: data.publicUrl,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Erro no upload" });
    }
  }
);

export default router;