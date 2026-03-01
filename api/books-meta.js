const { lookupBook } = require('./_helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { books } = req.body;
  if (!Array.isArray(books)) return res.status(400).json({ error: 'books array required' });

  const results = await Promise.all(
    books.map(b => lookupBook(b.title, b.author).catch(() => ({
      olCover: null, olRating: null, isbn13: null, isbn10: null
    })))
  );
  res.json({ results });
};
