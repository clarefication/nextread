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

// Existing endpoints (no auth required)
app.post('/api/recommend', require('./api/recommend'));
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

// Supabase-powered endpoints
app.get('/api/config', require('./api/config'));
app.get('/api/me', require('./api/me'));
app.get('/api/saved-books', require('./api/saved-books'));
app.get('/api/history', require('./api/history'));
app.post('/api/preferences', require('./api/preferences'));
app.post('/api/interaction', require('./api/interaction'));
app.post('/api/search', require('./api/search'));
app.post('/api/auth/merge', require('./api/auth/merge'));

// Analytics proxy (bypasses ad blockers)
app.get('/stats/script.js', require('./api/stats/script'));
app.post('/stats/send', require('./api/stats/send'));

app.listen(PORT, () => {
  console.log(`Pick Me Up running at http://localhost:${PORT}`);
});
