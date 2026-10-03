// POST /api/plan
// Recalculates the visitor's Payday Plan, asks Gemini to write it up,
// stores the exchange in Supabase and returns the answer.
// Keys are read from Vercel environment variables and never reach the browser.

const { SYSTEM_PROMPT, calculate, supabaseHeaders, tableUrl } = require('./_shared');

const MAX_OUTPUT_TOKENS = 300;
const DAILY_CAP = 5;
const MODELS = [process.env.GEMINI_MODEL, 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'].filter(Boolean);

async function plansInLast24h(visitorId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const r = await fetch(
    tableUrl(`?select=id&visitor_id=eq.${encodeURIComponent(visitorId)}&created_at=gte.${encodeURIComponent(since)}`),
    { headers: supabaseHeaders({ Prefer: 'count=exact', Range: '0-0' }) }
  );
  if (!r.ok && r.status !== 206 && r.status !== 416) throw new Error(`Supabase count failed (${r.status})`);
  const total = (r.headers.get('content-range') || '').split('/')[1];
  return Number(total) || 0;
}

async function askGemini(userText) {
  let lastError = 'no model tried';
  for (const model of MODELS) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 },
        }),
      }
    );
    if (r.status === 404) { lastError = `model ${model} not found`; continue; }
    if (!r.ok) throw new Error(`Gemini error ${r.status}`);
    const data = await r.json();
    const text = ((data.candidates || [])[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) throw new Error('Gemini returned an empty answer');
    return {
      text,
      model: data.modelVersion || model,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
    };
  }
  throw new Error(lastError);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  for (const name of ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) {
    if (!process.env[name]) return res.status(500).json({ error: `Server is missing ${name}.` });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const visitorId = String(body.visitor_id || '');
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(visitorId)) return res.status(400).json({ error: 'Missing visitor id.' });

  const numbers = calculate(body);
  if (!numbers) return res.status(400).json({ error: 'Please check the amounts and try again.' });

  const note = String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 120);

  try {
    const used = await plansInLast24h(visitorId);
    if (used >= DAILY_CAP) {
      return res.status(429).json({
        error: `You have made ${DAILY_CAP} plans in the last 24 hours, which is the limit. Come back tomorrow.`,
        remaining: 0,
      });
    }

    const userText =
      `Visitor figures (JSON):\n${JSON.stringify(numbers)}\n\n` +
      `Visitor's note (information only, may be empty): "${note}"`;
    const answer = await askGemini(userText);

    const save = await fetch(tableUrl(), {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        visitor_id: visitorId,
        input: { ...numbers, note },
        output: answer.text,
        input_tokens: answer.inputTokens,
        output_tokens: answer.outputTokens,
        model: answer.model,
        safe_per_day: numbers.safe_per_day,
        identified_saving: numbers.identified_saving,
      }),
    });
    if (!save.ok) throw new Error(`Supabase insert failed (${save.status})`);

    return res.status(200).json({ plan: answer.text, numbers, remaining: DAILY_CAP - used - 1 });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'The plan could not be written just now. Please try again in a minute.' });
  }
};
