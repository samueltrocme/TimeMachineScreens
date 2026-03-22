const path = require("path");
const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "64kb" }));

const state = {
  energyPercent: 0,
  sequenceStep: 0,
  source: "system",
  updatedAt: new Date().toISOString(),
};

const sseClients = new Set();

function normalizeUpdate(body) {
  if (!body || typeof body !== "object") {
    return { error: "Payload JSON invalide." };
  }

  const { energyPercent, sequenceStep, source } = body;

  if (!Number.isInteger(energyPercent) || energyPercent < 0 || energyPercent > 100) {
    return { error: "energyPercent doit etre un entier entre 0 et 100." };
  }

  if (!Number.isInteger(sequenceStep) || sequenceStep < 0 || sequenceStep > 6) {
    return { error: "sequenceStep doit etre un entier entre 0 et 6." };
  }

  const safeSource = typeof source === "string" && source.trim() ? source.trim().slice(0, 64) : "arduino";

  return {
    value: {
      energyPercent,
      sequenceStep,
      source: safeSource,
      updatedAt: new Date().toISOString(),
    },
  };
}

function broadcastState() {
  const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/Liquide", express.static(path.join(__dirname, "Liquide")));
app.use("/Engrenage", express.static(path.join(__dirname, "Engrenage")));

app.get("/", (_req, res) => {
  res.type("html").send(`
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TimeMachine Screens</title>
  <style>
    body { font-family: sans-serif; background: #111; color: #eee; margin: 0; padding: 24px; }
    a { color: #78dce8; display: block; margin: 10px 0; font-size: 1.1rem; }
    code { background: #222; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>TimeMachine Screens</h1>
  <a href="/liquide">Ecran liquide</a>
  <a href="/engrenage">Ecran engrenage</a>
  <a href="/demo">Page demo / backup arduino</a>
  <a href="/api/state">Etat JSON</a>
  <p>Flux temps reel: <code>/events</code></p>
</body>
</html>
  `);
});

app.get("/liquide", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "liquide.html"));
});

app.get("/engrenage", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "engrenage.html"));
});

app.get("/demo", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "demo.html"));
});

app.get("/api/state", (_req, res) => {
  res.json(state);
});

app.post("/api/update", (req, res) => {
  const normalized = normalizeUpdate(req.body);
  if (normalized.error) {
    return res.status(400).json({ ok: false, error: normalized.error });
  }

  Object.assign(state, normalized.value);
  broadcastState();

  return res.json({ ok: true, state });
});

app.post("/api/reset", (req, res) => {
  const safeSource = typeof req.body?.source === "string" && req.body.source.trim()
    ? req.body.source.trim().slice(0, 64)
    : "system";

  Object.assign(state, {
    energyPercent: 0,
    sequenceStep: 0,
    source: safeSource,
    updatedAt: new Date().toISOString(),
  });
  broadcastState();

  res.json({ ok: true, state });
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.listen(port, () => {
  // Keep this startup log terse for container logs.
  console.log(`TimeMachine server listening on port ${port}`);
});
