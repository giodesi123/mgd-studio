module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({ ok: false, error: 'Missing Telegram env vars' });
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
