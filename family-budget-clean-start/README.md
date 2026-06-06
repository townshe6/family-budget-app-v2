# Family Budget

Mobile-first shared budget web app for two spouses.

## Included
- Separate email/password logins
- Shared household data across phones
- Primary Friday-through-Thursday weekly budget
- Up to 10 additional weekly or monthly buckets
- Owner-only budget amount and bucket editing
- Spending entry with date and description
- Month navigation and monthly activity totals
- Supabase Row Level Security
- Installable mobile web-app manifest

## Setup
1. Create a Supabase project.
2. Open **SQL Editor**, paste `supabase-schema.sql`, and run it.
3. In **Authentication > Providers > Email**, enable Email/Password. For easiest family setup, disable email confirmation; otherwise each person must confirm before signing in.
4. Copy `.env.example` to `.env` and insert the Project URL and publishable/anon key from **Project Settings > API**.
5. Run:
   ```bash
   npm install
   npm run dev
   ```
6. Create the first account without an invite code. That account is the owner.
7. In **Manage**, copy the household invite code. Your wife creates her account using that code.

## Deploy
Deploy the folder to Vercel or Netlify and add these environment variables there:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Build command: `npm run build`
Output directory: `dist`

## Security model
The browser uses the Supabase publishable/anon key. Household access is enforced by Postgres Row Level Security. Never place the Supabase service-role key in this app.
