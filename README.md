# PUTrace

QR-based campus lost-item recovery system built with Node.js, Express, EJS, and Supabase.

Students register valuables, attach QR labels, and get finder reports when someone scans the QR code. The app also includes a public Found Items Board for items that were picked up and posted by finders.

## Tech Stack

- Runtime: Node.js >= 18
- Framework: Express 4
- Database: Supabase (Postgres)
- Templates: EJS
- Auth: `express-session` + `bcryptjs`
- QR: `qrcode` (stored as a data URL)
- Uploads: Multer memory storage (max 5 MB)
- Image processing: Sharp (resized to max 800x800, JPEG quality 75)
- File storage: Supabase Storage bucket `item-images`

## Core Features

- Sign up, login, logout
- Register items with optional image upload
- Generate and download QR codes
- Public QR scan page to submit finder reports
- Public Lost Board (`/lost`) with sighting reporting
- Public Found Items Board (`/found-items`) with claim flow
- Dashboard search and filtering
- Item status updates (`active`, `lost`, `recovered`)
- Resolve finder reports
- Account settings (name and password)

## Item Status Flow

- `active`: normal tracked item, shown in owner dashboard
- `lost`: appears on the public Lost Board
- `recovered`: recovered item, still visible in owner dashboard

Notes:
- New items are created as `active`.
- The Lost Board only shows items marked `lost`.
- Owners can change status from the dashboard.

## Project Structure

```text
server.js
views/
  _header.ejs
  _footer.ejs
  _dashboard_item_card.ejs
  _dashboard_report_row.ejs
  home.ejs
  signup.ejs
  login.ejs
  dashboard.ejs
  lost.ejs
  found_qr.ejs
  found_items.ejs
  account.ejs
  not_found.ejs
static/
  styles.css
  putrace_circular_logo.png
db/
  schema.sql
Procfile
```

## Main Routes

- `GET /` home
- `GET /signup`, `POST /signup`
- `GET /login`, `POST /login`
- `GET /logout`
- `GET /dashboard`, `POST /dashboard`
- `GET /lost`, `POST /lost/:id/sighting`
- `GET /found/:token`, `POST /found/:token`
- `GET /found-items`, `POST /found-items`, `POST /found-items/:id/claim`
- `POST /report/:id/resolve`
- `GET /account`, `POST /account`, `POST /account/password`
- `POST /item/:id/status`, `POST /item/:id/delete`
- `GET /download/:token`

## Database Tables

Defined in `db/schema.sql`:

- `users`
- `items`
- `finder_reports`
- `found_posts`

## Environment Variables

Create `.env` in the project root:

```env
PORT=5000
BASE_URL=http://localhost:5000
SESSION_SECRET=your-strong-secret
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

## Local Setup

```bash
npm install
npm run dev
```

Before running:

- Execute `db/schema.sql` in Supabase SQL editor
- Create a public storage bucket named `item-images`

App URL: `http://localhost:5000`

## Deploy (Render)

- Build command: `npm install`
- Start command: `node server.js`
- Add the same environment variables from `.env`
