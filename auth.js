]
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

const authClient = url && key
  ? createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

export async function authenticate(req, res, next) {
  try {
    if (!authClient) {
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

    const token = authorization.slice(7);

    const { data, error } = await authClient.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: 'Your session is invalid. Please sign in again.'
      });
    }

    req.user = data.user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);

    return res.status(500).json({
      error: 'Could not verify your account.'
    });
  }
}
