const { getAuthenticatedUser } = require('./_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await getAuthenticatedUser(req);
  if (auth.error) return res.status(401).json({ error: auth.error });

  const { supabase, user } = auth;

  const [profileRes, prefsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('preferences').select('*').eq('user_id', user.id).single(),
  ]);

  res.json({
    profile: profileRes.data || { id: user.id },
    preferences: prefsRes.data || { user_id: user.id, likes_genres: [], dislikes_genres: [] },
  });
};
