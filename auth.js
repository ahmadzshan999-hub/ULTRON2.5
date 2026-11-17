import { createClient } from '@supabase/supabase-js';

let authClient;

function getAuthClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || url.includes('YOUR_PROJECT')) {
    const error = new Error('Supabase server settings are missing. Add SUPABASE_URL and SUPABASE_ANON_KEY to the server environment.');
    error.status = 503;
    throw error;
  }
  if (!authClient) {
    authClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return authClient;
}

export async function authenticate(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

    const { data, error } = await getAuthClient().auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
    }

    req.user = data.user;
    next();
  } catch (error) {
    next(error);
  }
}
