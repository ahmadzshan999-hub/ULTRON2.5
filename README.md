# ULTRON AI — corrected full-stack project

ULTRON is a React/Vite frontend with an Express API, Supabase authentication and private chat storage, and OpenAI Responses API streaming.

## Included

- `client/` — complete responsive frontend, startup/error screens, styles and app icon
- `server/` — API server, Supabase token verification, AI streaming and document extraction
- `supabase/schema.sql` — database tables, indexes, grants and row-level security policies
- `Dockerfile` and `render.yaml` — Node hosting configuration
- `.env.example` and `.env` — environment-variable templates (replace placeholders before use)

## Required account settings

Set these values in the private root `.env` file for local use, or in your hosting provider's environment-variable settings for a deployed app:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or a supported Supabase publishable key)
- `VITE_SUPABASE_URL` — same project URL
- `VITE_SUPABASE_ANON_KEY` — same public anon/publishable key
- `OPENAI_API_KEY` — private server-side OpenAI API key
- `OPENAI_MODEL` — a model enabled for the OpenAI API project

Never put the OpenAI secret key in a variable beginning with `VITE_` and never commit a real `.env` file.

## Supabase setup

1. Create a Supabase project.
2. Open its SQL Editor and run `supabase/schema.sql`.
3. Enable email/password authentication and configure email confirmation as desired.
4. Put the project URL and public anon/publishable key in the environment settings above.

## Local development

Use Node.js 20 or newer. Install the dependencies and start the development app using the scripts in `package.json`. The Vite frontend is served on port 5173 and forwards `/api` requests to the Express server on port 3000.

## Production hosting

This is a full-stack Node application. It cannot run correctly on static-only hosting such as GitHub Pages because its Express API must also run. Deploy the project as a Node web service using the included `render.yaml` or `Dockerfile`. The service must build the Vite frontend and run the Express server from the same deployment. Set the environment variables in the host dashboard before deploying.

The `/api/health` endpoint reports whether Supabase and OpenAI environment settings are present. The app now displays a readable setup or runtime-error screen instead of silently showing a blank page when frontend initialization fails.

## Features

- Email/password signup and login
- Private conversation history with Supabase row-level security
- Streaming assistant responses
- New chats, chat history and deletion
- TXT, MD, CSV, PDF and DOCX file text extraction (8 MB maximum)
- Browser speech recognition where supported
- Responsive dark interface

## Cost and limitations

OpenAI API usage is billed separately from a ChatGPT subscription. The API model must be enabled for the OpenAI account. Speech recognition depends on browser support and microphone permission. This project has not been independently security-audited.
