import express from "express";

export function startHealth(port = 3000) {
  const app = express();
  app.get("/", (_req, res) => res.send("OK"));
  app.listen(port, () => console.log(`Health server on :${port}`));
}
