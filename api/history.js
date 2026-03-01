const { getAuthenticatedUser } = require('./_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await getAuthenticatedUser(req);
  if (auth.error) return res.status(401).json({ error: auth.error });

  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from('search_history')
    .select('id, query_text, filters, results, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ searches: data || [] });
};
