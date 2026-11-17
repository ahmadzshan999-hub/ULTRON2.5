import { createClient } from '@supabase/supabase-js';

let authClient = null;

function getAuthClient() {
  if (authClient) return authClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  authClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return authClient;
}

export async function authenticate(req, res, next) {
  try {
    const supabase = getAuthClient();

    if (!supabase) {
      return res.status(503).json({
        error: 'Supabase server configuration is missing.'
      });
    }

    const authorization = req.headers.authorization || '';

    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'You must sign in first.'
      });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        error: 'Authentication token is missing.'
      });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: 'Your session is invalid. Please sign in again.'
      });
    }

    req.user = data.user;
    req.accessToken = token;
    return next();
  } catch (error) {
    console.error('Authentication error:', error);

    return res.status(500).json({
      error: 'Could not verify your account.'
    });
  }
}
