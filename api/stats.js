// /api/stats — aggregated, dashboard-friendly analytics for the Raspberry Pi to poll.
//
// Returns 7-day and 30-day rollups plus a 30-day daily series for:
//   pageviews, unique visitors, CTA clicks (total + per location),
//   sessions, engaged sessions, bounce rate, CTR, conversion.
//
// Protected by ?token=<STATS_TOKEN>. Zero dependencies (Upstash REST + fetch).

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const STATS_TOKEN = process.env.STATS_TOKEN;

function dateStr(d) { return d.toISOString().slice(0, 10); }
function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(dateStr(new Date(now - i * 86400000)));
  return out;
}
function hashToObj(arr) {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]) || 0;
  return o;
}
function ratio(num, den) { return den > 0 ? num / den : 0; }

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
  if (STATS_TOKEN && (req.query.token || "") !== STATS_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({ error: "kv_not_configured" });
    return;
  }

  try {
    const days = lastDays(30);
    const uvKeys = days.map((d) => `uv:${d}`);

    // One round-trip: every day's stats hash, every day's unique count, plus
    // window-merged unique counts (HyperLogLog dedupes across days).
    const cmds = [];
    for (const d of days) cmds.push(["HGETALL", `stats:${d}`]);
    for (const k of uvKeys) cmds.push(["PFCOUNT", k]);
    cmds.push(["PFCOUNT", ...uvKeys.slice(-7)]);  // unique visitors over 7d
    cmds.push(["PFCOUNT", ...uvKeys]);            // unique visitors over 30d
    const out = await pipeline(cmds);

    const N = days.length;
    const uv7 = Number(out[N * 2].result) || 0;
    const uv30 = Number(out[N * 2 + 1].result) || 0;

    const daily = days.map((d, i) => {
      const h = hashToObj(out[i].result);
      const visitors = Number(out[N + i].result) || 0;
      const ses = h.ses || 0;
      const eng = h.eng || 0;
      const byLoc = {};
      for (const k in h) if (k.indexOf("clk:") === 0) byLoc[k.slice(4)] = h[k];
      return {
        date: d,
        pageviews: h.pv || 0,
        visitors,
        clicks: h.clk || 0,
        clicks_by_location: byLoc,
        sessions: ses,
        engaged: eng,
        bounce_rate: ratio(ses - eng, ses),
      };
    });

    function windowAgg(n, uniqueVisitors) {
      const slice = daily.slice(-n);
      let pv = 0, clk = 0, ses = 0, eng = 0;
      const byLoc = {};
      for (const day of slice) {
        pv += day.pageviews; clk += day.clicks; ses += day.sessions; eng += day.engaged;
        for (const k in day.clicks_by_location) byLoc[k] = (byLoc[k] || 0) + day.clicks_by_location[k];
      }
      return {
        pageviews: pv,
        visitors: uniqueVisitors,
        clicks_total: clk,
        clicks_by_location: byLoc,
        sessions: ses,
        engaged: eng,
        bounce_rate: ratio(ses - eng, ses),
        ctr: ratio(clk, pv),                 // clicks ÷ pageviews
        conversion: ratio(clk, uniqueVisitors), // clicks ÷ unique visitors
      };
    }

    res.status(200).json({
      updatedAt: new Date().toISOString(),
      windows: { "7d": windowAgg(7, uv7), "30d": windowAgg(30, uv30) },
      daily,
    });
  } catch (e) {
    res.status(502).json({ error: "kv_error", message: String(e && e.message || e) });
  }
};
