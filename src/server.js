import dotenv from "dotenv";
dotenv.config();

import { app } from "./app.js";

const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`✅ API BoraPô rodando em http://${HOST}:${PORT}`);
  }
});