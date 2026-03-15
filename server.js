// =============================================
// PUTrace - Campus Lost & Found QR System
// Built with: Node.js, Express, EJS, Supabase
// =============================================

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const multer = require("multer");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// ── Setup ──

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max
const app = express();
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Connect to Supabase database
const supabase = createClient(process.env.SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "");

// Item categories for dropdowns
const CATEGORIES = ["Electronics", "ID / Cards", "Clothing", "Bags", "Bottles", "Books", "Accessories", "Keys", "Other"];
const ITEM_STATUS = { ACTIVE: "active", LOST: "lost", RECOVERED: "recovered" };
const ITEM_STATUS_VALUES = Object.values(ITEM_STATUS);
const REPORT_STATUS = { OPEN: "open", RESOLVED: "resolved" };
const ALLOWED_EMAIL_DOMAIN = "panpacificu.edu.ph";

// ── Helper Functions ──

// Remove extra spaces from user input
function sanitize(str) {
  return (str || "").trim();
}

// Check if email format is valid
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Restrict emails to school domain
function isSchoolEmail(email) {
  const normalized = String(email || "").toLowerCase();
  return isValidEmail(normalized) && normalized.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

function normalizeSchoolEmailInput(value) {
  const normalized = sanitize(value).toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("@")) return normalized;
  return `${normalized}@${ALLOWED_EMAIL_DOMAIN}`;
}

function normalizeUsername(value) {
  return sanitize(value).toLowerCase();
}

function isValidUsername(username) {
  return /^[a-z0-9._]{3,30}$/.test(String(username || ""));
}

// Generate a random token for QR codes
function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

// Hash tokens before storing in DB
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function buildResetLink(token) {
  return `${BASE_URL}/reset-password/${token}`;
}

function buildVerifyEmailLink(token) {
  return `${BASE_URL}/verify-email/${token}`;
}

// Branded HTML wrapper for all emails
function emailTemplate(bodyHtml) {
  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',system-ui,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#3a56e4 100%);padding:28px 32px;text-align:center;">
              <img src="${BASE_URL}/putrace_icon_fixed.png" alt="PUTrace" width="48" height="48" style="display:inline-block;vertical-align:middle;border-radius:8px;margin-right:12px;" />
              <span style="color:#fff;font-size:1.5rem;font-weight:700;vertical-align:middle;letter-spacing:-0.5px;">PUTrace</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1a1a2e;font-size:0.95rem;line-height:1.7;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8f9fc;border-top:1px solid #eef0f6;text-align:center;color:#888;font-size:0.8rem;">
              PUTrace &mdash; Campus Lost &amp; Found
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
}

// Generic email sender (uses SendGrid when configured, otherwise logs to console)
async function sendEmail(to, subject, htmlBody) {
  const apiKey = process.env.SENDGRID_API_KEY || "";
  const from = process.env.SENDGRID_FROM_EMAIL || "";
  if (!apiKey || !from) {
    console.log(`[PUTrace email] To: ${to} | Subject: ${subject}`);
    return false;
  }
  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: "PUTrace" },
      subject,
      content: [{ type: "text/html", value: emailTemplate(htmlBody) }]
    })
  });
  if (!resp.ok) console.error("SendGrid error:", await resp.text());
  return resp.ok;
}

// Send password reset email
async function sendPasswordResetEmail(email, resetLink) {
  const apiKey = process.env.SENDGRID_API_KEY || "";
  const from = process.env.SENDGRID_FROM_EMAIL || "";
  if (!apiKey || !from) {
    console.log(`[PUTrace password reset link] ${email}: ${resetLink}`);
    return false;
  }
  return sendEmail(email, "PUTrace Password Reset",
    `<h2 style="margin:0 0 16px;font-size:1.2rem;">Password Reset Request</h2>
     <p>You requested a password reset for your PUTrace account.</p>
     <p style="margin:20px 0;">
       <a href="${resetLink}" style="display:inline-block;background:#3a56e4;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">Reset My Password</a>
     </p>
     <p style="color:#888;font-size:0.87rem;">This link expires in 30 minutes. If you did not request this, you can safely ignore this email.</p>`);
}

async function sendEmailVerificationEmail(email, verifyLink, username) {
  return sendEmail(email, "Verify Your PUTrace Email",
    `<h2 style="margin:0 0 16px;font-size:1.2rem;">Verify Your Email</h2>
     <p>Hi <strong>${username}</strong>,</p>
     <p>Welcome to PUTrace. Verify your school email to activate your account.</p>
     <p style="margin:20px 0;">
       <a href="${verifyLink}" style="display:inline-block;background:#3a56e4;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">Verify My Email</a>
     </p>
     <p style="color:#888;font-size:0.87rem;">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
     <p style="color:#888;font-size:0.87rem;">If you don't see the email in your inbox, please check your spam or junk folder.</p>`);
}

async function getValidResetTokenRecord(rawToken) {
  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("password_reset_tokens")
    .select("id, user_id, expires_at, used_at, created_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function getValidEmailVerificationTokenRecord(rawToken) {
  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("email_verification_tokens")
    .select("id, user_id, expires_at, used_at, created_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

// Make filenames safe for downloads
function safeFileName(value) {
  return (value || "item").replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
}

// Upload an image to Supabase Storage (compress first)
async function uploadImage(fileBuffer, prefix) {
  const compressed = await sharp(fileBuffer)
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();

  const fileName = `${prefix}-${generateToken()}.jpg`;
  const { error } = await supabase.storage
    .from("item-images")
    .upload(fileName, compressed, { contentType: "image/jpeg", upsert: false });

  if (error) return null;

  const { data } = supabase.storage.from("item-images").getPublicUrl(fileName);
  return data.publicUrl;
}

async function createEmailVerificationToken(userId) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("email_verification_tokens").insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt
  });
  return rawToken;
}

// ── Express Config ──

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "static")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 hours
  })
);

// ── Middleware ──

// Load current user and flash messages for every page
app.use(async (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.flash = req.session.flash || null;
  res.locals.currentPath = req.path || "/";
  delete req.session.flash;

  if (req.session.userId) {
    const { data } = await supabase
      .from("users")
      .select("id, full_name, username, email, email_verified, is_admin, is_banned")
      .eq("id", req.session.userId)
      .single();
    res.locals.currentUser = data || null;
    res.locals.isAdmin = data?.is_admin === true;
    if (!data) {
      req.session.userId = null;
      res.locals.isAdmin = false;
    }

    // Count unread messages using session-based last-read tracking
    const { data: userItems } = await supabase
      .from("items")
      .select("id")
      .eq("user_id", req.session.userId);
    const ownedIds = (userItems || []).map((i) => i.id);
    const readReports = req.session.lastReadReports || {};
    const readFoundClaims = req.session.lastReadFoundClaims || {};
    let unread = 0;
    if (ownedIds.length > 0) {
      const { data: openReports } = await supabase
        .from("finder_reports")
        .select("id")
        .in("item_id", ownedIds)
        .eq("status", "open");
      const openReportIds = (openReports || []).map((r) => r.id);
      if (openReportIds.length > 0) {
        const { data: reportMsgs } = await supabase
          .from("report_messages")
          .select("id, report_id, created_at")
          .in("report_id", openReportIds)
          .neq("sender_user_id", req.session.userId);
        unread = (reportMsgs || []).filter((m) => {
          const lr = readReports[String(m.report_id)];
          return !lr || new Date(m.created_at) > new Date(lr);
        }).length;
      }
    }
    const { data: finderPosts } = await supabase
      .from("found_posts")
      .select("id")
      .eq("finder_user_id", req.session.userId);
    const finderPostIds = (finderPosts || []).map((p) => p.id);

    let claimRows = [];
    if (finderPostIds.length > 0) {
      const { data } = await supabase
        .from("found_claims")
        .select("id")
        .or(`claimer_user_id.eq.${req.session.userId},found_post_id.in.(${finderPostIds.join(",")})`);
      claimRows = data || [];
    } else {
      const { data } = await supabase
        .from("found_claims")
        .select("id")
        .eq("claimer_user_id", req.session.userId);
      claimRows = data || [];
    }

    const claimIds = (claimRows || []).map((c) => c.id);
    if (claimIds.length > 0) {
      const { data: foundMsgs } = await supabase
        .from("found_claim_messages")
        .select("id, claim_id, created_at")
        .in("claim_id", claimIds)
        .neq("sender_user_id", req.session.userId);
      unread += (foundMsgs || []).filter((m) => {
        const lr = readFoundClaims[String(m.claim_id)];
        return !lr || new Date(m.created_at) > new Date(lr);
      }).length;
    }
    res.locals.unreadMessagesCount = unread;
  }
  next();
});

// Show a one-time message (success or error)
function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

// Set flash and redirect in one line
function flashRedirect(req, res, path, type, message) {
  setFlash(req, type, message);
  return res.redirect(path);
}

function serializeChatMessage(message, currentUserId) {
  return {
    id: message.id,
    sender_name: message.sender_name || "User",
    message: message.message,
    created_at: message.created_at,
    is_me: message.sender_user_id === currentUserId
  };
}

// Keep category values consistent
function normalizeCategory(category) {
  return CATEGORIES.includes(category) ? category : "Other";
}

// Shared search helper for simple text filtering
function filterBySearch(rows, search, fields) {
  const list = rows || [];
  const query = sanitize(search).toLowerCase();
  if (!query) return list;

  return list.filter((row) =>
    fields.some((field) => String(row[field] || "").toLowerCase().includes(query))
  );
}

// Shared validation for finder/sighting reports
function getReportValidationError(name, email, message) {
  if (name.length < 2) return "Name is too short.";
  if (!isValidEmail(email)) return "Invalid email.";
  if (message.length < 3) return "Message is too short.";
  return null;
}

// Load an item only if it belongs to the logged-in user
async function getOwnedItem(req, itemId, columns = "id, user_id") {
  const { data: item } = await supabase.from("items").select(columns).eq("id", itemId).maybeSingle();
  if (!item || item.user_id !== req.session.userId) return null;
  return item;
}

// Ensure logged-in user can access the report thread (item owner or finder email match)
async function getAccessibleReportContext(req, res, reportId) {
  const id = Number(reportId);
  if (!Number.isFinite(id)) return { error: "not_found" };

  const { data: report } = await supabase
    .from("finder_reports")
    .select("id, item_id, finder_name, finder_email, message, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!report) return { error: "not_found" };

  const { data: item } = await supabase.from("items").select("id, user_id, item_name, image_url, item_description, category").eq("id", report.item_id).maybeSingle();
  if (!item) return { error: "not_found" };

  const { data: owner } = await supabase.from("users").select("id, full_name, email").eq("id", item.user_id).maybeSingle();
  if (!owner) return { error: "not_found" };

  const currentUser = res.locals.currentUser || null;
  if (!currentUser) return { error: "forbidden" };

  const currentEmail = String(currentUser.email || "").toLowerCase();
  const finderEmail = String(report.finder_email || "").toLowerCase();
  const isOwner = currentUser.id === item.user_id;
  const isFinder = currentEmail === finderEmail;

  if (!isOwner && !isFinder) return { error: "forbidden" };
  return { report, item, owner, currentUser, isOwner, isFinder };
}

// Block access if not logged in
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    setFlash(req, "error", "Please log in to continue.");
    const redirect = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?redirect=${redirect}`);
  }
  next();
}

// Block access if not an admin
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  if (!res.locals.isAdmin) return res.status(403).send("Forbidden");
  next();
}

// ── Home Page ──

app.get("/", (req, res) => res.render("home"));

// ── Sign Up ──

app.get("/signup", (req, res) => res.render("signup"));

app.post("/signup", async (req, res) => {
  try {
    const full_name = sanitize(req.body.full_name);
    const username = normalizeUsername(req.body.username);
    const email = normalizeSchoolEmailInput(req.body.email);
    const password = req.body.password || "";
    const confirm_password = req.body.confirm_password || "";

    // Validate inputs
    if (full_name.length < 2 || full_name.length > 100) {
      setFlash(req, "error", "Full name must be 2–100 characters.");
      return res.redirect("/signup");
    }
    if (!isValidUsername(username)) {
      setFlash(req, "error", "Username must be 3–30 characters using lowercase letters, numbers, dots, or underscores.");
      return res.redirect("/signup");
    }
    if (!isValidEmail(email)) {
      setFlash(req, "error", "Please enter a valid email address.");
      return res.redirect("/signup");
    }
    if (!isSchoolEmail(email)) {
      setFlash(req, "error", `Use your school email (@${ALLOWED_EMAIL_DOMAIN}).`);
      return res.redirect("/signup");
    }
    if (password.length < 8) {
      setFlash(req, "error", "Password must be at least 8 characters.");
      return res.redirect("/signup");
    }
    if (password !== confirm_password) {
      setFlash(req, "error", "Passwords do not match.");
      return res.redirect("/signup");
    }

    // Check if email already exists
    const [{ data: emailExists }, { data: usernameExists }] = await Promise.all([
      supabase.from("users").select("id").eq("email", email).maybeSingle(),
      supabase.from("users").select("id").eq("username", username).maybeSingle()
    ]);
    if (emailExists) {
      setFlash(req, "error", "That email is already registered. Try logging in instead.");
      return res.redirect("/signup");
    }
    if (usernameExists) {
      setFlash(req, "error", "That username is already taken.");
      return res.redirect("/signup");
    }

    // Hash password and create account
    const password_hash = await bcrypt.hash(password, 10);
    const { data: createdUser, error } = await supabase
      .from("users")
      .insert({ full_name, username, email, password_hash, email_verified: false })
      .select("id")
      .maybeSingle();

    if (error || !createdUser) {
      setFlash(req, "error", "Signup didn't go through. Please try again.");
      return res.redirect("/signup");
    }

    const rawToken = await createEmailVerificationToken(createdUser.id);
    await sendEmailVerificationEmail(email, buildVerifyEmailLink(rawToken), username);

    setFlash(req, "success", "Account created. Verify your email before logging in. Check your spam/junk folder if you don’t see it.");
    return res.redirect("/login");
  } catch (err) {
    console.error("Signup error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/signup");
  }
});

// ── Availability checks (username/email) ──

app.get("/api/check-username", async (req, res) => {
  const username = normalizeUsername(req.query.username || "");
  if (!isValidUsername(username)) return res.json({ available: false, reason: "invalid" });
  const { data } = await supabase.from("users").select("id").eq("username", username).maybeSingle();
  return res.json({ available: !data });
});

app.get("/api/check-email", async (req, res) => {
  const email = normalizeSchoolEmailInput(req.query.email || "");
  if (!isValidEmail(email)) return res.json({ available: false, reason: "invalid" });
  if (!isSchoolEmail(email)) return res.json({ available: false, reason: "domain" });
  const { data } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
  return res.json({ available: !data });
});

// ── Login / Logout ──

app.get("/login", (req, res) => res.render("login", { loginConfirmed: false, redirectTo: req.query.redirect || "" }));

app.post("/login", async (req, res) => {
  try {
    const identifierRaw = sanitize(req.body.identifier || req.body.email);
    const identifier = normalizeUsername(identifierRaw);
    const password = req.body.password || "";
    const redirectTo = sanitize(req.body.redirectTo || "");
    if (!identifier) {
      setFlash(req, "error", "Enter your username or school email.");
      return res.redirect("/login");
    }

    const lookupQuery = identifierRaw.includes("@")
      ? supabase.from("users").select("*").eq("email", normalizeSchoolEmailInput(identifierRaw))
      : supabase.from("users").select("*").eq("username", identifier);
    const { data: user } = await lookupQuery.maybeSingle();
    if (!user) {
      setFlash(req, "error", "Invalid username/email or password.");
      return res.redirect("/login");
    }

    // Block banned accounts
    if (user.is_banned) {
      setFlash(req, "error", "Your account has been suspended. Contact an administrator.");
      return res.redirect("/login");
    }
    if (!user.email_verified) {
      setFlash(req, "error", "Verify your email before logging in. Check your inbox or spam folder.");
      return res.redirect("/login");
    }

    // Check password
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      setFlash(req, "error", "Invalid username/email or password.");
      return res.redirect("/login");
    }

    // Save user session
    req.session.userId = user.id;
    const destination = (redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")) ? redirectTo : "/dashboard";
    return res.render("login", { loginConfirmed: true, redirectTo: destination });
  } catch (err) {
    console.error("Login error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/login");
  }
});

// Resend email verification link
app.post("/resend-verification", async (req, res) => {
  try {
    const identifierRaw = sanitize(req.body.identifier || req.body.email || "");
    if (!identifierRaw) {
      const message = "Enter your username or school email.";
      if (String(req.headers.accept || "").includes("application/json")) {
        return res.json({ ok: false, message });
      }
      return flashRedirect(req, res, "/login", "error", message);
    }

    const normalizedKey = identifierRaw.includes("@")
      ? normalizeSchoolEmailInput(identifierRaw)
      : normalizeUsername(identifierRaw);

    const now = Date.now();
    const cooldownMs = 60 * 1000;
    const lastMap = req.session.lastVerifyResend || {};
    const lastKey = String(normalizedKey || "").toLowerCase();
    const lastAt = lastMap[lastKey] || 0;
    if (now - lastAt < cooldownMs) {
      const message = "Please wait a minute before requesting another verification email.";
      if (String(req.headers.accept || "").includes("application/json")) {
        return res.json({ ok: false, message, cooldown: Math.ceil((cooldownMs - (now - lastAt)) / 1000) });
      }
      return flashRedirect(req, res, "/login", "error", message);
    }

    const lookupQuery = identifierRaw.includes("@")
      ? supabase.from("users").select("id, email, username, email_verified").eq("email", normalizeSchoolEmailInput(identifierRaw))
      : supabase.from("users").select("id, email, username, email_verified").eq("username", normalizeUsername(identifierRaw));
    const { data: user } = await lookupQuery.maybeSingle();

    if (!user) {
      lastMap[lastKey] = now;
      req.session.lastVerifyResend = lastMap;
      const message = "If the account exists and isn’t verified, we sent a new verification email.";
      if (String(req.headers.accept || "").includes("application/json")) {
        return res.json({ ok: true, message });
      }
      return flashRedirect(req, res, "/login", "success", message);
    }

    if (user.email_verified) {
      lastMap[lastKey] = now;
      req.session.lastVerifyResend = lastMap;
      const message = "Your email is already verified. You can log in.";
      if (String(req.headers.accept || "").includes("application/json")) {
        return res.json({ ok: true, message });
      }
      return flashRedirect(req, res, "/login", "success", message);
    }

    const rawToken = await createEmailVerificationToken(user.id);
    await sendEmailVerificationEmail(user.email, buildVerifyEmailLink(rawToken), user.username || "there");

    lastMap[lastKey] = now;
    req.session.lastVerifyResend = lastMap;
    const message = "Verification email sent. Check your inbox or spam folder.";
    if (String(req.headers.accept || "").includes("application/json")) {
      return res.json({ ok: true, message });
    }
    return flashRedirect(req, res, "/login", "success", message);
  } catch (err) {
    console.error("Resend verification error:", err);
    const message = "Something went wrong. Please try again.";
    if (String(req.headers.accept || "").includes("application/json")) {
      return res.json({ ok: false, message });
    }
    return flashRedirect(req, res, "/login", "error", message);
  }
});

app.get("/verify-email/:token", async (req, res) => {
  try {
    const record = await getValidEmailVerificationTokenRecord(req.params.token);
    if (!record) return flashRedirect(req, res, "/login", "error", "This verification link is invalid or expired.");

    await supabase.from("users").update({ email_verified: true }).eq("id", record.user_id);
    await supabase.from("email_verification_tokens").update({ used_at: new Date().toISOString() }).eq("id", record.id);

    return flashRedirect(req, res, "/login", "success", "Email verified. You can now sign in.");
  } catch (err) {
    console.error("Email verification error:", err);
    return flashRedirect(req, res, "/login", "error", "Something went wrong.");
  }
});

app.get("/forgot-password", (req, res) => res.render("forgot_password"));

app.post("/forgot-password", async (req, res) => {
  try {
    const email = normalizeSchoolEmailInput(req.body.email);
    if (!isSchoolEmail(email)) {
      return flashRedirect(req, res, "/forgot-password", "error", `Use your school email (@${ALLOWED_EMAIL_DOMAIN}).`);
    }

    const { data: user } = await supabase.from("users").select("id, email").eq("email", email).maybeSingle();
    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      await supabase.from("password_reset_tokens").insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt
      });

      const resetLink = buildResetLink(rawToken);
      await sendPasswordResetEmail(email, resetLink);
    }

    // Clean up expired/used tokens in the background
    supabase.from("password_reset_tokens").delete().lt("expires_at", new Date().toISOString()).then(() => {}).catch(() => {});

    return flashRedirect(req, res, "/login", "success", "If your account exists, a password reset link has been sent. Check your spam/junk folder.");
  } catch (err) {
    console.error("Forgot password error:", err);
    return flashRedirect(req, res, "/forgot-password", "error", "Something went wrong.");
  }
});

app.get("/reset-password/:token", async (req, res) => {
  try {
    const record = await getValidResetTokenRecord(req.params.token);
    if (!record) return flashRedirect(req, res, "/forgot-password", "error", "This reset link is invalid or expired.");
    return res.render("reset_password", { token: req.params.token });
  } catch (err) {
    console.error("Reset password page error:", err);
    return flashRedirect(req, res, "/forgot-password", "error", "Something went wrong.");
  }
});

app.post("/reset-password/:token", async (req, res) => {
  try {
    const { new_password, confirm_new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return flashRedirect(req, res, `/reset-password/${req.params.token}`, "error", "New password must be at least 8 characters.");
    }
    if (new_password !== (confirm_new_password || "")) {
      return flashRedirect(req, res, `/reset-password/${req.params.token}`, "error", "New passwords do not match.");
    }

    const record = await getValidResetTokenRecord(req.params.token);
    if (!record) return flashRedirect(req, res, "/forgot-password", "error", "This reset link is invalid or expired.");

    const hash = await bcrypt.hash(new_password, 10);
    await supabase.from("users").update({ password_hash: hash }).eq("id", record.user_id);
    await supabase.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("id", record.id);

    return flashRedirect(req, res, "/login", "success", "Password reset complete. You can now sign in.");
  } catch (err) {
    console.error("Reset password submit error:", err);
    return flashRedirect(req, res, `/reset-password/${req.params.token}`, "error", "Something went wrong.");
  }
});
// ── Google OAuth ──

app.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  if (!clientId) return flashRedirect(req, res, "/login", "error", "Google login is currently disabled by the administrator (Missing credentials).");
  
  const redirectUri = `${BASE_URL}/auth/google/callback`;
  const scope = "email profile";
  // The 'hd' parameter forces Google to only allow the school domain on the selection screen
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&hd=${ALLOWED_EMAIL_DOMAIN}`;
  
  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect("/login");
    
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
    const redirectUri = `${BASE_URL}/auth/google/callback`;
    
    // Exchange the code for an access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokens.error_description || "Failed to fetch token");
    
    // Use the token to fetch the user's profile and email
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await userResponse.json();
    if (!userResponse.ok) throw new Error(profile.error?.message || "Failed to fetch profile");
    
    const email = String(profile.email || "").toLowerCase();
    const fullName = sanitize(profile.name || "Student");
    
    // SECURITY: Reject ANY email that doesn't belong to the school domain, even if Google allowed it
    if (!isSchoolEmail(email)) {
      return flashRedirect(req, res, "/login", "error", `You must use your @${ALLOWED_EMAIL_DOMAIN} account to log in.`);
    }
    
    const { data: user } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
    
    let userId = null;
    if (user) {
      if (user.is_banned) return flashRedirect(req, res, "/login", "error", "Your account has been suspended. Contact an administrator.");
      if (!user.email_verified) await supabase.from("users").update({ email_verified: true }).eq("id", user.id);
      userId = user.id;
    } else {
      // Auto-register new users with a randomized username based on their email prefix
      const baseUsername = email.split("@")[0].replace(/[^a-z0-9._]/g, "");
      const { data: exists } = await supabase.from("users").select("id").eq("username", baseUsername).maybeSingle();
      const finalUsername = exists ? `${baseUsername}_${Math.floor(Math.random() * 1000)}` : baseUsername;
      
      const dummyHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const { data: newUser, error } = await supabase.from("users").insert({
        full_name: fullName,
        username: finalUsername,
        email: email,
        password_hash: dummyHash,
        email_verified: true
      }).select("id").maybeSingle();
      
      if (error || !newUser) throw new Error("Could not create the account.");
      userId = newUser.id;
    }
    
    req.session.userId = userId;
    
    // Instead of redirecting the popup, we tell the main window to redirect and then close the popup.
    return res.send(`
      <script>
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage('google-auth-success', window.location.origin);
        }
        window.close();
      </script>
    `);
    
  } catch (err) {
    console.error("Google OAuth error:", err);
    return flashRedirect(req, res, "/login", "error", "Failed to log in with Google. Please try again.");
  }
});
app.get("/logout", (req, res) => {
  const redirect = req.query.redirect || "/";
  req.session.destroy(() => {
    res.redirect(redirect);
  });
});

// ── Dashboard (view items + reports) ──

app.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const filterCategory = req.query.category || "";
    const filterStatus = req.query.status || "";

    // Get all items belonging to this user
    let query = supabase.from("items").select("*").eq("user_id", req.session.userId).order("created_at", { ascending: false });
    if (filterCategory) query = query.eq("category", filterCategory);
    if (filterStatus) query = query.eq("item_status", filterStatus);
    const { data: items } = await query;

    // Filter by search text
    const filteredItems = filterBySearch(items, search, ["item_name", "item_description", "category"]);

    // Get finder reports for these items
    const itemIds = filteredItems.map((i) => i.id);
    let reports = [];
    if (itemIds.length > 0) {
      const { data } = await supabase
        .from("finder_reports")
        .select("id, item_id, finder_name, finder_email, location_hint, message, status, created_at")
        .in("item_id", itemIds)
        .order("created_at", { ascending: false });
      reports = data || [];
    }

    const { data: finderPosts } = await supabase
      .from("found_posts")
      .select("id, item_name, finder_user_id, finder_name, status")
      .eq("finder_user_id", req.session.userId);
    const finderPostIds = (finderPosts || []).map((p) => p.id);

    let claimRows = [];
    if (finderPostIds.length > 0) {
      const { data } = await supabase
        .from("found_claims")
        .select("id, found_post_id, claimer_user_id, status, created_at")
        .or(`claimer_user_id.eq.${req.session.userId},found_post_id.in.(${finderPostIds.join(",")})`)
        .neq("status", "rejected");
      claimRows = data || [];
    } else {
      const { data } = await supabase
        .from("found_claims")
        .select("id, found_post_id, claimer_user_id, status, created_at")
        .eq("claimer_user_id", req.session.userId)
        .neq("status", "rejected");
      claimRows = data || [];
    }

    const claimPostIds = [...new Set(claimRows.map((c) => c.found_post_id))];
    let postsById = {};
    if (claimPostIds.length > 0) {
      const { data: posts } = await supabase
        .from("found_posts")
        .select("id, item_name, finder_user_id, finder_name, status")
        .in("id", claimPostIds);
      postsById = Object.fromEntries((posts || []).map((p) => [p.id, p]));
    }

    const claimerIds = [...new Set(claimRows.map((c) => c.claimer_user_id).filter(Boolean))];
    let claimersById = {};
    if (claimerIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", claimerIds);
      claimersById = Object.fromEntries((users || []).map((u) => [u.id, u.full_name]));
    }

    const enrichedFoundActivity = (claimRows || []).map((c) => {
      const post = postsById[c.found_post_id];
      if (!post) return null;
      const isClaimer = c.claimer_user_id === req.session.userId;
      const otherName = isClaimer
        ? (post.finder_name || "Finder")
        : (claimersById[c.claimer_user_id] || "Claimer");
      return {
        id: c.id,
        item_name: post.item_name,
        status: post.status === "returned" ? "returned" : c.status,
        role: isClaimer ? "claimer" : "finder",
        other_name: otherName,
        created_at: c.created_at
      };
    }).filter(Boolean);

    // Count open reports per item
    const itemNameMap = Object.fromEntries(filteredItems.map((i) => [i.id, i.item_name]));
    const openCounts = {};
    for (const r of reports) {
      if (r.status === REPORT_STATUS.OPEN) openCounts[r.item_id] = (openCounts[r.item_id] || 0) + 1;
    }

    res.render("dashboard", {
      items: filteredItems.map((i) => ({ ...i, open_reports: openCounts[i.id] || 0 })),
      reports: reports.map((r) => ({ ...r, item_name: itemNameMap[r.item_id] || "Unknown item" })),
      foundActivity: enrichedFoundActivity,
      baseUrl: BASE_URL,
      categories: CATEGORIES,
      search, filterCategory, filterStatus
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    setFlash(req, "error", "Couldn't load your dashboard. Please try again.");
    return res.redirect("/");
  }
});

// ── Register Item ──

app.get("/items/new", requireAuth, (req, res) => {
  res.render("new_item", { categories: CATEGORIES });
});

// Shared handler so old and new form actions both work
async function handleRegisterItem(req, res) {
  try {
    const item_name = sanitize(req.body.item_name);
    const item_description = sanitize(req.body.item_description);
    const category = req.body.category || "Other";

    if (!item_name || item_name.length > 150) {
      return flashRedirect(req, res, "/items/new", "error", "Item name is required (max 150 characters).");
    }
    if (!item_description) {
      return flashRedirect(req, res, "/items/new", "error", "Item description is required.");
    }
    if (item_description.length > 1000) {
      return flashRedirect(req, res, "/items/new", "error", "Description is too long (max 1000 characters).");
    }

    // Generate unique token and QR code
    const token = generateToken();
    const qrUrl = `${BASE_URL}/found/${token}`;
    const qr_data_url = await QRCode.toDataURL(qrUrl);

    // Upload image if provided
    let image_url = null;
    if (req.file) {
      image_url = await uploadImage(req.file.buffer, token);
    }

    // Save item to database
    const { error } = await supabase.from("items").insert({
      user_id: req.session.userId,
      item_name,
      item_description: item_description || null,
      category: normalizeCategory(category),
      item_status: ITEM_STATUS.ACTIVE,
      image_url, token, qr_data_url
    });

    if (error) {
      return flashRedirect(req, res, "/items/new", "error", "Failed to register item.");
    }

    return flashRedirect(req, res, "/dashboard", "success", "Item registered! Your QR code is ready.");
  } catch (err) {
    console.error("Register item error:", err);
    return flashRedirect(req, res, "/items/new", "error", "Something went wrong.");
  }
}

app.post("/items/new", requireAuth, upload.single("image"), handleRegisterItem);
app.post("/dashboard", requireAuth, upload.single("image"), handleRegisterItem);

// ── Lost Board (login required) ──

app.get("/lost", requireAuth, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const filterCategory = req.query.category || "";

    // Get all items marked as "lost"
    let query = supabase
      .from("items")
      .select("id, item_name, item_description, category, image_url, created_at, user_id")
      .eq("item_status", ITEM_STATUS.LOST)
      .order("created_at", { ascending: false });
    if (filterCategory) query = query.eq("category", filterCategory);

    const { data: items } = await query;
    const filteredItems = filterBySearch(items, search, ["item_name", "item_description", "category"]);

    // Get owner first names only (for privacy)
    const userIds = [...new Set(filteredItems.map((i) => i.user_id))];
    let ownerMap = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", userIds);
      for (const u of users || []) {
        ownerMap[u.id] = u.full_name.split(" ")[0]; // first name only
      }
    }

    res.render("lost", {
      items: filteredItems.map((i) => ({ ...i, owner_first_name: ownerMap[i.user_id] || "Someone" })),
      categories: CATEGORIES,
      search, filterCategory
    });
  } catch (err) {
    console.error("Lost board error:", err);
    setFlash(req, "error", "Couldn't load the Lost Board. Please try again.");
    return res.redirect("/");
  }
});

// Submit a sighting report for a lost item
app.post("/lost/:id/sighting", requireAuth, async (req, res) => {
  try {
    const reporter_name = sanitize(req.body.reporter_name);
    const reporter_email = sanitize(req.body.reporter_email);
    const location = sanitize(req.body.location);
    const message = sanitize(req.body.message);

    // Find the lost item
    const { data: item } = await supabase.from("items").select("id, item_name, user_id").eq("id", req.params.id).eq("item_status", "lost").maybeSingle();
    if (!item) {
      setFlash(req, "error", "We couldn't find that item.");
      return res.redirect("/lost");
    }
    if (item.user_id === req.session.userId) {
      return flashRedirect(req, res, "/lost", "error", "You can't report a sighting on your own item.");
    }

    // Validate inputs
    const validationError = getReportValidationError(reporter_name, reporter_email, message);
    if (validationError) return flashRedirect(req, res, "/lost", "error", validationError);
    if (!isSchoolEmail(reporter_email)) {
      return flashRedirect(req, res, "/lost", "error", `Use a school email (@${ALLOWED_EMAIL_DOMAIN}).`);
    }

    // Save report
    const { error } = await supabase.from("finder_reports").insert({
      item_id: item.id,
      finder_name: reporter_name,
      finder_email: reporter_email,
      location_hint: location || null,
      message: `[Sighting] ${message}`,
      status: REPORT_STATUS.OPEN
    });

    if (error) {
      return flashRedirect(req, res, "/lost", "error", "Failed to submit sighting.");
    }

    // Email the item owner
    try {
      const { data: owner } = await supabase.from("users").select("email, full_name").eq("id", item.user_id).single();
      if (owner?.email) {
        await sendEmail(owner.email, `Someone spotted your item — ${item.item_name}`,
          `<h2 style="margin:0 0 16px;font-size:1.2rem;">&#128065; Sighting Report</h2>
           <p>Hi <strong>${owner.full_name || 'there'}</strong>,</p>
           <p>Someone spotted your lost item <strong>${item.item_name}</strong> on campus.</p>
           <table style="width:100%;border-collapse:collapse;margin:16px 0;">
             <tr><td style="padding:8px 12px;background:#f8f9fc;border-radius:6px 6px 0 0;color:#666;font-size:0.85rem;width:110px;">Reported by</td><td style="padding:8px 12px;background:#f8f9fc;border-radius:0 6px 0 0;">${reporter_name} &lt;${reporter_email}&gt;</td></tr>
             ${location ? `<tr><td style="padding:8px 12px;border-top:1px solid #eee;color:#666;font-size:0.85rem;">Where</td><td style="padding:8px 12px;border-top:1px solid #eee;">${location}</td></tr>` : ''}
             <tr><td style="padding:8px 12px;border-top:1px solid #eee;border-radius:0 0 0 6px;color:#666;font-size:0.85rem;">Details</td><td style="padding:8px 12px;border-top:1px solid #eee;border-radius:0 0 6px 0;">${message}</td></tr>
           </table>
           <p style="margin-top:20px;">
             <a href="${BASE_URL}/messages" style="display:inline-block;background:#3a56e4;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">View in Messages</a>
           </p>`
        );
      }
    } catch (emailErr) {
      console.error("Sighting notification email failed:", emailErr);
    }

    return flashRedirect(req, res, "/lost", "success", `Sighting reported for "${item.item_name}". The owner has been notified!`);
  } catch (err) {
    console.error("Sighting error:", err);
    return flashRedirect(req, res, "/lost", "error", "Something went wrong.");
  }
});

// ── QR Code Scan Page (shown when someone scans a QR sticker) ──

app.get("/found/:token", async (req, res) => {
  try {
    if (!req.session.userId) {
      setFlash(req, "error", "To report this item as found, please log in first.");
      return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    }
    const { data: item } = await supabase.from("items").select("*").eq("token", req.params.token).maybeSingle();
    if (!item) return res.status(404).render("not_found");
    if (item.user_id === req.session.userId) {
      setFlash(req, "error", "That's your own item — you can't report it as found.");
      return res.redirect("/dashboard");
    }
    const { data: owner } = await supabase.from("users").select("full_name, email").eq("id", item.user_id).single();
    return res.render("found_qr", { item, owner });
  } catch (err) {
    console.error("QR page error:", err);
    return res.status(500).send("Something went wrong.");
  }
});

// Handle the finder's report form from the QR page
app.post("/found/:token", async (req, res) => {
  if (!req.session.userId) {
    setFlash(req, "error", "To report this item as found, please log in first.");
    return res.redirect(`/login?redirect=${encodeURIComponent(`/found/${req.params.token}`)}`);
  }
  try {
    // Always use the logged-in user's real name/email — ignore form values
    const { data: finder } = await supabase.from("users").select("full_name, email").eq("id", req.session.userId).single();
    const finder_name = finder?.full_name || sanitize(req.body.finder_name);
    const finder_email = finder?.email || sanitize(req.body.finder_email);
    const location_hint = sanitize(req.body.location_hint);
    const message = sanitize(req.body.message);

    const { data: item } = await supabase.from("items").select("id, item_name, user_id").eq("token", req.params.token).maybeSingle();
    if (!item) return res.status(404).render("not_found");
    if (item.user_id === req.session.userId) {
      setFlash(req, "error", "That's your own item — you can't report it as found.");
      return res.redirect("/dashboard");
    }

    // Basic validation
    const validationError = getReportValidationError(finder_name, finder_email, message);
    if (validationError) return flashRedirect(req, res, `/found/${req.params.token}`, "error", validationError);
    if (!isSchoolEmail(finder_email)) {
      return flashRedirect(req, res, `/found/${req.params.token}`, "error", `Use a school email (@${ALLOWED_EMAIL_DOMAIN}).`);
    }
    if (!location_hint) return flashRedirect(req, res, `/found/${req.params.token}`, "error", "Please specify where you found the item.");

    // Save report to database
    const { error } = await supabase.from("finder_reports").insert({
      item_id: item.id,
      finder_name,
      finder_email,
      location_hint: location_hint || null,
      message,
      status: REPORT_STATUS.OPEN
    });

    if (error) {
      return flashRedirect(req, res, `/found/${req.params.token}`, "error", "Failed to submit report.");
    }

    // Email the item owner
    try {
      const { data: owner } = await supabase.from("users").select("email, full_name").eq("id", item.user_id).single();
      if (owner?.email) {
        await sendEmail(owner.email, `Your item was found — ${item.item_name}`,
          `<h2 style="margin:0 0 16px;font-size:1.2rem;">&#127881; Someone found your item!</h2>
           <p>Hi <strong>${owner.full_name || 'there'}</strong>,</p>
           <p><strong>${finder_name}</strong> (${finder_email}) scanned your QR sticker and reported finding your item <strong>${item.item_name}</strong>.</p>
           <table style="width:100%;border-collapse:collapse;margin:16px 0;">
             <tr><td style="padding:8px 12px;background:#f8f9fc;border-radius:6px 6px 0 0;color:#666;font-size:0.85rem;width:110px;">Found by</td><td style="padding:8px 12px;background:#f8f9fc;border-radius:0 6px 0 0;">${finder_name} &lt;${finder_email}&gt;</td></tr>
             ${location_hint ? `<tr><td style="padding:8px 12px;border-top:1px solid #eee;color:#666;font-size:0.85rem;">Where</td><td style="padding:8px 12px;border-top:1px solid #eee;">${location_hint}</td></tr>` : ''}
             <tr><td style="padding:8px 12px;border-top:1px solid #eee;border-radius:0 0 0 6px;color:#666;font-size:0.85rem;">Message</td><td style="padding:8px 12px;border-top:1px solid #eee;border-radius:0 0 6px 0;">${message}</td></tr>
           </table>
           <p style="margin-top:20px;">
             <a href="${BASE_URL}/messages" style="display:inline-block;background:#3a56e4;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">View in Messages</a>
           </p>`);
      }
    } catch (emailErr) {
      console.error("QR report notification email failed:", emailErr);
    }

    return flashRedirect(req, res, `/found/${req.params.token}`, "success", "Report sent! The owner has been notified.");
  } catch (err) {
    console.error("QR report error:", err);
    return flashRedirect(req, res, `/found/${req.params.token}`, "error", "Something went wrong.");
  }
});

// ── Found Items Board (login required) ──

app.get("/found-items", requireAuth, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const filterCategory = req.query.category || "";

    let query = supabase
      .from("found_posts")
      .select("*")
      .in("status", ["unclaimed", "claimed", "returned"])
      .order("created_at", { ascending: false });
    if (filterCategory) query = query.eq("category", filterCategory);

    const { data: posts } = await query;
    const filtered = filterBySearch(posts, search, ["item_name", "item_description", "category", "location_found"]);

    const postIds = (filtered || []).map((p) => p.id);
    let claimCounts = {};
    let userClaimByPost = {};
    if (postIds.length > 0) {
      const { data: claims } = await supabase
        .from("found_claims")
        .select("id, found_post_id, claimer_user_id, status")
        .in("found_post_id", postIds);
      const rows = claims || [];
      rows.forEach((c) => {
        if (c.status === "open") {
          claimCounts[c.found_post_id] = (claimCounts[c.found_post_id] || 0) + 1;
        }
        if (c.claimer_user_id === req.session.userId && c.status !== "rejected") {
          if (!userClaimByPost[c.found_post_id]) userClaimByPost[c.found_post_id] = c.id;
        }
      });
    }

    const enriched = (filtered || []).map((p) => ({
      ...p,
      claim_count: claimCounts[p.id] || 0,
      user_claim_id: userClaimByPost[p.id] || null
    }));

    res.render("found_items", { posts: enriched, categories: CATEGORIES, search, filterCategory });
  } catch (err) {
    console.error("Found board error:", err);
    setFlash(req, "error", "Couldn't load the Found Board. Please try again.");
    return res.redirect("/");
  }
});

app.post("/found-items", requireAuth, upload.single("image"), async (req, res) => {
  try {
    // Always use the logged-in user's real name/email — ignore form values
    const { data: poster } = await supabase.from("users").select("full_name, email").eq("id", req.session.userId).single();
    const finder_name = poster?.full_name || sanitize(req.body.finder_name);
    const finder_email = poster?.email || sanitize(req.body.finder_email);
    const item_name = sanitize(req.body.item_name);
    const item_description = sanitize(req.body.item_description);
    const category = req.body.category || "Other";
    const location_found = sanitize(req.body.location_found);
    
    // Process separate date and time fields
    const found_date_raw = (req.body.found_date || "").trim();
    const found_time_raw = (req.body.found_time || "").trim();
    let found_at = null;
    
    if (found_date_raw) {
      // If time is provided, append it; otherwise use start of day UTC or local depending on parsing
      const dateTimeString = found_time_raw ? `${found_date_raw}T${found_time_raw}` : `${found_date_raw}T00:00`;
      const foundDate = new Date(dateTimeString);
      if (Number.isNaN(foundDate.getTime())) {
        return flashRedirect(req, res, "/found-items", "error", "Please provide a valid date/time for when you found the item.");
      }
      found_at = foundDate.toISOString();
    }

    // Validate
    if (!item_name || item_name.length > 150) return flashRedirect(req, res, "/found-items", "error", "Item name is required (max 150 chars).");
    if (!location_found) return flashRedirect(req, res, "/found-items", "error", "Please specify where you found the item.");

    // Upload image if provided (reuse helper)
    const image_url = req.file ? await uploadImage(req.file.buffer, "found") : null;

    // Save to database
    const { error } = await supabase.from("found_posts").insert({
      finder_name, finder_email, item_name,
      item_description: item_description || null,
      category: normalizeCategory(category),
      location_found: location_found || null,
      found_at,
      image_url,
      status: "unclaimed",
      finder_user_id: req.session.userId
    });

    if (error) {
      return flashRedirect(req, res, "/found-items", "error", "Couldn't post your item. Please try again.");
    }
    return flashRedirect(req, res, "/found-items", "success", "Posted! The owner can now see it on the Found Board.");
  } catch (err) {
    console.error("Post found item error:", err);
    return flashRedirect(req, res, "/found-items", "error", "Something went wrong.");
  }
});

// Claim a found item (must be logged in)
app.post("/found-items/:id/claim", requireAuth, async (req, res) => {
  try {
    const { data: post } = await supabase
      .from("found_posts")
      .select("*")
      .eq("id", Number(req.params.id))
      .maybeSingle();

    if (!post || post.status === "returned") {
      setFlash(req, "error", "That post is no longer available.");
      return res.redirect("/found-items");
    }

    const claimerId = req.session.userId;
    if (post.finder_user_id === claimerId) {
      return flashRedirect(req, res, "/found-items", "error", "You can't claim your own found post.");
    }

    const { data: existing } = await supabase
      .from("found_claims")
      .select("id, status")
      .eq("found_post_id", post.id)
      .eq("claimer_user_id", claimerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && existing.status !== "rejected") {
      setFlash(req, "info", "You already claimed this item. Continue the conversation below.");
      return res.redirect(`/found-claims/${existing.id}`);
    }

    const { data: newClaim, error: claimError } = await supabase
      .from("found_claims")
      .insert({ found_post_id: post.id, claimer_user_id: claimerId, status: "open" })
      .select("id")
      .maybeSingle();
    if (claimError || !newClaim) {
      return flashRedirect(req, res, "/found-items", "error", "Couldn't claim that post. Please try again.");
    }

    const claimId = newClaim.id;

    // Auto-create an opening message to kick off the thread
    const { error: messageError } = await supabase.from("found_claim_messages").insert({
      claim_id: claimId,
      sender_user_id: claimerId,
      message: `Hi! I believe "${post.item_name}" is mine. I'd like to arrange a pickup to confirm ownership.`
    });
    if (messageError) {
      await supabase.from("found_claims").delete().eq("id", claimId);
      return flashRedirect(req, res, "/found-items", "error", "Claim started but the conversation couldn't be created. Please try again.");
    }

    // Email the finder (post owner) that someone claimed their found item
    try {
      const { data: claimer } = await supabase.from("users").select("full_name, email").eq("id", claimerId).single();
      if (post.finder_email) {
        await sendEmail(post.finder_email, `Your found item post was claimed — ${post.item_name}`,
          `<h2 style="margin:0 0 16px;font-size:1.2rem;">&#128197; Item Claimed</h2>
           <p>Hi <strong>${post.finder_name || 'there'}</strong>,</p>
           <p><strong>${claimer?.full_name || 'Someone'}</strong> (${claimer?.email || 'unknown email'}) claimed your found item post for <strong>${post.item_name}</strong>.</p>
           <p>You can chat with them inside PUTrace to confirm ownership and arrange pickup.</p>
           <p style="margin-top:20px;">
             <a href="${BASE_URL}/found-claims/${claimId}" style="display:inline-block;background:#3a56e4;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">Open Conversation</a>
           </p>`
        );
      }
    } catch (emailErr) {
      console.error("Claim notification email failed:", emailErr);
    }

    setFlash(req, "success", `You claimed "${post.item_name}"! Chat with the finder below to confirm ownership and arrange pickup.`);
    return res.redirect(`/found-claims/${claimId}`);
  } catch (err) {
    console.error("Claim error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/found-items");
  }
});

// ── Found Claim Threads ──

app.get("/found-claims/post/:postId", requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const { data: post } = await supabase.from("found_posts").select("*").eq("id", postId).maybeSingle();
    if (!post) return res.status(404).render("not_found");
    if (post.finder_user_id !== req.session.userId) return res.status(403).send("Forbidden");

    const { data: claims } = await supabase
      .from("found_claims")
      .select("id, claimer_user_id, status, created_at")
      .eq("found_post_id", postId)
      .order("created_at", { ascending: false });

    const claimerIds = [...new Set((claims || []).map((c) => c.claimer_user_id).filter(Boolean))];
    let usersById = {};
    if (claimerIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name, email").in("id", claimerIds);
      usersById = Object.fromEntries((users || []).map((u) => [u.id, u]));
    }

    res.render("found_claims_list", {
      post,
      claims: (claims || []).map((c) => ({
        ...c,
        claimer_name: usersById[c.claimer_user_id]?.full_name || "Claimer",
        claimer_email: usersById[c.claimer_user_id]?.email || ""
      }))
    });
  } catch (err) {
    console.error("Found claims list error:", err);
    return flashRedirect(req, res, "/found-items", "error", "Failed to load claims.");
  }
});

app.get("/found-claims/:claimId", requireAuth, async (req, res) => {
  try {
    const claimId = Number(req.params.claimId);
    const { data: claim } = await supabase
      .from("found_claims")
      .select("id, found_post_id, claimer_user_id, status, created_at")
      .eq("id", claimId)
      .maybeSingle();
    if (!claim) return res.status(404).render("not_found");

    const { data: post } = await supabase.from("found_posts").select("*").eq("id", claim.found_post_id).maybeSingle();
    if (!post) return res.status(404).render("not_found");

    const userId = req.session.userId;
    if (post.finder_user_id !== userId && claim.claimer_user_id !== userId) return res.status(403).send("Forbidden");

    const { data: rows } = await supabase
      .from("found_claim_messages")
      .select("id, claim_id, sender_user_id, message, created_at")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: true });
    const messages = rows || [];

    const senderIds = [...new Set(messages.map((m) => m.sender_user_id).filter(Boolean))];
    let senderMap = {};
    if (senderIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", senderIds);
      senderMap = Object.fromEntries((users || []).map((u) => [u.id, u.full_name]));
    }

    const isClaimer = claim.claimer_user_id === userId;
    let counterpartName = isClaimer ? post.finder_name : "Claimer";
    const otherUserId = isClaimer ? post.finder_user_id : claim.claimer_user_id;
    if (otherUserId) {
      const { data: other } = await supabase.from("users").select("full_name").eq("id", otherUserId).maybeSingle();
      if (other?.full_name) counterpartName = other.full_name;
    }

    req.session.lastReadFoundClaims = { ...(req.session.lastReadFoundClaims || {}), [String(claimId)]: new Date().toISOString() };
    res.render("found_claim_thread", {
      post,
      claim,
      messages: messages.map((m) => serializeChatMessage({ ...m, sender_name: senderMap[m.sender_user_id] || "User" }, userId)),
      counterpartName,
      isFinder: post.finder_user_id === userId
    });
  } catch (err) {
    console.error("Found claim thread error:", err);
    return flashRedirect(req, res, "/messages", "error", "Failed to load conversation.");
  }
});

app.get("/found-claims/:claimId/poll", requireAuth, async (req, res) => {
  try {
    const claimId = Number(req.params.claimId);
    const { data: claim } = await supabase
      .from("found_claims")
      .select("id, found_post_id, claimer_user_id, status")
      .eq("id", claimId)
      .maybeSingle();
    if (!claim) return res.status(404).json({ error: "not_found" });

    const { data: post } = await supabase.from("found_posts").select("id, status, finder_user_id").eq("id", claim.found_post_id).maybeSingle();
    if (!post) return res.status(404).json({ error: "not_found" });

    const userId = req.session.userId;
    if (post.finder_user_id !== userId && claim.claimer_user_id !== userId) return res.status(403).json({ error: "forbidden" });

    const { data: rows } = await supabase
      .from("found_claim_messages")
      .select("id, sender_user_id, message, created_at")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: true });
    const messages = rows || [];

    const senderIds = [...new Set(messages.map((m) => m.sender_user_id).filter(Boolean))];
    let senderMap = {};
    if (senderIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", senderIds);
      senderMap = Object.fromEntries((users || []).map((u) => [u.id, u.full_name]));
    }

    req.session.lastReadFoundClaims = { ...(req.session.lastReadFoundClaims || {}), [String(claimId)]: new Date().toISOString() };
    return res.json({
      status: post.status === "returned" ? "returned" : claim.status,
      messages: messages.map((m) => serializeChatMessage({ ...m, sender_name: senderMap[m.sender_user_id] || "User" }, userId))
    });
  } catch (err) {
    console.error("Found claim poll error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/found-claims/:claimId/reject", requireAuth, async (req, res) => {
  try {
    const claimId = Number(req.params.claimId);
    const { data: claim } = await supabase
      .from("found_claims")
      .select("id, found_post_id, status, claimer_user_id")
      .eq("id", claimId)
      .maybeSingle();
    if (!claim) return res.status(404).render("not_found");

    const { data: post } = await supabase.from("found_posts").select("id, finder_user_id, status").eq("id", claim.found_post_id).maybeSingle();
    if (!post) return res.status(404).render("not_found");
    if (post.finder_user_id !== req.session.userId) return res.status(403).send("Forbidden");
    if (post.status === "returned") return flashRedirect(req, res, `/found-claims/${claimId}`, "error", "This item has already been returned.");
    if (claim.status !== "open") return flashRedirect(req, res, `/found-claims/${claimId}`, "error", "This claim is already closed.");

    await supabase.from("found_claims").update({ status: "rejected" }).eq("id", claimId);
    return flashRedirect(req, res, `/found-claims/post/${post.id}`, "success", "Claim rejected.");
  } catch (err) {
    console.error("Reject claim error:", err);
    return flashRedirect(req, res, `/found-claims/${req.params.claimId}`, "error", "Something went wrong.");
  }
});

app.post("/found-claims/:claimId/resolve", requireAuth, async (req, res) => {
  try {
    const claimId = Number(req.params.claimId);
    const { data: claim } = await supabase
      .from("found_claims")
      .select("id, found_post_id, status")
      .eq("id", claimId)
      .maybeSingle();
    if (!claim) return res.status(404).render("not_found");

    const { data: post } = await supabase.from("found_posts").select("id, finder_user_id, status").eq("id", claim.found_post_id).maybeSingle();
    if (!post) return res.status(404).render("not_found");
    if (post.finder_user_id !== req.session.userId) return res.status(403).send("Forbidden");
    if (post.status === "returned") return flashRedirect(req, res, `/found-claims/${claimId}`, "error", "This item has already been returned.");

    await supabase.from("found_claims").update({ status: "returned" }).eq("id", claimId);
    return flashRedirect(req, res, "/messages", "success", "Great! Marked as returned — glad the item made it back!");
  } catch (err) {
    console.error("Resolve claim error:", err);
    return flashRedirect(req, res, `/found-claims/${req.params.claimId}`, "error", "Something went wrong.");
  }
});

app.post("/found-claims/:claimId", requireAuth, async (req, res) => {
  try {
    const claimId = Number(req.params.claimId);
    const { data: claim } = await supabase
      .from("found_claims")
      .select("id, found_post_id, claimer_user_id, status")
      .eq("id", claimId)
      .maybeSingle();
    if (!claim) return res.status(404).render("not_found");

    const { data: post } = await supabase.from("found_posts").select("id, status, finder_user_id").eq("id", claim.found_post_id).maybeSingle();
    if (!post) return res.status(404).render("not_found");

    const userId = req.session.userId;
    if (post.finder_user_id !== userId && claim.claimer_user_id !== userId) return res.status(403).send("Forbidden");
    if (post.status === "returned" || claim.status !== "open") {
      return flashRedirect(req, res, `/found-claims/${claimId}`, "error", "This conversation is closed.");
    }

    const text = sanitize(req.body.message || "");
    if (!text) return flashRedirect(req, res, `/found-claims/${claimId}`, "error", "Message cannot be empty.");
    if (text.length > 1000) return flashRedirect(req, res, `/found-claims/${claimId}`, "error", "Message too long (max 1000 chars).");

    await supabase.from("found_claim_messages").insert({ claim_id: claimId, sender_user_id: userId, message: text });
    return res.redirect(`/found-claims/${claimId}`);
  } catch (err) {
    console.error("Found claim send error:", err);
    return flashRedirect(req, res, `/found-claims/${req.params.claimId}`, "error", "Something went wrong.");
  }
});

// Legacy claim thread URL: redirect to claim list/thread
app.get("/found-messages/:postId", requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const { data: post } = await supabase.from("found_posts").select("id, finder_user_id").eq("id", postId).maybeSingle();
    if (!post) return res.status(404).render("not_found");

    const userId = req.session.userId;
    if (post.finder_user_id === userId) {
      return res.redirect(`/found-claims/post/${postId}`);
    }

    const { data: claim } = await supabase
      .from("found_claims")
      .select("id")
      .eq("found_post_id", postId)
      .eq("claimer_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (claim) return res.redirect(`/found-claims/${claim.id}`);

    return res.redirect("/found-items");
  } catch (err) {
    console.error("Legacy found thread redirect error:", err);
    return res.redirect("/found-items");
  }
});

// ── Messages (owner <-> finder chat per report) ──

app.get("/messages", requireAuth, async (req, res) => {
  try {
    const currentEmail = String(res.locals.currentUser?.email || "").toLowerCase();

    const { data: ownerItems } = await supabase.from("items").select("id, item_name, user_id").eq("user_id", req.session.userId);
    const ownerItemIds = (ownerItems || []).map((i) => i.id);
    const ownerItemIdSet = new Set(ownerItemIds);

    let ownerReports = [];
    if (ownerItemIds.length > 0) {
      const { data } = await supabase
        .from("finder_reports")
        .select("id, item_id, finder_name, finder_email, message, status, created_at")
        .in("item_id", ownerItemIds)
        .order("created_at", { ascending: false });
      ownerReports = data || [];
    }

    const { data: finderReportsData } = await supabase
      .from("finder_reports")
      .select("id, item_id, finder_name, finder_email, message, status, created_at")
      .eq("finder_email", currentEmail)
      .order("created_at", { ascending: false });
    const finderReports = finderReportsData || [];

    const mergedMap = new Map();
    for (const r of [...ownerReports, ...finderReports]) {
      if (!mergedMap.has(r.id)) mergedMap.set(r.id, r);
    }
    const reports = [...mergedMap.values()];

    // Fetch latest chat message per report to use as conversation preview
    const reportIds = reports.map((r) => r.id);
    let latestMsgMap = {};
    if (reportIds.length > 0) {
      const { data: latestMsgs } = await supabase
        .from("report_messages")
        .select("report_id, message, created_at")
        .in("report_id", reportIds)
        .order("created_at", { ascending: false });
      for (const m of latestMsgs || []) {
        if (!latestMsgMap[m.report_id]) latestMsgMap[m.report_id] = m;
      }
    }

    const allItemIds = [...new Set(reports.map((r) => r.item_id))];
    let itemsById = {};
    if (allItemIds.length > 0) {
      const { data: items } = await supabase.from("items").select("id, item_name, user_id, image_url").in("id", allItemIds);
      itemsById = Object.fromEntries((items || []).map((i) => [i.id, i]));
    }

    const ownerUserIds = [...new Set(Object.values(itemsById).map((i) => i.user_id))];
    let usersById = {};
    if (ownerUserIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", ownerUserIds);
      usersById = Object.fromEntries((users || []).map((u) => [u.id, u]));
    }

    const conversations = reports
      .map((r) => {
        const item = itemsById[r.item_id];
        if (!item) return null;

        const role = ownerItemIdSet.has(r.item_id) ? "owner" : "finder";
        const counterpartName = role === "owner"
          ? (r.finder_name || r.finder_email || "Finder")
          : (usersById[item.user_id]?.full_name || "Owner");

        return {
          id: r.id,
          url: `/messages/${r.id}`,
          item_name: item.item_name,
          image_url: item.image_url,
          preview: latestMsgMap[r.id]?.message || r.message,
          status: r.status,
          kind: 'report',
          role,
          counterpart_name: counterpartName,
          created_at: latestMsgMap[r.id]?.created_at || r.created_at
        };
      })
      .filter(Boolean);

    const { data: finderPosts } = await supabase
      .from("found_posts")
      .select("id, item_name, finder_user_id, finder_name")
      .eq("finder_user_id", req.session.userId);
    const finderPostIds = (finderPosts || []).map((p) => p.id);

    let claimRows = [];
    if (finderPostIds.length > 0) {
      const { data } = await supabase
        .from("found_claims")
        .select("id, found_post_id, claimer_user_id, status, created_at")
        .or(`claimer_user_id.eq.${req.session.userId},found_post_id.in.(${finderPostIds.join(",")})`)
        .neq("status", "rejected");
      claimRows = data || [];
    } else {
      const { data } = await supabase
        .from("found_claims")
        .select("id, found_post_id, claimer_user_id, status, created_at")
        .eq("claimer_user_id", req.session.userId)
        .neq("status", "rejected");
      claimRows = data || [];
    }

    const claimPostIds = [...new Set(claimRows.map((c) => c.found_post_id))];
    let postsById = {};
    if (claimPostIds.length > 0) {
      const { data: posts } = await supabase
        .from("found_posts")
        .select("id, item_name, finder_user_id, finder_name, status, created_at, image_url")
        .in("id", claimPostIds);
      postsById = Object.fromEntries((posts || []).map((p) => [p.id, p]));
    }

    const claimerIds = [...new Set(claimRows.map((c) => c.claimer_user_id).filter(Boolean))];
    let claimersById = {};
    if (claimerIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", claimerIds);
      claimersById = Object.fromEntries((users || []).map((u) => [u.id, u.full_name]));
    }

    const foundConvos = await Promise.all((claimRows || []).map(async (c) => {
      const post = postsById[c.found_post_id];
      if (!post) return null;

      const { data: lastMsg } = await supabase
        .from("found_claim_messages")
        .select("message, created_at")
        .eq("claim_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const isClaimer = c.claimer_user_id === req.session.userId;
      const counterpartName = isClaimer
        ? (post.finder_name || "Finder")
        : (claimersById[c.claimer_user_id] || "Claimer");

      return {
        id: c.id,
        url: `/found-claims/${c.id}`,
        item_name: post.item_name,
        image_url: post.image_url,
        preview: lastMsg?.message || "Claim initiated",
        status: post.status === "returned" ? "returned" : c.status,
        kind: 'found',
        role: isClaimer ? "claimer" : "finder",
        counterpart_name: counterpartName,
        created_at: lastMsg?.created_at || c.created_at
      };
    }));

    const allConversations = [...conversations, ...(foundConvos || []).filter(Boolean)]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.render("messages", { conversations: allConversations });
  } catch (err) {
    console.error("Messages list error:", err);
    return flashRedirect(req, res, "/dashboard", "error", "Failed to load messages.");
  }
});

app.get("/messages/:reportId", requireAuth, async (req, res) => {
  try {
    const ctx = await getAccessibleReportContext(req, res, req.params.reportId);
    if (ctx.error === "not_found") return res.status(404).render("not_found");
    if (ctx.error === "forbidden") return res.status(403).send("Forbidden");

    const { report, item, owner, currentUser, isOwner } = ctx;

    const { data: rows } = await supabase
      .from("report_messages")
      .select("id, report_id, sender_user_id, message, created_at")
      .eq("report_id", report.id)
      .order("created_at", { ascending: true });
    const messages = rows || [];

    const senderIds = [...new Set(messages.map((m) => m.sender_user_id).filter(Boolean))];
    let senderMap = {};
    if (senderIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", senderIds);
      senderMap = Object.fromEntries((users || []).map((u) => [u.id, u.full_name]));
    }

    const counterpartName = isOwner ? (report.finder_name || report.finder_email || "Finder") : owner.full_name;

    req.session.lastReadReports = { ...(req.session.lastReadReports || {}), [String(report.id)]: new Date().toISOString() };
    res.render("message_thread", {
      report,
      item,
      messages: messages.map((m) => serializeChatMessage({ ...m, sender_name: senderMap[m.sender_user_id] || "User" }, currentUser.id)),
      counterpartName
    });
  } catch (err) {
    console.error("Message thread error:", err);
    return flashRedirect(req, res, "/messages", "error", "Failed to load conversation.");
  }
});

app.get("/messages/:reportId/poll", requireAuth, async (req, res) => {
  try {
    const ctx = await getAccessibleReportContext(req, res, req.params.reportId);
    if (ctx.error === "not_found") return res.status(404).json({ error: "not_found" });
    if (ctx.error === "forbidden") return res.status(403).json({ error: "forbidden" });

    const { report, currentUser } = ctx;
    const { data: rows } = await supabase
      .from("report_messages")
      .select("id, sender_user_id, message, created_at")
      .eq("report_id", report.id)
      .order("created_at", { ascending: true });
    const messages = rows || [];

    const senderIds = [...new Set(messages.map((m) => m.sender_user_id).filter(Boolean))];
    let senderMap = {};
    if (senderIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", senderIds);
      senderMap = Object.fromEntries((users || []).map((u) => [u.id, u.full_name]));
    }

    req.session.lastReadReports = { ...(req.session.lastReadReports || {}), [String(report.id)]: new Date().toISOString() };
    return res.json({
      status: report.status,
      messages: messages.map((m) => serializeChatMessage({ ...m, sender_name: senderMap[m.sender_user_id] || "User" }, currentUser.id))
    });
  } catch (err) {
    console.error("Message poll error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/messages/:reportId", requireAuth, async (req, res) => {
  try {
    const ctx = await getAccessibleReportContext(req, res, req.params.reportId);
    if (ctx.error === "not_found") return res.status(404).render("not_found");
    if (ctx.error === "forbidden") return res.status(403).send("Forbidden");

    if (ctx.report.status === REPORT_STATUS.RESOLVED) {
      return flashRedirect(req, res, `/messages/${ctx.report.id}`, "error", "This conversation is closed — the report has been resolved.");
    }

    const text = sanitize(req.body.message);
    if (!text) return flashRedirect(req, res, `/messages/${ctx.report.id}`, "error", "Message cannot be empty.");
    if (text.length > 1000) return flashRedirect(req, res, `/messages/${ctx.report.id}`, "error", "Message is too long (max 1000 chars).");

    const { error } = await supabase.from("report_messages").insert({
      report_id: ctx.report.id,
      sender_user_id: req.session.userId,
      message: text
    });
    if (error) return flashRedirect(req, res, `/messages/${ctx.report.id}`, "error", "Failed to send message.");

    return res.redirect(`/messages/${ctx.report.id}`);
  } catch (err) {
    console.error("Send message error:", err);
    return flashRedirect(req, res, `/messages/${req.params.reportId}`, "error", "Something went wrong.");
  }
});

// ── Resolve a finder report ──

app.post("/report/:id/resolve", requireAuth, async (req, res) => {
  try {
    const { data: report } = await supabase.from("finder_reports").select("id, item_id").eq("id", Number(req.params.id)).maybeSingle();
    if (!report) return res.status(404).render("not_found");

    // Make sure the logged-in user owns the item
    const item = await getOwnedItem(req, report.item_id);
    if (!item) return res.status(403).send("Forbidden");

    await supabase.from("finder_reports").update({ status: REPORT_STATUS.RESOLVED }).eq("id", report.id);
    setFlash(req, "success", "Report marked as resolved.");
    return res.redirect("/dashboard");
  } catch (err) {
    console.error("Resolve report error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/dashboard");
  }
});

// ── Account Page ──

app.get("/account", requireAuth, async (req, res) => {
  try {
    if (!res.locals.currentUser) {
      setFlash(req, "error", "Please log in again.");
      return res.redirect("/login");
    }
    // Get user info and item stats for the account page
    const { data: user } = await supabase.from("users").select("created_at").eq("id", req.session.userId).single();
    const { data: items } = await supabase.from("items").select("id").eq("user_id", req.session.userId);
    const itemIds = (items || []).map((i) => i.id);

    let openReports = 0;
    let resolvedReports = 0;
    if (itemIds.length > 0) {
      const { data: reports } = await supabase.from("finder_reports").select("status").in("item_id", itemIds);
      for (const r of reports || []) {
        if (r.status === REPORT_STATUS.OPEN) openReports++;
        else resolvedReports++;
      }
    }

    res.render("account", {
      createdAt: user?.created_at || new Date().toISOString(),
      itemCount: (items || []).length,
      openReports, resolvedReports
    });
  } catch (err) {
    console.error("Account page error:", err);
    setFlash(req, "error", "Failed to load account.");
    return res.redirect("/dashboard");
  }
});

// Update display name
app.post("/account", requireAuth, async (req, res) => {
  try {
    const full_name = sanitize(req.body.full_name);
    if (full_name.length < 2) { setFlash(req, "error", "Name is too short."); return res.redirect("/account"); }

    const { error } = await supabase.from("users").update({ full_name }).eq("id", req.session.userId);
    setFlash(req, error ? "error" : "success", error ? "Update failed." : "Profile updated.");
    return res.redirect("/account");
  } catch (err) {
    console.error("Update name error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/account");
  }
});

// Change password
app.post("/account/password", requireAuth, async (req, res) => {
  try {
    const { current_password, new_password, confirm_new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      setFlash(req, "error", "New password must be at least 8 characters.");
      return res.redirect("/account");
    }
    if (new_password !== (confirm_new_password || "")) {
      setFlash(req, "error", "New passwords do not match.");
      return res.redirect("/account");
    }

    const { data: user } = await supabase.from("users").select("password_hash").eq("id", req.session.userId).single();
    const ok = await bcrypt.compare(current_password || "", user.password_hash);
    if (!ok) { setFlash(req, "error", "Current password is incorrect."); return res.redirect("/account"); }

    const hash = await bcrypt.hash(new_password, 10);
    await supabase.from("users").update({ password_hash: hash }).eq("id", req.session.userId);
    setFlash(req, "success", "Password updated.");
    return res.redirect("/account");
  } catch (err) {
    console.error("Password change error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/account");
  }
});

app.post("/account/password/reset-link", requireAuth, async (req, res) => {
  try {
    const email = String(res.locals.currentUser?.email || "").toLowerCase();
    if (!email) return flashRedirect(req, res, "/account", "error", "Unable to find your account email.");

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await supabase.from("password_reset_tokens").insert({
      user_id: req.session.userId,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

    await sendPasswordResetEmail(email, buildResetLink(rawToken));
    return flashRedirect(req, res, "/account", "success", "Password reset link sent to your email. Check spam/junk if you don’t see it.");
  } catch (err) {
    console.error("Account reset link error:", err);
    return flashRedirect(req, res, "/account", "error", "Something went wrong.");
  }
});

// ── Change Item Status (active / lost / recovered) ──

async function handleItemStatusChange(req, res, itemStatusInput) {
  const item = await getOwnedItem(req, req.params.id, "id, user_id, item_name, item_status");
  if (!item) { setFlash(req, "error", "Item not found."); return res.redirect("/dashboard"); }

  const fallbackNextStatus = item.item_status === ITEM_STATUS.ACTIVE
    ? ITEM_STATUS.LOST
    : item.item_status === ITEM_STATUS.LOST
      ? ITEM_STATUS.RECOVERED
      : ITEM_STATUS.ACTIVE;
  const item_status = itemStatusInput || fallbackNextStatus;
  if (!ITEM_STATUS_VALUES.includes(item_status)) { setFlash(req, "error", "Invalid status."); return res.redirect("/dashboard"); }

  await supabase.from("items").update({ item_status }).eq("id", item.id);
  const statusMessages = {
    lost: `"${item.item_name}" is now listed on the Lost Board. Others can spot it and let you know!`,
    recovered: `Great news! "${item.item_name}" is marked as recovered.`,
    active: `"${item.item_name}" is back to active.`
  };
  setFlash(req, "success", statusMessages[item_status] || `Status updated.`);
  return res.redirect("/dashboard");
}

app.post("/item/:id/status", requireAuth, async (req, res) => {
  return handleItemStatusChange(req, res, req.body.item_status);
});

app.get("/item/:id/status", requireAuth, async (req, res) => {
  return handleItemStatusChange(req, res, sanitize(req.query.item_status || ""));
});

// ── Delete Found Post ──

app.post("/found-items/:id/delete", requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const { data: post } = await supabase.from("found_posts").select("id, finder_user_id, status, item_name, image_url").eq("id", postId).maybeSingle();
    if (!post || post.finder_user_id !== req.session.userId) {
      setFlash(req, "error", "Post not found.");
      return res.redirect("/found-items");
    }
    const { data: openClaims } = await supabase
      .from("found_claims")
      .select("id")
      .eq("found_post_id", postId)
      .eq("status", "open");
    if (openClaims && openClaims.length > 0) {
      setFlash(req, "error", `Cannot delete \"${post.item_name}\" — it has active claims. Resolve or reject them first.`);
      return res.redirect("/found-items");
    }
    if (post.image_url) {
      const fileName = post.image_url.split("/").pop().split("?")[0];
      await supabase.storage.from("item-images").remove([fileName]);
    }
    await supabase.from("found_posts").delete().eq("id", postId);
    setFlash(req, "success", "Found post removed.");
    return res.redirect("/found-items");
  } catch (err) {
    console.error("Delete found post error:", err);
    return flashRedirect(req, res, "/found-items", "error", "Something went wrong.");
  }
});

// ── Delete Item ──

app.post("/item/:id/delete", requireAuth, async (req, res) => {
  const item = await getOwnedItem(req, req.params.id, "id, user_id, item_name, image_url");
  if (!item) { setFlash(req, "error", "Item not found."); return res.redirect("/dashboard"); }

  // Block deletion if there are open report threads
  const { data: openReports } = await supabase
    .from("finder_reports")
    .select("id")
    .eq("item_id", item.id)
    .eq("status", REPORT_STATUS.OPEN);
  if (openReports && openReports.length > 0) {
    setFlash(req, "error", `Cannot delete "${item.item_name}" — it has ${openReports.length} open report${openReports.length > 1 ? 's' : ''}. Resolve them first.`);
    return res.redirect("/dashboard");
  }

  // Remove item image from storage if one was uploaded
  if (item.image_url) {
    const fileName = item.image_url.split("/").pop().split("?")[0];
    await supabase.storage.from("item-images").remove([fileName]);
  }

  // Cascade on finder_reports and report_messages is handled by the schema
  await supabase.from("items").delete().eq("id", item.id);
  setFlash(req, "success", "Item deleted.");
  return res.redirect("/dashboard");
});

// ── Admin Panel ──

app.get("/admin", requireAdmin, async (req, res) => {
  try {
    const { data: users } = await supabase.from("users").select("id, full_name, email, is_admin, is_banned, created_at").order("created_at", { ascending: false });
    const { data: foundPosts } = await supabase.from("found_posts").select("id, item_name, finder_name, finder_email, status, created_at, found_at, finder_user_id, image_url, item_description, location_found").order("created_at", { ascending: false });
    const { data: lostItems } = await supabase
      .from("items")
      .select("id, item_name, item_description, category, image_url, created_at, user_id")
      .eq("item_status", "lost")
      .order("created_at", { ascending: false });
    const { data: reports } = await supabase.from("finder_reports").select("id, item_id, finder_name, finder_email, message, status, created_at").order("created_at", { ascending: false });

    // Attach item names + images to reports
    const itemIds = [...new Set((reports || []).map(r => r.item_id))];
    let itemMap = {};
    if (itemIds.length > 0) {
      const { data: items } = await supabase.from("items").select("id, item_name, image_url").in("id", itemIds);
      itemMap = Object.fromEntries((items || []).map(i => [i.id, i]));
    }

    const ownerIds = [...new Set((lostItems || []).map((i) => i.user_id).filter(Boolean))];
    let ownersById = {};
    if (ownerIds.length > 0) {
      const { data: owners } = await supabase.from("users").select("id, full_name").in("id", ownerIds);
      ownersById = Object.fromEntries((owners || []).map((u) => [u.id, u.full_name]));
    }

    // Map reporter emails to user IDs so names can link to admin profiles
    const usersByEmail = Object.fromEntries((users || []).map(u => [u.email.toLowerCase(), u.id]));

    res.render("admin", {
      users: users || [],
      foundPosts: foundPosts || [],
      lostItems: (lostItems || []).map((i) => ({ ...i, owner_name: ownersById[i.user_id] || "Unknown" })),
      reports: (reports || []).map(r => ({ ...r, item_name: itemMap[r.item_id]?.item_name || "Unknown", item_image: itemMap[r.item_id]?.image_url || null, reporter_user_id: usersByEmail[(r.finder_email || "").toLowerCase()] || null }))
    });
  } catch (err) {
    console.error("Admin panel error:", err);
    return flashRedirect(req, res, "/dashboard", "error", "Failed to load admin panel.");
  }
});

app.get("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { data: user } = await supabase.from("users").select("id, full_name, username, email, is_admin, is_banned, created_at").eq("id", userId).maybeSingle();
    if (!user) return flashRedirect(req, res, "/admin", "error", "User not found.");

    const { data: items } = await supabase.from("items").select("id, item_name, item_status, category, image_url, created_at").eq("user_id", userId).order("created_at", { ascending: false });
    const { data: foundPosts } = await supabase.from("found_posts").select("id, item_name, status, image_url, location_found, created_at, found_at").eq("finder_user_id", userId).order("created_at", { ascending: false });
    const { data: reports } = await supabase.from("finder_reports").select("id, item_id, message, status, created_at").eq("finder_email", user.email).order("created_at", { ascending: false });

    const itemIds = [...new Set((reports || []).map(r => r.item_id))];
    let itemMap = {};
    if (itemIds.length > 0) {
      const { data: its } = await supabase.from("items").select("id, item_name, image_url").in("id", itemIds);
      itemMap = Object.fromEntries((its || []).map(i => [i.id, i]));
    }

    res.render("admin_user", {
      user,
      items: items || [],
      foundPosts: foundPosts || [],
      reports: (reports || []).map(r => ({ ...r, item_name: itemMap[r.item_id]?.item_name || "Unknown", item_image: itemMap[r.item_id]?.image_url || null }))
    });
  } catch (err) {
    console.error("Admin user detail error:", err);
    return flashRedirect(req, res, "/admin", "error", "Failed to load user details.");
  }
});

app.post("/admin/users/:id/ban", requireAdmin, async (req, res) => {
  const targetId = String(req.params.id || "");
  if (targetId === req.session.userId) return flashRedirect(req, res, "/admin", "error", "You can't ban yourself.");
  const { data: target } = await supabase.from("users").select("is_admin").eq("id", targetId).maybeSingle();
  if (target?.is_admin) return flashRedirect(req, res, "/admin", "error", "Cannot ban another admin.");
  await supabase.from("users").update({ is_banned: true }).eq("id", targetId);
  return flashRedirect(req, res, "/admin", "success", "User banned.");
});

app.post("/admin/users/:id/unban", requireAdmin, async (req, res) => {
  await supabase.from("users").update({ is_banned: false }).eq("id", String(req.params.id || ""));
  return flashRedirect(req, res, "/admin", "success", "User unbanned.");
});

app.post("/admin/posts/:id/delete", requireAdmin, async (req, res) => {
  const { data: post } = await supabase.from("found_posts").select("id, image_url").eq("id", Number(req.params.id)).maybeSingle();
  if (!post) return flashRedirect(req, res, "/admin", "error", "Post not found.");
  if (post.image_url) {
    const fileName = post.image_url.split("/").pop().split("?")[0];
    await supabase.storage.from("item-images").remove([fileName]);
  }
  await supabase.from("found_posts").delete().eq("id", post.id);
  return flashRedirect(req, res, "/admin", "success", "Found post deleted.");
});

app.post("/admin/reports/:id/delete", requireAdmin, async (req, res) => {
  await supabase.from("finder_reports").delete().eq("id", Number(req.params.id));
  return flashRedirect(req, res, "/admin", "success", "Report deleted.");
});

// Admin: Delete lost board item
app.post("/admin/items/:id/delete", requireAdmin, async (req, res) => {
  const { data: item } = await supabase.from("items").select("id, item_name, image_url").eq("id", req.params.id).maybeSingle();
  if (!item) return flashRedirect(req, res, "/admin", "error", "Item not found.");
  if (item.image_url) {
    const fileName = item.image_url.split("/").pop().split("?")[0];
    await supabase.storage.from("item-images").remove([fileName]);
  }
  await supabase.from("items").delete().eq("id", item.id);
  return flashRedirect(req, res, "/admin", "success", "Lost item deleted.");
});

// ── Admin: View sighting report thread ──
app.get("/admin/threads/report/:id", requireAdmin, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const { data: report } = await supabase.from("finder_reports").select("*").eq("id", reportId).maybeSingle();
    if (!report) return res.status(404).render("not_found");

    const [{ data: item }, { data: rows }] = await Promise.all([
      supabase.from("items").select("id, item_name, image_url").eq("id", report.item_id).maybeSingle(),
      supabase.from("report_messages").select("id, sender_user_id, message, created_at").eq("report_id", reportId).order("created_at", { ascending: true })
    ]);

    const messages = rows || [];
    const senderIds = [...new Set(messages.map(m => m.sender_user_id).filter(Boolean))];
    let senderMap = {};
    if (senderIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", senderIds);
      senderMap = Object.fromEntries((users || []).map(u => [u.id, u.full_name]));
    }

    const threadMessages = [
      {
        id: null,
        sender_name: report.finder_name || report.finder_email || "Finder",
        message: report.message,
        created_at: report.created_at,
        can_delete: false
      },
      ...messages.map((m) => ({
        ...m,
        sender_name: senderMap[m.sender_user_id] || "User",
        can_delete: true
      }))
    ];

    res.render("admin_thread", {
      threadType: "report",
      title: item?.item_name || "Unknown Item",
      subtitle: `Sighting report by ${report.finder_name || report.finder_email || "Unknown"}`,
      image: item?.image_url || null,
      backUrl: "/admin",
      messages: threadMessages
    });
  } catch (err) {
    console.error("Admin thread (report) error:", err);
    return flashRedirect(req, res, "/admin", "error", "Failed to load thread.");
  }
});

// ── Admin: View found post claims list ──
app.get("/admin/threads/post/:id", requireAdmin, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const { data: post } = await supabase.from("found_posts").select("*").eq("id", postId).maybeSingle();
    if (!post) return res.status(404).render("not_found");

    const { data: claims } = await supabase
      .from("found_claims")
      .select("id, claimer_user_id, status, created_at")
      .eq("found_post_id", postId)
      .order("created_at", { ascending: false });

    const claimerIds = [...new Set((claims || []).map((c) => c.claimer_user_id).filter(Boolean))];
    let usersById = {};
    if (claimerIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name, email").in("id", claimerIds);
      usersById = Object.fromEntries((users || []).map((u) => [u.id, u]));
    }

    res.render("admin_claims_list", {
      post,
      claims: (claims || []).map((c) => ({
        ...c,
        claimer_name: usersById[c.claimer_user_id]?.full_name || "Claimer",
        claimer_email: usersById[c.claimer_user_id]?.email || ""
      }))
    });
  } catch (err) {
    console.error("Admin thread (post) error:", err);
    return flashRedirect(req, res, "/admin", "error", "Failed to load thread.");
  }
});

// ── Admin: View found claim thread ──
app.get("/admin/threads/claim/:id", requireAdmin, async (req, res) => {
  try {
    const claimId = Number(req.params.id);
    const { data: claim } = await supabase.from("found_claims").select("*").eq("id", claimId).maybeSingle();
    if (!claim) return res.status(404).render("not_found");

    const { data: post } = await supabase.from("found_posts").select("*").eq("id", claim.found_post_id).maybeSingle();
    if (!post) return res.status(404).render("not_found");

    const { data: rows } = await supabase
      .from("found_claim_messages")
      .select("id, sender_user_id, message, created_at")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: true });

    const messages = rows || [];
    const senderIds = [...new Set(messages.map(m => m.sender_user_id).filter(Boolean))];
    let senderMap = {};
    if (senderIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", senderIds);
      senderMap = Object.fromEntries((users || []).map(u => [u.id, u.full_name]));
    }

    res.render("admin_thread", {
      threadType: "claim",
      title: post.item_name || "Unknown Item",
      subtitle: `Claim thread — ${claim.status}`,
      image: post.image_url || null,
      backUrl: `/admin/threads/post/${post.id}`,
      messages: messages.map(m => ({ ...m, sender_name: senderMap[m.sender_user_id] || "User" }))
    });
  } catch (err) {
    console.error("Admin thread (claim) error:", err);
    return flashRedirect(req, res, "/admin", "error", "Failed to load thread.");
  }
});

// ── Admin: Delete individual message ──
app.post("/admin/messages/report/:id/delete", requireAdmin, async (req, res) => {
  const msgId = Number(req.params.id);
  const { data: msg } = await supabase.from("report_messages").select("report_id").eq("id", msgId).maybeSingle();
  await supabase.from("report_messages").delete().eq("id", msgId);
  const back = msg ? `/admin/threads/report/${msg.report_id}` : "/admin";
  return flashRedirect(req, res, back, "success", "Message deleted.");
});

app.post("/admin/messages/claim/:id/delete", requireAdmin, async (req, res) => {
  const msgId = Number(req.params.id);
  const { data: msg } = await supabase.from("found_claim_messages").select("claim_id").eq("id", msgId).maybeSingle();
  await supabase.from("found_claim_messages").delete().eq("id", msgId);
  const back = msg ? `/admin/threads/claim/${msg.claim_id}` : "/admin";
  return flashRedirect(req, res, back, "success", "Message deleted.");
});

// ── Download QR Code as PNG ──

app.get("/download/:token", requireAuth, async (req, res) => {
  const { data: item } = await supabase.from("items").select("*").eq("token", req.params.token).eq("user_id", req.session.userId).maybeSingle();
  if (!item) return res.status(404).render("not_found");

  const qrUrl = `${BASE_URL}/found/${item.token}`;
  const imgBuffer = await QRCode.toBuffer(qrUrl, {
    width: 800,
    margin: 1
  });
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(item.item_name)}-qr.png"`);
  res.send(imgBuffer);
});

// ── Start the server ──

app.listen(PORT, () => {
  console.log(`PUTrace running on port ${PORT}`);
});
