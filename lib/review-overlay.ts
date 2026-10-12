// The review layer that runs inside proxied client pages, inlined into each
// page by the /proxy route (a separate <script src> request from the
// sandboxed page gets blocked by some browsers). Plain ES5 on purpose.
export const REVIEW_OVERLAY_JS = String.raw`/* MMG Pulse review layer. Runs inside the proxied client page (sandboxed,
   opaque origin) and talks to the review page via postMessage. It draws the
   comment pins, highlights elements in Comment mode, reports where a click
   landed (element selector + offset, so the pin survives layout changes),
   and keeps link clicks inside the review instead of leaving to the live site. */
(function () {
  var cfg = window.__MMG_REVIEW;
  if (!cfg || window.__MMG_REVIEW_LOADED) return;
  window.__MMG_REVIEW_LOADED = true;

  var mode = "browse";
  var pins = [];
  var draft = null;
  var layer, hoverBox, frameQueued = false;
  var BRAND = "#0CA4C3", NAVY = "#001A2E";

  function send(type, data) {
    var msg = { source: "mmg-review", type: type };
    for (var k in data || {}) msg[k] = data[k];
    parent.postMessage(msg, cfg.appOrigin);
  }

  // ── Element anchors ──────────────────────────────────────────────────────
  function uniqueId(el) {
    if (!el.id || /^\d|[:\s]/.test(el.id)) return null;
    try { return document.querySelectorAll("#" + CSS.escape(el.id)).length === 1 ? "#" + CSS.escape(el.id) : null; } catch (e) { return null; }
  }
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      var id = uniqueId(el);
      if (id) { parts.unshift(id); return parts.join(" > "); }
      var tag = el.tagName.toLowerCase();
      var parent = el.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
        if (same.length > 1) tag += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
      }
      parts.unshift(tag);
      el = parent;
    }
    return "body > " + parts.join(" > ");
  }
  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }
  function findAnchor(a) {
    var el = null;
    try { el = document.querySelector(a.selector); } catch (e) {}
    // The page changed: look for an element of the same kind with the same text.
    if ((!el || (a.text && textOf(el).slice(0, 40) !== a.text.slice(0, 40))) && a.text) {
      var tag = (a.selector.split(">").pop() || "").trim().split(/[:#.\[]/)[0] || "*";
      var candidates = document.querySelectorAll(tag);
      for (var i = 0; i < candidates.length; i++) {
        if (textOf(candidates[i]).slice(0, 40) === a.text.slice(0, 40)) { el = candidates[i]; break; }
      }
    }
    return el;
  }
  function pinPosition(a) {
    var el = findAnchor(a);
    if (el) {
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { x: r.left + window.scrollX + a.offsetX * r.width, y: r.top + window.scrollY + a.offsetY * r.height, found: true };
      }
    }
    return { x: a.docX, y: a.docY, found: false };
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  function ensureLayer() {
    if (layer && layer.isConnected) return;
    layer = document.createElement("div");
    layer.setAttribute("data-mmg-review", "");
    layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
    document.documentElement.appendChild(layer);
    hoverBox = document.createElement("div");
    hoverBox.setAttribute("data-mmg-review", "");
    hoverBox.style.cssText = "position:fixed;z-index:2147483645;pointer-events:none;border:2px solid " + BRAND + ";border-radius:6px;background:rgba(12,164,195,.08);display:none;transition:all .06s ease-out;";
    document.documentElement.appendChild(hoverBox);
  }
  function pinEl(label, opts) {
    var p = document.createElement("button");
    p.type = "button";
    p.setAttribute("data-mmg-review", "");
    p.textContent = label;
    var bg = opts.draft ? NAVY : opts.resolved ? "#94A3B8" : BRAND;
    p.style.cssText =
      "position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;min-width:30px;height:30px;padding:0 7px;" +
      "border-radius:15px 15px 15px 3px;border:2px solid #fff;background:" + bg + ";color:#fff;font:600 12px/26px Inter,system-ui,sans-serif;" +
      "box-shadow:0 4px 14px rgba(0,26,46,.28);" + (opts.active ? "outline:3px solid rgba(12,164,195,.35);" : "") + (opts.faded ? "opacity:.75;" : "");
    return p;
  }
  function render() {
    ensureLayer();
    layer.innerHTML = "";
    pins.forEach(function (p) {
      if (!p.anchor) return;
      var pos = pinPosition(p.anchor);
      var el = pinEl(String(p.number), { resolved: p.status === "resolved", active: p.active, faded: !pos.found });
      el.style.left = pos.x + "px";
      el.style.top = pos.y + "px";
      el.title = pos.found ? "" : "This part of the page has changed since the comment";
      el.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); send("pinClick", { id: p.id }); });
      el.setAttribute("data-pin", p.id);
      layer.appendChild(el);
    });
    if (draft) {
      var d = pinEl("+", { draft: true });
      d.style.left = draft.x + "px";
      d.style.top = draft.y + "px";
      d.setAttribute("data-pin", "draft");
      layer.appendChild(d);
    }
    reportRects();
  }
  function reportRects() {
    if (!layer) return;
    var rects = {};
    layer.querySelectorAll("[data-pin]").forEach(function (el) {
      var r = el.getBoundingClientRect();
      rects[el.getAttribute("data-pin")] = { x: r.left + r.width / 2, y: r.top, bottom: r.bottom };
    });
    send("pinRects", { rects: rects, viewportHeight: window.innerHeight });
  }
  function queueRects() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(function () { frameQueued = false; reportRects(); });
  }
  var renderTimer;
  function queueRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay || 150);
  }

  // ── Input ────────────────────────────────────────────────────────────────
  function isOurs(t) { return t && t.closest && t.closest("[data-mmg-review]"); }

  document.addEventListener("mousemove", function (e) {
    if (mode !== "comment" || isOurs(e.target)) { if (hoverBox) hoverBox.style.display = "none"; return; }
    ensureLayer();
    var r = e.target.getBoundingClientRect();
    hoverBox.style.display = "block";
    hoverBox.style.left = r.left - 2 + "px";
    hoverBox.style.top = r.top - 2 + "px";
    hoverBox.style.width = r.width + 4 + "px";
    hoverBox.style.height = r.height + 4 + "px";
  }, true);

  function block(e) {
    if (mode === "comment" && !isOurs(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }
  ["mousedown", "mouseup", "pointerdown", "pointerup", "submit", "dblclick"].forEach(function (t) { document.addEventListener(t, block, true); });

  document.addEventListener("click", function (e) {
    if (isOurs(e.target)) return;
    // Site scripts (Webflow menus, sliders) fire synthetic clicks on load;
    // only a real click from the reviewer drops a pin.
    if (mode === "comment" && !e.isTrusted) { e.preventDefault(); e.stopPropagation(); return; }
    if (mode === "comment") {
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      var r = el.getBoundingClientRect();
      var anchor = {
        selector: cssPath(el),
        text: textOf(el),
        offsetX: r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0,
        offsetY: r.height ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 0,
        docX: e.clientX + window.scrollX,
        docY: e.clientY + window.scrollY,
      };
      draft = { x: anchor.docX, y: anchor.docY };
      render();
      send("draft", { anchor: anchor, viewportWidth: window.innerWidth });
      return;
    }
    // Browse mode: stay inside the review when following the site's own links.
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var url;
    try { url = new URL(a.href, cfg.pageUrl); } catch (err) { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    var here = new URL(cfg.pageUrl);
    if (url.pathname === here.pathname && url.search === here.search && url.hash) return; // in-page anchor
    e.preventDefault();
    var bare = function (h) { return h.toLowerCase().replace(/^www\./, ""); };
    if (bare(url.hostname) === bare(here.hostname)) send("navigate", { url: url.href });
    else window.open(url.href, "_blank", "noopener");
  }, true);

  window.addEventListener("scroll", queueRects, { passive: true });
  window.addEventListener("resize", function () { queueRender(100); });

  // ── Messages from the review page ────────────────────────────────────────
  window.addEventListener("message", function (e) {
    if (e.source !== parent || e.origin !== cfg.appOrigin) return;
    var m = e.data || {};
    if (m.type === "mode") {
      mode = m.mode === "comment" ? "comment" : "browse";
      document.documentElement.style.cursor = mode === "comment" ? "crosshair" : "";
      if (hoverBox && mode !== "comment") hoverBox.style.display = "none";
    } else if (m.type === "pins") {
      pins = m.pins || [];
      render();
    } else if (m.type === "clearDraft") {
      draft = null;
      render();
    } else if (m.type === "focus") {
      var p = pins.filter(function (x) { return x.id === m.id; })[0];
      if (p && p.anchor) {
        var pos = pinPosition(p.anchor);
        window.scrollTo({ top: Math.max(0, pos.y - window.innerHeight / 2), behavior: "smooth" });
        setTimeout(reportRects, 450);
      }
    }
  });

  function ready() {
    ensureLayer();
    send("ready", { pageUrl: cfg.pageUrl, title: document.title, path: new URL(cfg.pageUrl).pathname });
    // Webflow interactions and lazy images shift the layout after load.
    [300, 1200, 3000].forEach(function (t) { setTimeout(render, t); });
    try { new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) if (!isOurs(list[i].target)) return queueRender(400);
    }).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
`;
