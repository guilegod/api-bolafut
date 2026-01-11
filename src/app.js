import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import courtsRoutes from "./routes/courts.routes.js";
import matchesRoutes from "./routes/matches.routes.js";
import partnerArenasRoutes from "./routes/partnerArenas.routes.js";
dotenv.config();

export const app = express();

app.use(cors());
app.use(express.json());

app.use(healthRoutes);
app.use("/auth", authRoutes);
app.use("/courts", courtsRoutes);
app.use("/matches", matchesRoutes);
app.use("/partner-arenas", partnerArenasRoutes);
app.use((req, res) => res.status(404).json({ message: "Rota não encontrada" }));
