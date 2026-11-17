
# ULTRON AI

A personal AI assistant built with React, Vite, Express,
Supabase and the OpenAI API.

## Project folders

- client: React frontend
- server: Express backend and AI integration
- supabase: database schema and security policies

## Requirements

- Node.js 20 or newer
- Supabase project
- OpenAI API key
- An OpenAI model enabled for your API account

## Environment

Create a root .env file using .env.example as the template.

Set these values:

- PORT
- SUPABASE_URL
- SUPABASE_ANON_KEY
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- OPENAI_API_KEY
- OPENAI_MODEL

Never put the OpenAI secret key in a VITE_ variable.

## Database

Run supabase/schema.sql in the Supabase SQL Editor.

Enable email authentication in Supabase Auth settings.

## Development

The frontend uses Vite on port 5173.
The backend uses Express on port 3000.
Vite forwards /api requests to Express.

## Production

Build the frontend and run the Express server with
NODE_ENV=production.

The Express server serves the built frontend.

## Supported document uploads

- TXT
- MD
- CSV
- PDF
- DOCX

Maximum upload size: 8 MB.
