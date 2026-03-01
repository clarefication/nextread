require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ─── Verify a book exists via Open Library ─────── */
async function verifyBookExists(title, author) {
  try {
    const q = encodeURIComponent(`${title} ${author}`);
    const data = await timedFetch(
      `https://openlibrary.org/search.json?q=${q}&limit=5&fields=title,author_name`, 5000
    ).then(r => r.ok ? r.json() : null);
    if (!data?.docs?.length) return false;
    // Require both title AND author to match for confidence
    return data.docs.some(d => isConfidentMatch(d, title, author));
  } catch { return false; }
}

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

/* ─── Helpers for book metadata ──────────────────── */
function timedFetch(url, ms = 5000, method = 'GET') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { method, signal: ctrl.signal, redirect: 'follow' }).finally(() => clearTimeout(timer));
}

function fuzzyMatch(a, b) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

function authorMatch(docAuthors, queryAuthor) {
  if (!docAuthors?.length || !queryAuthor) return false;
  const normQ = queryAuthor.toLowerCase().replace(/[^a-z]/g, '');
  // Extract last name from query (last word)
  const lastNameQ = queryAuthor.trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '');
  return docAuthors.some(a => {
    const normA = a.toLowerCase().replace(/[^a-z]/g, '');
    // Full fuzzy match or last-name match
    return normA.includes(normQ) || normQ.includes(normA) || normA.includes(lastNameQ);
  });
}

// Both title and author must match for a confident result
function isConfidentMatch(doc, title, author) {
  return doc.title && fuzzyMatch(doc.title, title) && authorMatch(doc.author_name, author);
}

// Returns true if the URL points to a real cover image (not a 1x1 placeholder).
// OL's placeholder is 43 bytes; real covers are several KB.
async function isRealCover(url) {
  try {
    const res = await timedFetch(url, 4000, 'HEAD');
    if (!res.ok) return false;
    const len = Number(res.headers.get('content-length') || 0);
    // If content-length header is present and tiny, it's a placeholder
    if (len > 0 && len < 1000) return false;
    // If no content-length (redirects), follow and check body size
    if (len === 0) {
      const full = await timedFetch(url, 4000);
      const buf = await full.arrayBuffer();
      return buf.byteLength > 1000;
    }
    return true;
  } catch { return false; }
}

// Try a list of candidate cover URLs, return the first that's a real image
async function findValidCover(candidates) {
  for (const url of candidates) {
    if (!url) continue;
    if (await isRealCover(url)) return url;
  }
  return null;
}

// Google Books fallback — search by title+author, grab the thumbnail
async function googleBooksCover(title, author) {
  try {
    const q = encodeURIComponent(`${title} ${author}`);
    const data = await timedFetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&fields=items(volumeInfo/imageLinks)`,
      4000
    ).then(r => r.ok ? r.json() : null);
    const link = data?.items?.[0]?.volumeInfo?.imageLinks;
    // Prefer thumbnail, upgrade to zoom=1 for better quality
    const raw = link?.thumbnail || link?.smallThumbnail || null;
    return raw ? raw.replace('&edge=curl', '').replace('zoom=5', 'zoom=1') : null;
  } catch { return null; }
}

async function lookupBook(title, author) {
  const empty = { olCover: null, olRating: null, isbn13: null, isbn10: null };

  // Try combined query first (more reliable), then fall back to split fields
  const queries = [
    `q=${encodeURIComponent(title + ' ' + author)}&limit=5`,
    `title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=5`,
  ];

  for (const qs of queries) {
    try {
      const data = await timedFetch(
        `https://openlibrary.org/search.json?${qs}&fields=key,cover_i,isbn,ratings_average,title,author_name`
      ).then(r => r.ok ? r.json() : null);

      if (!data?.docs?.length) continue;

      // Pick the best match: require both title AND author to match
      const doc = data.docs.find(d => isConfidentMatch(d, title, author))
                || data.docs.find(d => d.title && fuzzyMatch(d.title, title) && d.author_name?.length);
      if (!doc) continue; // no confident match — try next query

      const isbns  = doc.isbn || [];
      const isbn13 = isbns.find(i => /^97[89]\d{10}$/.test(i)) || null;
      const isbn10 = isbns.find(i => /^\d{9}[\dXx]$/.test(i)) || null;

      // Build candidate cover URLs in priority order
      const coverCandidates = [
        doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        isbn13      ? `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg`    : null,
        isbn10      ? `https://covers.openlibrary.org/b/isbn/${isbn10}-M.jpg`    : null,
      ];

      // Validate covers server-side — reject 1x1 placeholders
      let olCover = await findValidCover(coverCandidates);

      // If no OL cover works, try Google Books as fallback
      if (!olCover) {
        olCover = await googleBooksCover(title, author);
      }

      const olRating = doc.ratings_average
        ? Number(doc.ratings_average).toFixed(1)
        : null;

      if (olCover || isbn13 || isbn10) {
        return { olCover, olRating, isbn13, isbn10 };
      }
    } catch { /* try next query */ }
  }

  // Last resort: even if OL search failed entirely, try Google Books for a cover
  const fallbackCover = await googleBooksCover(title, author);
  if (fallbackCover) return { olCover: fallbackCover, olRating: null, isbn13: null, isbn10: null };

  return empty;
}

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
