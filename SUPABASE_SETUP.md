# Supabase Setup Guide — Next Read

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project URL** and **anon key** from Settings > API
3. Note your **service_role key** (keep this secret — server-side only)

## 2. Run the SQL Migration

1. Go to the SQL Editor in your Supabase dashboard
2. Paste the contents of `supabase/001_tables_and_rls.sql`
3. Run the query

This creates:
- `profiles`, `preferences`, `search_history`, `book_interactions` tables
- Auto-create trigger for new user profiles
- `merge_anonymous_user()` function for guest-to-email migration
- Row Level Security policies

## 3. Configure Authentication

### Enable Email Provider
1. Go to **Authentication > Providers**
2. Enable the **Email** provider
3. Enable **"Allow anonymous sign-ins"** (Authentication > Settings)

### Set Redirect URLs
1. Go to **Authentication > URL Configuration**
2. Set **Site URL**: `https://nextread-ecru.vercel.app` (or your domain)
3. Add **Redirect URLs**:
   - `http://localhost:3000/auth/callback.html`
   - `https://nextread-ecru.vercel.app/auth/callback.html`

### Email Templates (optional)
Customize the magic link email under **Authentication > Email Templates** to match the Next Read brand.

## 4. Set Environment Variables

Add to your `.env` file (local) and Vercel environment variables (production):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...your-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key
```

The `SUPABASE_SERVICE_ROLE_KEY` is only used server-side for the merge endpoint. Never expose it to the browser.

## 5. Install Dependencies

```bash
npm install
```

This installs `@supabase/supabase-js` (added to package.json).

## 6. Verify

1. Start the server: `node server.js`
2. Open `http://localhost:3000`
3. You should see "Guest" badge in the top bar
4. Search for books — results should save to `search_history`
5. Click "Sign in to save & sync" — enter email — check for magic link
6. After signing in, badge should show your email
7. Like/save buttons on cards should record interactions

## Architecture Notes

- **Anonymous first**: Every visitor gets an anonymous Supabase session automatically
- **Magic link auth**: Single flow via `signInWithOtp({ email })` — no passwords
- **Data merge**: When a guest signs in with email, their anonymous data (searches, interactions, preferences) is merged into their email account via a Postgres function
- **RLS enforced**: Users can only read/write their own rows
- **Personalization**: The `/api/search` endpoint uses preferences and interaction history to build better Claude prompts
- **Graceful fallback**: If Supabase isn't configured, the app falls back to the original `/api/recommend` endpoint with localStorage-only history
