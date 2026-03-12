# PUTrace

PUTrace is a QR-based campus lost-and-found web app. Students register valuables, attach printed QR labels, and receive reports when someone scans the code. It includes a Lost Board, Found Items Board, and messaging between owners and finders.

## Features
- Student signup/login (restricted to `@panpacificu.edu.ph`)
- All actions require a logged-in account (including QR reports and boards)
- Register items with optional photo + auto-generated QR code
- Lost Board sightings and Found Items claims
- Owner–finder messaging threads
- Admin panel for users, posts, and reports
- Email notifications (verification, reset, QR reports, claims)

## Tech
Node.js, Express, EJS, Supabase (Postgres + Storage), SendGrid, Multer, Sharp, qrcode

## Quick Start
1. Install Node.js 18+ and dependencies
   ```bash
   npm install
   ```
2. Configure environment variables (see below).
3. In Supabase:
   - Run `db/schema.sql` in the SQL editor
   - Create a public storage bucket named `item-images`
4. Start the app
   ```bash
   npm run dev
   ```

App runs at `http://localhost:3000` by default. Use `npm start` for a production run.

## Environment Variables
```env
PORT=3000
BASE_URL=http://localhost:3000
SESSION_SECRET=your-strong-secret

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_EMAIL=your-verified-sender@domain.com
```

Notes:
- `SENDGRID_*` is required for email verification, password resets, and notifications. If not set, links are logged to the console.
- Instruct users to check spam/junk folders if they don’t see verification or reset emails.

## Deploy
- Build: `npm install`
- Start: `npm start`
- Set all env vars in your host (Render/Railway/etc.)
