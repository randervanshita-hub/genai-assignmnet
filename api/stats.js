// GET /api/stats
// Reads the Supabase table and returns the two numbers shown on the page:
// how many Payday Plans have been made, and the average monthly saving identified by Two Cuts.

const { supabaseHeaders, tableUrl } = require('./_shared');

module.exports = async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server is missing Supabase settings.' });
  }
  try {
    const r = await fetch(tableUrl('?select=identified_saving&order=id.desc&limit=1000'), {
      headers: supabaseHeaders({ Prefer: 'count=exact' }),
    });
    if (!r.ok && r.status !== 206) throw new Error(`Supabase read failed (${r.status})`);
    const rows = await r.json();
    const total = Number((r.headers.get('content-range') || '').split('/')[1]) || rows.length;
    const savings = rows.map((x) => x.identified_saving).filter((n) => typeof n === 'number');
    const average = savings.length ? Math.round(savings.reduce((a, b) => a + b, 0) / savings.length) : 0;
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    return res.status(200).json({ plans: total, average_saving: average });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Stats unavailable.' });
  }
};
