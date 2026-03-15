# PUTrace

**Live:** https://putrace.onrender.com

PUTrace is a QR-based campus lost-and-found web app built for Pan Pacific University. Students register their valuables, attach a printed QR label, and get notified the moment someone scans it.

## Features

- **Account system** — Signup/login restricted to `@panpacificu.edu.ph` school emails, with email verification and password reset
- **Google SSO** — One-click "Continue with Google" login, enforcing the school domain automatically
- **QR Item Registration** — Register any item with an optional photo; generates a unique QR code to print and attach
- **Lost Board** — Mark an item as lost so campus members can submit sighting reports
- **Found Items Board** — Post a found item; multiple students can claim it and open separate private chat threads with the finder
- **Real-time messaging** — In-app chat between owners and finders, polling every 2 seconds without a full page reload
- **Email notifications** — Automatic emails on QR reports, sighting reports, and new claims
- **Admin panel** — Manage users (ban/unban), view and delete posts, reports, and message threads
- **Image uploads** — Photos are compressed and stored in Supabase Storage (JPEG/PNG/WEBP/GIF only, 5 MB max)

## Tech Stack

Node.js · Express · EJS · Supabase (Postgres + Storage) · SendGrid · Multer · Sharp · qrcode

## Local Setup

1. Install Node.js 18+ then run:
   ```bash
   npm install
   ```
2. Copy `.env.example` and fill in your credentials (see Environment Variables below).
3. In Supabase, run `db/schema.sql` in the SQL editor and create a public storage bucket named `item-images`.
4. Start the dev server:
   ```bash
   npm run dev
   ```
   App runs at `http://localhost:3000`.

## Environment Variables

```env
PORT=3000
BASE_URL=http://localhost:3000
SESSION_SECRET=your-strong-random-secret

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_EMAIL=your-verified-sender@domain.com

# Optional — only needed if enabling Google SSO
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

> If `SENDGRID_*` is not set, email links are logged to the console instead of being sent.

## Deployment

Deployed on [Render](https://render.com). Uses the included `Procfile` (`web: node server.js`).
Set all environment variables in your host's dashboard before deploying.
