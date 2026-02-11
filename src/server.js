// server.js (ou index.js) — entry do Render
import { app } from "./app.js";

const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

// ✅ healthcheck (Render usa isso implicitamente em alguns checks)
app.get("/", (req, res) => {
  res.status(200).send("ok");
});

app.listen(PORT, HOST, () => {
  console.log(`✅ API BoraPô rodando em http://${HOST}:${PORT}`);
});
