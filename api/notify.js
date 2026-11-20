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
    data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  const val = (v, fallback = 'Non indicato') => {
    const s = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
    return s || fallback;
  };

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
    `📦 Pacchetto: ${val(data.pkgLabel || data.package)}`,
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

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    if (!tgRes.ok) {
      let tgError = `Telegram API error (${tgRes.status})`;
      try {
        const errJson = await tgRes.json();
        if (errJson && errJson.description) {
          tgError = errJson.description;
        }
      } catch {
        // Ignora errori di parsing su risposta di errore
      }
      return res.status(tgRes.status).json({ ok: false, error: tgError });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: err && err.message ? err.message : 'Telegram request failed'
    });
  }
};
