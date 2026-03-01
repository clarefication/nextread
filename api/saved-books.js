const { getAuthenticatedUser } = require('./_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await getAuthenticatedUser(req);
  if (auth.error) return res.status(401).json({ error: auth.error });

  const { supabase, user } = auth;

  // Get all interactions, ordered newest first
  const { data, error } = await supabase
    .from('book_interactions')
    .select('book_id, title, author, cover_url, interaction_type, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Keep only latest interaction per book, filter to saves only
  const latest = new Map();
  for (const row of data || []) {
    if (!latest.has(row.book_id)) latest.set(row.book_id, row);
  }

  const books = [];
  for (const row of latest.values()) {
    if (row.interaction_type === 'save') {
      books.push(row);
    }
  }

  res.json({ books });
};
