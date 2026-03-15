# PUTrace — Campus Lost & Found System

**Live:** https://putrace.onrender.com

PUTrace is a QR-based campus lost-and-found web app built for Pan Pacific University. Students register their valuables, attach a printed QR label, and get notified the moment someone scans it — no guard office visit, no Facebook post, no guesswork.

## Features

- **Account system** — Signup and login restricted to `@panpacificu.edu.ph` school emails, with email verification and password reset
- **Google SSO** — One-click "Continue with Google" login, automatically enforcing the school domain
- **QR Item Registration** — Register any item with an optional photo and description; generates a unique QR code to print and stick on the item
- **Lost Board** — Mark an item as lost so other students can submit sighting reports with a location hint
- **Found Items Board** — Post a found item so the owner can see it; multiple students can claim it and each gets a private chat thread with the finder
- **Real-time messaging** — In-app chat between owners and finders, updating every 2 seconds without a page reload
- **Email notifications** — Automatic email alerts on QR scan reports, sighting reports, and new claims
- **Admin panel** — Manage users (ban/unban), delete posts, reports, and view message threads
- **Image uploads** — Photos are compressed and stored securely; only image files accepted (5 MB max)

## Tech Stack

Node.js · Express · EJS · Supabase (Postgres + Storage) · SendGrid · Multer · Sharp · qrcode
