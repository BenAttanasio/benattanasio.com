/* First-party analytics for benattanasio.com.
 *
 * Why this exists: Vercel Web Analytics has no API to read data back out, so we
 * can't feed CTR/visitors to the Raspberry Pi dashboard from it. Instead we count
 * pageviews, unique visitors, sessions (for bounce rate), and "Join AI Builder
 * Society" CTA clicks ourselves via /api/track (Upstash KV), and expose them at
 * /api/stats for the dashboard to poll. We ALSO fire Vercel custom events so the
 * nice Events tab in the Vercel dashboard keeps working.
 *
 * No build step: plain ES5-ish script, loaded with <script defer src="/assets/track.js">.
 */
(function () {
  "use strict";

  // Vercel custom-events queue stub (so va('event', ...) works even before the
  // insights script finishes loading).
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

  var ENDPOINT = "/api/track";

  function beacon(params) {
    try {
      var qs = [];
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k)) {
          qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
        }
      }
      var url = ENDPOINT + "?" + qs.join("&");
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else { var img = new Image(); img.src = url; } // fallback for old browsers
    } catch (e) { /* analytics must never break the page */ }
  }

  function rid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Stable per-browser id → unique visitors (persists across sessions).
  var vid = "na";
  try {
    vid = localStorage.getItem("_vid");
    if (!vid) { vid = rid(); localStorage.setItem("_vid", vid); }
  } catch (e) {}

  // Per-tab session id → bounce rate (sessionStorage resets per tab/visit).
  var sid = "na", newSession = "0";
  try {
    sid = sessionStorage.getItem("_sid");
    if (!sid) { sid = rid(); sessionStorage.setItem("_sid", sid); newSession = "1"; }
  } catch (e) {}

  function isEngaged() {
    try { return sessionStorage.getItem("_eng") === "1"; } catch (e) { return false; }
  }
  // An "engaged" (non-bounce) session = viewed >1 page OR clicked a CTA.
  function markEngaged() {
    try {
      if (sessionStorage.getItem("_eng") === "1") return;
      sessionStorage.setItem("_eng", "1");
    } catch (e) {}
    beacon({ e: "eng", sid: sid });
  }

  // Pageview.
  beacon({ e: "pv", vid: vid, sid: sid, ns: newSession, page: location.pathname });
  // A 2nd+ pageview in this session means it didn't bounce.
  if (newSession === "0" && !isEngaged()) markEngaged();

  // Figure out which CTA placement a link belongs to, from its DOM context.
  // Explicit data-cta="..." on the link always wins.
  function ctaLocation(a) {
    if (a.getAttribute("data-cta")) return a.getAttribute("data-cta");
    if (a.closest(".topbar")) return "topbar";
    if (a.closest("footer")) return "footer";
    if (a.closest(".article-cta")) return "article-cta";
    if (a.closest(".cta-block")) return "blog-cta";
    if (a.closest(".hero")) return "hero";
    if (a.closest("#inside")) return "whats-inside";
    if (a.classList && a.classList.contains("textlink")) return "inline-text";
    return "other";
  }

  // Track clicks on any link to AI Builder Society.
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest ? ev.target.closest("a") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!/aibuildersociety\.com/i.test(href)) return;

    var loc = ctaLocation(a);
    // Vercel custom event (one property → within Pro's 2-key limit).
    if (window.va) window.va("event", { name: "join_click", location: loc });
    // First-party beacon for the dashboard.
    beacon({ e: "click", loc: loc, vid: vid, sid: sid, page: location.pathname });
    // A CTA click is engagement → not a bounce.
    markEngaged();
  }, true);
})();
