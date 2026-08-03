// Minimal self-hosted sync server for the calendar PWA.
// - No database server required: events are persisted to a single JSON file.
// - Single shared-secret auth (SYNC_TOKEN): this is a personal, two-device
//   sync endpoint, not a multi-user service.
// - Sync model: last-write-wins per event, keyed by event id, using an
//   `updatedAt` (ms epoch) timestamp. Deletes are soft (tombstones) so they
//   propagate to the other device instead of "reappearing".

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const SYNC_TOKEN = process.env.SYNC_TOKEN;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "events.json");
const TOMBSTONE_RETENTION_DAYS = 180;

if (!SYNC_TOKEN) {
  console.error("ERROR: SYNC_TOKEN is not set. Copy .env.example to .env and set a secret token.");
  process.exit(1);
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ events: {} }, null, 2));

// ---- tiny async write queue so concurrent requests can't corrupt the file ----
let writeChain = Promise.resolve();
function readStore() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { events: {} };
  }
}
function writeStore(store) {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        const tmp = DATA_FILE + ".tmp";
        fs.writeFile(tmp, JSON.stringify(store, null, 2), (err) => {
          if (err) return reject(err);
          fs.rename(tmp, DATA_FILE, (err2) => (err2 ? reject(err2) : resolve()));
        });
      })
  );
  return writeChain;
}

function pruneOldTombstones(store) {
  const cutoff = Date.now() - TOMBSTONE_RETENTION_DAYS * 86400000;
  for (const id of Object.keys(store.events)) {
    const ev = store.events[id];
    if (ev.deleted && ev.updatedAt < cutoff) delete store.events[id];
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || token !== SYNC_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// GET /api/events?since=0  -> full/partial dump, no writes. Handy for debugging
// or a first pull without pushing local changes.
app.get("/api/events", requireAuth, (req, res) => {
  const since = Number(req.query.since || 0);
  const store = readStore();
  const events = Object.values(store.events).filter((e) => e.updatedAt > since);
  res.json({ serverTime: Date.now(), events });
});

// POST /api/sync  { since, changes: [event, ...] }
// Applies incoming changes (last-write-wins by updatedAt), then returns
// everything that changed since `since` — including the client's own
// changes (confirmed) and anything newer from another device.
app.post("/api/sync", requireAuth, async (req, res) => {
  const since = Number(req.body.since || 0);
  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];

  const store = readStore();

  for (const incoming of changes) {
    if (!incoming || typeof incoming.id !== "string") continue;
    if (typeof incoming.updatedAt !== "number") continue;
    const existing = store.events[incoming.id];
    if (!existing || incoming.updatedAt >= existing.updatedAt) {
      store.events[incoming.id] = incoming;
    }
  }

  pruneOldTombstones(store);
  await writeStore(store);

  const events = Object.values(store.events).filter((e) => e.updatedAt > since);
  res.json({ serverTime: Date.now(), events });
});

app.listen(PORT, () => {
  console.log(`Calendar sync server listening on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
