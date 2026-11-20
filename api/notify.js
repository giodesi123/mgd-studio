const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateLimitStore = new Map();

function getClientIp(req) {
  const xff = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0]).split(',')[0].trim();
  }
  const realIp = req.headers && req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  if (rateLimitStore.size > 500) {
    for (const [key, timestamps] of rateLimitStore.entries()) {
      const active = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
      if (active.length === 0) rateLimitStore.delete(key);
      else rateLimitStore.set(key, active);
    }
  }
  const recent = (rateLimitStore.get(ip) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    const oldest = recent[0];
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    rateLimitStore.set(ip, recent);
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  rateLimitStore.set(ip, recent);
  return { allowed: true, retryAfterSec: 0 };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const clientIp = getClientIp(req);
  const limit = checkRateLimit(clientIp);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    return res.status(429).json({ ok: false, error: 'Too Many Requests' });
  }

  let data;
  try {
    if (Buffer.isBuffer(req.body)) {
      data = JSON.parse(req.body.toString('utf8'));
    } else if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    } else {
      data = req.body;
    }
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  // Honeypot anti-spam: se valorizzato, risponde 200 silenziosamente senza inviare a Telegram
  if (typeof data._honey === 'string' && data._honey.trim().length > 0) {
    return res.status(200).json({ ok: true });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({ ok: false, error: 'Missing Telegram env vars' });
  }

  const val = (v, fallback = 'Non indicato') => {
    if (v === null || v === undefined) return fallback;
    if (Array.isArray(v)) {
      const joined = v
        .filter(item => item !== null && item !== undefined && typeof item !== 'object')
        .map(item => String(item).trim())
        .filter(Boolean)
        .join(', ');
      return joined || fallback;
    }
    if (typeof v === 'object') return fallback;
    const s = String(v).trim();
    return s || fallback;
  };

  const packageText = val(data.pkgLabel, '') || val(data.package);

  const lines = [
    '📩 Nuova richiesta preventivo — MGD Studio',
    '',
    `🏢 Attività: ${val(data.businessName)}`,
    `🏷️ Tipo attività: ${val(data.businessType)}`,
    `📍 Indirizzo: ${val(data.businessAddress)}`,
    `👤 Cliente: ${val(data.fullName)}`,
    `📞 Telefono: ${val(data.phone)}`,
    `✉️ Email: ${val(data.email)}`,
    '',
    `📦 Pacchetto: ${packageText}`,
    `🎨 Stile: ${val(data.style)}`,
    `🌈 Colori: ${val(data.colors, 'Da concordare')}`,
    `🧩 Sezioni: ${val(data.sections)}`,
    `💬 Pulsante WhatsApp: ${val(data.wantsWhatsapp)}`,
    `🛍️ Vetrina Prodotti/Servizi: ${val(data.wantsShowcase)}`,
    `🔗 Siti di riferimento: ${val(data.referenceLinks, 'Nessuno')}`,
    `⏱️ Tempistica: ${val(data.timeline)}`,
    '',
    `📝 Descrizione:\n${val(data.description)}`,
    '',
    `🗒️ Note:\n${val(data.additionalNotes, 'Nessuna')}`
  ];

  const text = lines.join('\n').slice(0, 4096);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    let tgJson = null;
    try {
      tgJson = await tgRes.json();
    } catch {
      // Ignora errori di parsing su risposta non-JSON
    }

    if (!tgRes.ok || (tgJson && tgJson.ok === false)) {
      const tgError = (tgJson && tgJson.description) || `Telegram API error (${tgRes.status})`;
      const status = tgRes.ok ? 502 : tgRes.status;
      return res.status(status).json({ ok: false, error: tgError });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'Telegram request timed out' });
    }
    return res.status(502).json({
      ok: false,
      error: err && err.message ? err.message : 'Telegram request failed'
    });
  } finally {
    clearTimeout(timeoutId);
  }
};
