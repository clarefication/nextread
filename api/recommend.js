const { verifyBookExists } = require('./_helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `API error ${response.status}` });
    }

    const data = await response.json();
    let text = data.content?.[0]?.text || '';

    // Verify books exist — filter out hallucinated titles
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.books?.length) {
          const checks = await Promise.all(
            parsed.books.map(b => verifyBookExists(b.title, b.author))
          );
          const verified = parsed.books.filter((_, i) => checks[i]);
          if (verified.length > 0) {
            parsed.books = verified;
            text = JSON.stringify(parsed);
          }
        }
      }
    } catch { /* return original text if verification parsing fails */ }

    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
