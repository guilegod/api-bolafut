import { verifyToken } from "../utils/jwt.js";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Token ausente" });

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { id, role, email }
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }
}
