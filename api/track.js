// /api/track — first-party analytics beacon. Counts pageviews, unique visitors,
// sessions + engagement (for bounce rate), and CTA clicks into Upstash Redis.
//
// Zero dependencies: talks to Upstash over its REST API with global fetch, so the
// site stays a plain static deploy (no package.json / build step). Reads whichever
// env-var pair the Vercel Upstash/KV integration injected.
//
// Beacons arrive as POST (navigator.sendBeacon) with the data in the query string.

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL_SECONDS = 60 * 60 * 24 * 120; // keep ~120 days of daily buckets

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function clean(value, max) {
  return String(value == null ? "" : value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, max || 32);
}

async function pipeline(commands) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error("kv pipeline " + res.status);
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // If KV isn't wired up yet, accept silently so the site never breaks.
  if (!KV_URL || !KV_TOKEN) { res.status(204).end(); return; }

  try {
    const q = req.query || {};
    const event = clean(q.e, 16);
    const day = today();
    const statsKey = `stats:${day}`;
    const uvKey = `uv:${day}`;
    const cmds = [];

    if (event === "pv") {
      cmds.push(["HINCRBY", statsKey, "pv", 1]);
      if (q.ns === "1") cmds.push(["HINCRBY", statsKey, "ses", 1]); // new session
      const vid = clean(q.vid, 40);
      if (vid) cmds.push(["PFADD", uvKey, vid]); // HyperLogLog → unique visitors
    } else if (event === "eng") {
      cmds.push(["HINCRBY", statsKey, "eng", 1]); // engaged (non-bounce) session
    } else if (event === "click") {
      const loc = clean(q.loc, 24) || "other";
      cmds.push(["HINCRBY", statsKey, "clk", 1]);
      cmds.push(["HINCRBY", statsKey, `clk:${loc}`, 1]);
    } else {
      res.status(204).end();
      return;
    }

    cmds.push(["EXPIRE", statsKey, TTL_SECONDS]);
    cmds.push(["EXPIRE", uvKey, TTL_SECONDS]);
    await pipeline(cmds);
  } catch (e) {
    // Swallow — tracking failures must never surface to visitors.
  }
  res.status(204).end();
};
