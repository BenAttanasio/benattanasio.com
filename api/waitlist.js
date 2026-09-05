// /api/waitlist — the cohort waitlist.
//
//   GET    → { count, goal }          public counter, always a true number
//   POST   → { ok, count, goal }      body: { email, website }  (website = honeypot)
//   DELETE → { ok, count, goal }      ?token=WAITLIST_ADMIN_TOKEN&email=...  removes one entry
//   GET    ?token=WAITLIST_ADMIN_TOKEN&list=1 → { count, goal, joined: { email: iso } }
//
// Zero dependencies, same Upstash REST pattern as track.js. Emails go into a Redis
// set (dedupes on its own) plus a hash of email → ISO timestamp so the order and
// the date are kept. Read them back with:  SMEMBERS waitlist:emails  /  HGETALL waitlist:joined

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_TOKEN = process.env.WAITLIST_ADMIN_TOKEN;

const GOAL = 10;                     // cart opens at this many names
const SET_KEY = "waitlist:emails";
const HASH_KEY = "waitlist:joined";
const MAX_PER_IP_PER_DAY = 5;

async function pipeline(commands) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error("kv pipeline " + res.status);
  return res.json();
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 4096) raw = raw.slice(0, 4096); });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch (e) { resolve({}); }
    });
  });
}

function cleanEmail(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  if (s.length < 6 || s.length > 254) return "";
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return "";
  return s;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"] || "";
  return String(fwd).split(",")[0].trim().replace(/[^0-9a-f.:]/gi, "").slice(0, 45) || "na";
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  if (!KV_URL || !KV_TOKEN) {
    res.status(503).json({ error: "waitlist_unavailable" });
    return;
  }

  try {
    const q = req.query || {};
    const isAdmin = ADMIN_TOKEN && q.token === ADMIN_TOKEN;

    if (req.method === "GET") {
      if (isAdmin && q.list) {
        const out = await pipeline([["SCARD", SET_KEY], ["HGETALL", HASH_KEY]]);
        const arr = (out[1] && out[1].result) || [];
        const joined = {};
        for (let i = 0; i < arr.length; i += 2) joined[arr[i]] = arr[i + 1];
        res.status(200).json({ count: Number(out[0] && out[0].result) || 0, goal: GOAL, joined });
        return;
      }
      const out = await pipeline([["SCARD", SET_KEY]]);
      const count = Number(out[0] && out[0].result) || 0;
      res.status(200).json({ count, goal: GOAL });
      return;
    }

    if (req.method === "DELETE") {
      if (!isAdmin) { res.status(401).json({ error: "unauthorized" }); return; }
      const email = cleanEmail(q.email);
      if (!email) { res.status(400).json({ error: "invalid_email" }); return; }
      const out = await pipeline([["SREM", SET_KEY, email], ["HDEL", HASH_KEY, email], ["SCARD", SET_KEY]]);
      res.status(200).json({ ok: true, count: Number(out[2] && out[2].result) || 0, goal: GOAL });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    const body = await readBody(req);

    // Honeypot: real people never see this field, so anything in it is a bot.
    if (body.website) {
      const out = await pipeline([["SCARD", SET_KEY]]);
      res.status(200).json({ ok: true, count: Number(out[0] && out[0].result) || 0, goal: GOAL });
      return;
    }

    const email = cleanEmail(body.email);
    if (!email) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }

    // Light rate limit per IP per day.
    const day = new Date().toISOString().slice(0, 10);
    const rlKey = `waitlist:rl:${day}:${clientIp(req)}`;
    const rl = await pipeline([["INCR", rlKey], ["EXPIRE", rlKey, 86400]]);
    if ((Number(rl[0] && rl[0].result) || 0) > MAX_PER_IP_PER_DAY) {
      res.status(429).json({ error: "too_many" });
      return;
    }

    const out = await pipeline([
      ["SADD", SET_KEY, email],
      ["HSETNX", HASH_KEY, email, new Date().toISOString()],
      ["SCARD", SET_KEY],
    ]);
    const count = Number(out[2] && out[2].result) || 0;
    res.status(200).json({ ok: true, count, goal: GOAL });
  } catch (e) {
    res.status(500).json({ error: "waitlist_error" });
  }
};
