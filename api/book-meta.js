const { lookupBook } = require('./_helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, author } = req.body;
  if (!title || !author) return res.status(400).json({ error: 'title and author required' });

  res.json(await lookupBook(title, author));
};
