require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { verifyBookExists, lookupBook } = require('./api/_helpers');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/recommend', async (req, res) => {
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
        model: 'claude-opus-4-6',
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
});

app.post('/api/book-meta', async (req, res) => {
  const { title, author } = req.body;
  if (!title || !author) return res.status(400).json({ error: 'title and author required' });
  res.json(await lookupBook(title, author));
});

app.post('/api/books-meta', async (req, res) => {
  const { books } = req.body;
  if (!Array.isArray(books)) return res.status(400).json({ error: 'books array required' });
  const results = await Promise.all(
    books.map(b => lookupBook(b.title, b.author).catch(() => ({
      olCover: null, olRating: null, isbn13: null, isbn10: null
    })))
  );
  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`Next Read running at http://localhost:${PORT}`);
});
