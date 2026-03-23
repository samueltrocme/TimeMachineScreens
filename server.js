const path = require("path");
const express = require("express");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

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
const serialConfig = {
  enabled: process.env.SERIAL_ENABLED !== "false",
  baudRate: Number.parseInt(process.env.SERIAL_BAUD_RATE || "115200", 10) || 115200,
  path: process.env.SERIAL_PORT_PATH || "",
  reconnectMs: Number.parseInt(process.env.SERIAL_RECONNECT_MS || "3000", 10) || 3000,
  historyLimit: Number.parseInt(process.env.SERIAL_HISTORY_LIMIT || "100", 10) || 100,
};
let serialPort = null;
let serialReconnectTimer = null;
const serialStatus = {
  enabled: serialConfig.enabled,
  connected: false,
  desiredPath: serialConfig.path || null,
  activePath: null,
  baudRate: serialConfig.baudRate,
  reconnectMs: serialConfig.reconnectMs,
  lastMessageAt: null,
  lastError: null,
  counters: {
    received: 0,
    accepted: 0,
    rejected: 0,
  },
};
const serialHistory = [];

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

function applyStatePatch(patch) {
  Object.assign(state, patch);
  broadcastState();
}

function pushSerialHistory(entry) {
  serialHistory.push(entry);
  while (serialHistory.length > serialConfig.historyLimit) {
    serialHistory.shift();
  }
}

function toIsoFromMsOrNow(updatedAtMs) {
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) {
    return new Date(updatedAtMs).toISOString();
  }
  return new Date().toISOString();
}

function safeSource(source, fallback) {
  if (typeof source === "string" && source.trim()) {
    return source.trim().slice(0, 64);
  }
  return fallback;
}

function normalizeSerialMessage(value) {
  if (!value || typeof value !== "object") {
    return { error: "JSON serie invalide." };
  }

  if (value.type === "energy") {
    const energyPercent = value.energyPercent;
    if (!Number.isInteger(energyPercent) || energyPercent < 0 || energyPercent > 100) {
      return { error: "Message energy invalide." };
    }
    return {
      value: {
        energyPercent,
        source: safeSource(value.source, "arduino-serial"),
        updatedAt: toIsoFromMsOrNow(value.updatedAtMs),
      },
    };
  }

  if (value.type === "sequence") {
    const sequenceStep = value.sequenceStep;
    if (!Number.isInteger(sequenceStep) || sequenceStep < 0 || sequenceStep > 6) {
      return { error: "Message sequence invalide." };
    }
    return {
      value: {
        sequenceStep,
        source: safeSource(value.source, "arduino-serial"),
        updatedAt: toIsoFromMsOrNow(value.updatedAtMs),
      },
    };
  }

  return { error: "Type serie non supporte." };
}

async function resolveSerialPath() {
  if (serialConfig.path) {
    return serialConfig.path;
  }

  const ports = await SerialPort.list();
  const preferred = ports.find((port) => {
    const candidate = (port.path || "").toLowerCase();
    return candidate.includes("ttyacm") ||
      candidate.includes("ttyusb") ||
      candidate.includes("usbmodem") ||
      candidate.includes("cu.usb");
  });

  return preferred?.path || "";
}

function scheduleSerialReconnect() {
  if (serialReconnectTimer || !serialConfig.enabled) {
    return;
  }
  serialReconnectTimer = setTimeout(() => {
    serialReconnectTimer = null;
    startSerialListener();
  }, serialConfig.reconnectMs);
}

function bindSerialEvents(portInstance) {
  const parser = portInstance.pipe(new ReadlineParser({ delimiter: "\n" }));

  parser.on("data", (line) => {
    const raw = String(line || "").trim();
    if (!raw) {
      return;
    }
    serialStatus.counters.received += 1;

    try {
      const json = JSON.parse(raw);
      const normalized = normalizeSerialMessage(json);
      if (normalized.error) {
        serialStatus.counters.rejected += 1;
        serialStatus.lastError = normalized.error;
        pushSerialHistory({
          receivedAt: new Date().toISOString(),
          accepted: false,
          reason: normalized.error,
          raw,
        });
        console.warn(`[serial] ignored line: ${normalized.error}`);
        return;
      }

      serialStatus.counters.accepted += 1;
      serialStatus.lastMessageAt = new Date().toISOString();
      serialStatus.lastError = null;
      pushSerialHistory({
        receivedAt: serialStatus.lastMessageAt,
        accepted: true,
        type: json.type,
        payload: normalized.value,
        raw,
      });
      applyStatePatch(normalized.value);
    } catch (_err) {
      serialStatus.counters.rejected += 1;
      serialStatus.lastError = "Ligne non JSON";
      pushSerialHistory({
        receivedAt: new Date().toISOString(),
        accepted: false,
        reason: "Ligne non JSON",
        raw,
      });
      console.warn("[serial] ignored non-JSON line");
    }
  });

  portInstance.on("open", () => {
    serialStatus.connected = true;
    serialStatus.activePath = portInstance.path || null;
    serialStatus.lastError = null;
    console.log(`[serial] listening on ${portInstance.path} @ ${serialConfig.baudRate}`);
  });

  portInstance.on("error", (error) => {
    serialStatus.lastError = error.message;
    pushSerialHistory({
      receivedAt: new Date().toISOString(),
      accepted: false,
      reason: `Port error: ${error.message}`,
      raw: null,
    });
    console.error(`[serial] error: ${error.message}`);
  });

  portInstance.on("close", () => {
    console.warn("[serial] port closed, scheduling reconnect");
    serialPort = null;
    serialStatus.connected = false;
    serialStatus.activePath = null;
    scheduleSerialReconnect();
  });
}

async function startSerialListener() {
  if (!serialConfig.enabled || serialPort) {
    return;
  }

  try {
    const resolvedPath = await resolveSerialPath();
    if (!resolvedPath) {
      serialStatus.lastError = "Aucun port serie detecte";
      console.warn("[serial] no serial port found, retry scheduled");
      scheduleSerialReconnect();
      return;
    }

    serialPort = new SerialPort({
      path: resolvedPath,
      baudRate: serialConfig.baudRate,
      autoOpen: true,
    });

    bindSerialEvents(serialPort);
  } catch (error) {
    console.error(`[serial] startup failed: ${error.message}`);
    serialPort = null;
    scheduleSerialReconnect();
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
  <a href="/api/serial-status">Diagnostic serial JSON</a>
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

app.get("/api/serial-status", (_req, res) => {
  res.json({
    ...serialStatus,
    historyLimit: serialConfig.historyLimit,
    reconnectScheduled: Boolean(serialReconnectTimer),
    history: serialHistory,
  });
});

app.post("/api/update", (req, res) => {
  const normalized = normalizeUpdate(req.body);
  if (normalized.error) {
    return res.status(400).json({ ok: false, error: normalized.error });
  }

  applyStatePatch(normalized.value);

  return res.json({ ok: true, state });
});

app.post("/api/reset", (req, res) => {
  const safeSource = typeof req.body?.source === "string" && req.body.source.trim()
    ? req.body.source.trim().slice(0, 64)
    : "system";

  applyStatePatch({
    energyPercent: 0,
    sequenceStep: 0,
    source: safeSource,
    updatedAt: new Date().toISOString(),
  });

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

startSerialListener();
