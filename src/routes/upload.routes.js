import express from "express";
import multer from "multer";
import { supabase } from "../lib/supabase.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024,
  },
});

router.post("/avatar", authRequired, upload.single("file"), async (req, res) => {
  try {
    console.log("=== UPLOAD AVATAR START ===");
    console.log("user:", req.user);
    console.log("file exists:", Boolean(req.file));

    if (!req.user?.id) {
      return res.status(401).json({ message: "Usuário não autenticado no upload" });
    }

    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "Arquivo não enviado" });
    }

    console.log("file info:", {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    const ext =
      file.originalname?.split(".").pop()?.toLowerCase() ||
      file.mimetype?.split("/").pop() ||
      "bin";

    const fileName = `avatars/${req.user.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error("SUPABASE UPLOAD ERROR:", uploadError);
      return res.status(500).json({
        message: "Erro ao enviar arquivo para o storage",
        details: uploadError.message,
      });
    }

    const { data: publicUrlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(fileName);

    console.log("public url:", publicUrlData?.publicUrl);
    console.log("=== UPLOAD AVATAR END ===");

    return res.json({
      url: publicUrlData?.publicUrl || "",
    });
  } catch (err) {
    console.error("UPLOAD AVATAR FATAL ERROR:", err);
    return res.status(500).json({
      message: "Erro no upload",
      details: err?.message || "Erro interno",
    });
  }
});

export default router;