const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Unauthorized' };
  }

  const token = authHeader.slice(7);

  const verifier = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error } = await verifier.auth.getUser(token);

  if (error || !user) {
    return { error: 'Unauthorized' };
  }

  // Create an RLS-scoped client that acts as this user
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  return { supabase, user };
}

function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = { getAuthenticatedUser, createServiceClient };
