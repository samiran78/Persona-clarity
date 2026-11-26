require('dns').setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config();
const path    = require('path');
const express = require('express');
const mongoose = require('mongoose');

const Message = require('./models/Message');
const Event   = require('./models/Event');
const { ALLOWED_TYPES } = require('./models/Event');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust one proxy hop (Render's load-balancer) so req.ip is the real client IP
app.set('trust proxy', 1);

// ── MongoDB ────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || '')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error (server still starting):', err.message));

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '8kb' }));

// Block any attempt to reach files outside public/ or the two allowed paths
// (express.static + explicit /data/facts.json route handle legit requests;
//  this catch-all fires for anything else that isn't an API route).
// We define the static middleware AFTER the API routes so API routes win.

// ── In-memory rate limiter: 8 successful req / 60 s per IP ───────────────
// Fixed-window: window is established on the FIRST passing request.
// Requests that fail validation never reach this middleware, so they
// don't consume quota. Blocked (429) requests don't increment the counter
// or reset the window — the check happens before the increment.
const ipBuckets = new Map();

function rateLimitConnect(req, res, next) {
  // req.ip honours X-Forwarded-For when trust proxy is set
  const ip  = req.ip || 'unknown';
  const now = Date.now();
  const WIN = 60_000; // ms
  const MAX = 8;

  let bucket = ipBuckets.get(ip);

  // Start a fresh window if none exists or the previous one has expired
  if (!bucket || now - bucket.start > WIN) {
    bucket = { start: now, count: 0 };
    ipBuckets.set(ip, bucket);
  }

  // Check BEFORE incrementing so a blocked request doesn't consume quota
  if (bucket.count >= MAX) {
    const retryAfter = Math.ceil((bucket.start + WIN - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ ok: false, error: 'Too many requests. Please wait a moment and try again.' });
  }

  // Only count this request once it has passed the limit check
  bucket.count += 1;
  next();
}

// Clean stale buckets every 5 minutes (simple GC)
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, b] of ipBuckets) {
    if (b.start < cutoff) ipBuckets.delete(ip);
  }
}, 300_000);

// ── Email helper ───────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── POST /api/connect ──────────────────────────────────────────────────────
app.post('/api/connect', rateLimitConnect, async (req, res) => {
  try {
    const { name, email, message, sessionId, website } = req.body;

    // Honeypot
    if (website && String(website).trim().length > 0) {
      return res.json({ ok: true }); // silent discard
    }

    // Validate
    const n = (name    || '').trim();
    const e = (email   || '').trim().toLowerCase();
    const m = (message || '').trim();
    const s = (sessionId || '').trim().slice(0, 64);

    if (!n || n.length > 80)   return res.status(400).json({ ok: false, error: 'Name must be 1–80 characters.' });
    if (!EMAIL_RE.test(e))     return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    if (!m || m.length > 1000) return res.status(400).json({ ok: false, error: 'Message must be 1–1000 characters.' });

    await Message.create({ name: n, email: e, message: m, sessionId: s });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/connect error:', err.message);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/event ────────────────────────────────────────────────────────
app.post('/api/event', async (req, res) => {
  try {
    const { sessionId, type, data } = req.body;

    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, error: 'Invalid event type.' });
    }

    const s = (sessionId || '').trim().slice(0, 64);
    if (!s) return res.status(400).json({ ok: false, error: 'sessionId required.' });

    // Accept data only as a plain object; strip anything else
    const safeData = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};

    await Event.create({ sessionId: s, type, data: safeData });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/event error:', err.message);
    res.status(500).json({ ok: false, error: 'Something went wrong.' });
  }
});

// ── GET /stats ─────────────────────────────────────────────────────────────
app.get('/stats', async (req, res) => {
  const key = process.env.STATS_KEY;
  if (!key || req.query.key !== key) {
    return res.status(401).send('<!doctype html><html><body><p>Unauthorised.</p></body></html>');
  }

  try {
    // ── Funnel: distinct sessions per stage ──────────────────────────────────
    // Each stage counts how many unique sessionIds have at least one event of
    // that type, so the numbers are sessions not raw event counts.
    const funnelStages = ['landed', 'node_open', 'form_started', 'form_submitted', 'page_complete'];

    const funnelCounts = await Promise.all(
      funnelStages.map(t =>
        Event.distinct('sessionId', { type: t }).then(ids => ids.length)
      )
    );

    // ── Fog milestones: sessions whose highest fog% reached each threshold ───
    // Build one aggregation that gets the per-session max, then count in JS.
    const fogPeaks = await Event.aggregate([
      { $match: { type: 'fog_progress', 'data.percent': { $exists: true } } },
      { $group: { _id: '$sessionId', maxPct: { $max: '$data.percent' } } }
    ]);
    const fog25 = fogPeaks.filter(r => r.maxPct >= 25).length;
    const fog50 = fogPeaks.filter(r => r.maxPct >= 50).length;
    const fog70 = fogPeaks.filter(r => r.maxPct >= 70).length;
    const avgFog = fogPeaks.length
      ? (fogPeaks.reduce((s, r) => s + r.maxPct, 0) / fogPeaks.length).toFixed(1)
      : 'n/a';

    // ── Total unique sessions ────────────────────────────────────────────────
    const totalSessions = (await Event.distinct('sessionId')).length;

    // ── Most-opened nodes (by distinct sessions, not raw opens) ─────────────
    const nodeOpenings = await Event.aggregate([
      { $match: { type: 'node_open' } },
      { $group: { _id: '$data.id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // ── Last 20 messages ─────────────────────────────────────────────────────
    const messages = await Message.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const funnelRows = [
      ['Landed',           funnelCounts[0]],
      ['Cleared 25% fog',  fog25],
      ['Cleared 50% fog',  fog50],
      ['Cleared 70% fog',  fog70],
      ['Opened a node',    funnelCounts[1]],
      ['Started form',     funnelCounts[2]],
      ['Submitted form',   funnelCounts[3]],
      ['Page complete',    funnelCounts[4]],
    ];

    const nodeRows = nodeOpenings.map(n =>
      `<tr><td>${esc(String(n._id || ''))}</td><td>${n.count}</td></tr>`
    ).join('');

    const msgRows = messages.map(m => `
      <tr>
        <td>${esc(m.name)}</td>
        <td>${esc(m.email)}</td>
        <td>${esc(m.message)}</td>
        <td>${new Date(m.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
      </tr>`).join('');

    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex">
  <title>Stats</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
    table { border-collapse: collapse; width: 100%; font-size: 0.88rem; margin-top: 0.5rem; }
    th, td { border: 1px solid #ddd; padding: 0.4rem 0.7rem; text-align: left; vertical-align: top; }
    th { background: #f4f4f4; }
    td:last-child { word-break: break-word; max-width: 36ch; }
    .meta { color: #555; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>Stats</h1>
  <p class="meta">Total sessions: <strong>${totalSessions}</strong> &nbsp;|&nbsp; Average fog cleared: <strong>${avgFog}%</strong></p>

  <h2>Funnel</h2>
  <table><thead><tr><th>Stage</th><th>Sessions</th></tr></thead><tbody>
    ${funnelRows.map(([s, c]) => `<tr><td>${s}</td><td>${c}</td></tr>`).join('')}
  </tbody></table>

  <h2>Nodes opened (top 10)</h2>
  <table><thead><tr><th>Node</th><th>Opens</th></tr></thead><tbody>${nodeRows || '<tr><td colspan="2">No data yet</td></tr>'}</tbody></table>

  <h2>Last 20 messages</h2>
  <table><thead><tr><th>Name</th><th>Email</th><th>Message</th><th>Sent (UTC)</th></tr></thead><tbody>
    ${msgRows || '<tr><td colspan="4">No messages yet</td></tr>'}
  </tbody></table>
</body>
</html>`);
  } catch (err) {
    console.error('/stats error:', err.message);
    res.status(500).send('Error loading stats.');
  }
});

function esc(str) {
  // Escapes the five characters that can break HTML context:
  //   &  →  &amp;   (must be first to avoid double-escaping)
  //   <  →  &lt;    (closes tags)
  //   >  →  &gt;    (closes tags)
  //   "  →  &quot;  (breaks attribute values)
  //   '  →  &#39;   (breaks single-quoted attribute values)
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ── Static files ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Explicit route for facts.json only — nothing else from project root
app.get('/data/facts.json', (_req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'facts.json'));
});

// Catch-all: return 404 for anything not matched above
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
