import { app } from "./app.js";

const PORT = Number(process.env.PORT || 10000);

app.listen(PORT, () => {
  console.log(`✅ API BoraPô rodando na porta ${PORT}`);
});
