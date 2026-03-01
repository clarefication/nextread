const { getAuthenticatedUser } = require('./_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await getAuthenticatedUser(req);
  if (auth.error) return res.status(401).json({ error: auth.error });

  const { supabase, user } = auth;
  const { likes_genres, dislikes_genres } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (Array.isArray(likes_genres)) updates.likes_genres = likes_genres;
  if (Array.isArray(dislikes_genres)) updates.dislikes_genres = dislikes_genres;

  const { error } = await supabase
    .from('preferences')
    .update(updates)
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
};
