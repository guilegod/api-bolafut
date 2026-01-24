import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import courtsRoutes from "./routes/courts.routes.js";
import matchesRoutes from "./routes/matches.routes.js";
import partnerArenasRoutes from "./routes/partnerArenas.js";
import arenasRoutes from "./routes/arenas.routes.js"; // ✅ NOVO

export const app = express();

// ✅ CORS (mais seguro e evita dor de cabeça no deploy)
app.use(
  cors({
    origin: true, // permite qualquer origin (bom pra Vercel/Render). Se quiser travar depois, eu ajusto.
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// ✅ rotas
app.use(healthRoutes);
app.use("/auth", authRoutes);
app.use("/arenas", arenasRoutes); // ✅ NOVO
app.use("/courts", courtsRoutes);
app.use("/matches", matchesRoutes);
app.use("/partner-arenas", partnerArenasRoutes);

// ✅ 404 sempre por último
app.use((req, res) => res.status(404).json({ message: "Rota não encontrada" }));
