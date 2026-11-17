# ULTRON

A full-stack AI chat app built with React + Vite, Express, Supabase Auth/Postgres, and the OpenAI Responses API.

## Features
- Email/password sign-up, sign-in and sign-out through Supabase Auth
- Private conversation history stored in Supabase with Row Level Security
- Streaming AI responses (server-side; API key is never exposed to the browser)
- New chats, rename, delete, reopen conversations
- Attach TXT, Markdown, CSV and PDF files as context
- Browser speech-to-text (where supported) and text-to-speech
- Responsive dark interface

## 1. Requirements
- Node.js 20+
- A Supabase project
- An OpenAI API key with API billing/credits enabled

## 2. Supabase setup
1. Create a Supabase project.
2. Open **SQL Editor**, create a new query, and run `supabase/schema.sql`.
3. In **Authentication → Providers**, enable Email.
4. For a simple development setup, you can turn off email confirmation in **Authentication → Settings**. For production, keep confirmation on and configure your email provider.
5. Copy the Project URL and publishable/anon key from Project Settings → API.

## 3. Environment variables
Copy `.env.example` to `.env` in the project root and fill in the values:

- `SUPABASE_URL`: Supabase Project URL
- `SUPABASE_ANON_KEY`: Supabase publishable/anon key
- `OPENAI_API_KEY`: secret OpenAI API key (server only)
- `OPENAI_MODEL`: model available to your OpenAI project (default `gpt-5.5`)

Never put `OPENAI_API_KEY` in a `VITE_` variable or commit `.env`.

## 4. Install and run
From the project root:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

## 5. Production build
```bash
npm run build
npm start
```
The Express server serves the built React app from `client/dist` on port 3000.

## Important notes
- This is a real app starter, not a hosted service. You must configure your own keys and database.
- OpenAI API usage may cost money. Set spending limits in your OpenAI platform account.
- PDF extraction is best-effort; scanned/image-only PDFs need OCR, which is not included.
- Voice input uses the browser's Web Speech API and is not supported in every browser.
- Add rate limiting, monitoring, abuse controls, and stricter upload limits before making this public.
