import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import courtsRoutes from "./routes/courts.routes.js";
import matchesRoutes from "./routes/matches.routes.js";
import partnerArenasRoutes from "./routes/partnerArenas.js";
import arenasRoutes from "./routes/arenas.routes.js";
import reservationsRoutes from "./routes/reservations.routes.js";
import friendsRoutes from "./routes/friends.routes.js";

export const app = express();

// ✅ behind proxy (Render / Nginx / etc.)
app.set("trust proxy", 1);

// ✅ JSON body
app.use(express.json({ limit: "1mb" }));

// ✅ CORS (flexível pra dev + deploy)
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// ✅ Preflight (evita erro em POST/PUT/DELETE com headers)
app.options("*", cors({ origin: true, credentials: true }));

// ✅ rotas
app.use(healthRoutes);
app.use("/auth", authRoutes);
app.use("/arenas", arenasRoutes);
app.use("/courts", courtsRoutes);
app.use("/matches", matchesRoutes);
app.use("/partner-arenas", partnerArenasRoutes);
app.use("/reservations", reservationsRoutes);
app.use("/friends", friendsRoutes);

// ✅ 404 sempre por último
app.use((req, res) => {
  res.status(404).json({ message: "Rota não encontrada", path: req.originalUrl });
});

// ✅ handler global de erro
app.use((err, req, res, next) => {
  console.error("❌ ERRO:", err);
  const status = err.statusCode || err.status || 500;

  res.status(status).json({
    message: err.message || "Erro interno do servidor",
  });
});

// ✅ start server (se este arquivo for o entrypoint)
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`✅ API BoraPô rodando na porta ${PORT}`);
  });
}
