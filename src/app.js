import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";

dotenv.config();

import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import courtsRoutes from "./routes/courts.routes.js";
import matchesRoutes from "./routes/matches.routes.js";
import partnerArenasRoutes from "./routes/partnerArenas.js";
import arenasRoutes from "./routes/arenas.routes.js";
import reservationsRoutes from "./routes/reservations.routes.js";
import friendsRoutes from "./routes/friends.routes.js";
import rankRoutes from "./routes/rank.routes.js";
import peladaLocationRoutes from "./routes/peladaLocation.routes.js";
import usersRoutes from "./routes/users.routes.js";
import presenceRoutes from "./routes/presence.routes.js";

export const app = express();

/* --------------------------------------------------
   TRUST PROXY
-------------------------------------------------- */
app.set("trust proxy", 1);

/* --------------------------------------------------
   CONFIG
-------------------------------------------------- */
const isProduction = process.env.NODE_ENV === "production";

const envOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const fallbackOrigins = [
  "https://borapo.com",
  "https://www.borapo.com",
  "https://borapo.online",
  "https://www.borapo.online",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.18.3:5173",
];

const allowedOrigins = [...new Set([...(envOrigins.length ? envOrigins : []), ...fallbackOrigins])];

if (!isProduction) {
  console.log("🌐 CORS allowed origins:", allowedOrigins);
}

/* --------------------------------------------------
   SEGURANÇA BÁSICA
-------------------------------------------------- */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

/* --------------------------------------------------
   CORS
-------------------------------------------------- */
const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS bloqueado para origem: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-match-password",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* --------------------------------------------------
   RATE LIMIT
-------------------------------------------------- */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 300 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Muitas requisições. Tente novamente em alguns minutos.",
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Muitas tentativas de autenticação. Aguarde alguns minutos.",
  },
});

app.use(globalLimiter);

/* --------------------------------------------------
   BODY PARSER
-------------------------------------------------- */
app.use(express.json({ limit: "1mb" }));

/* --------------------------------------------------
   HEALTH
-------------------------------------------------- */
app.get("/", (req, res) => {
  res.status(200).send("ok");
});

/* --------------------------------------------------
   ROTAS
-------------------------------------------------- */
app.use(healthRoutes);

app.use("/auth", authLimiter, authRoutes);

app.use("/users", usersRoutes);
app.use("/presence", presenceRoutes);

app.use("/arenas", arenasRoutes);
app.use("/courts", courtsRoutes);
app.use("/matches", matchesRoutes);
app.use("/partner-arenas", partnerArenasRoutes);
app.use("/reservations", reservationsRoutes);
app.use("/friends", friendsRoutes);
app.use("/rank", rankRoutes);
app.use("/pelada-locations", peladaLocationRoutes);

/* --------------------------------------------------
   404
-------------------------------------------------- */
app.use((req, res) => {
  res.status(404).json({
    message: "Rota não encontrada",
    path: req.originalUrl,
  });
});

/* --------------------------------------------------
   ERROR HANDLER
-------------------------------------------------- */
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;

  if (!isProduction) {
    console.error("❌ ERRO:", err);
  }

  if (err.message?.startsWith("CORS bloqueado")) {
    return res.status(403).json({
      message: "Origem não permitida por CORS",
      origin: req.headers.origin || null,
    });
  }

  return res.status(statusCode).json({
    message:
      statusCode === 500 && isProduction
        ? "Erro interno do servidor"
        : err.message || "Erro interno do servidor",
  });
});