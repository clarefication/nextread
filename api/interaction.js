const { getAuthenticatedUser } = require('./_supabase');

const VALID_TYPES = ['click', 'like', 'dislike', 'save', 'read', 'read-dislike'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await getAuthenticatedUser(req);
  if (auth.error) return res.status(401).json({ error: auth.error });

  const { supabase, user } = auth;
  const { book_id, title, author, cover_url, interaction_type } = req.body;

  if (!title || !author || !interaction_type) {
    return res.status(400).json({ error: 'title, author, and interaction_type are required' });
  }

  if (!VALID_TYPES.includes(interaction_type)) {
    return res.status(400).json({ error: `interaction_type must be one of: ${VALID_TYPES.join(', ')}` });
  }

  // Generate a stable book_id from title+author if not provided
  const id = book_id || `${title}::${author}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const { error } = await supabase.from('book_interactions').insert({
    user_id: user.id,
    book_id: id,
    title,
    author,
    cover_url: cover_url || null,
    interaction_type,
  });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
};
