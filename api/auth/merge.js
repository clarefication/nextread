const { getAuthenticatedUser, createServiceClient } = require('../_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await getAuthenticatedUser(req);
  if (auth.error) return res.status(401).json({ error: auth.error });

  const { user } = auth;
  const { oldUserId } = req.body;

  if (!oldUserId || typeof oldUserId !== 'string') {
    return res.status(400).json({ error: 'oldUserId is required' });
  }

  // No-op if same user
  if (oldUserId === user.id) {
    return res.json({ merged: false, reason: 'same user' });
  }

  const service = createServiceClient();

  // Verify old user exists and is anonymous
  const { data: oldUser, error: lookupErr } = await service.auth.admin.getUserById(oldUserId);
  if (lookupErr || !oldUser?.user) {
    return res.status(400).json({ error: 'Old user not found' });
  }

  if (!oldUser.user.is_anonymous) {
    return res.status(400).json({ error: 'Old user is not anonymous' });
  }

  // Call the merge function
  const { error: mergeErr } = await service.rpc('merge_anonymous_user', {
    old_uid: oldUserId,
    new_uid: user.id,
  });

  if (mergeErr) {
    return res.status(500).json({ error: mergeErr.message });
  }

  res.json({ merged: true });
};
