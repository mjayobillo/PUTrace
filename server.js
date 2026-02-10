const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const supabase = createClient(process.env.SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "static")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
  })
);

app.use(async (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  if (req.session.userId) {
    const { data } = await supabase
      .from("users")
      .select("id, full_name, email")
      .eq("id", req.session.userId)
      .single();

    res.locals.currentUser = data || null;
  }
  next();
});

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    setFlash(req, "error", "Please login first.");
    return res.redirect("/login");
  }
  next();
}

app.get("/", (req, res) => {
  res.render("home");
});

app.get("/signup", (req, res) => res.render("signup"));

app.post("/signup", async (req, res) => {
  const { full_name, email, password, contact_phone } = req.body;

  if (!full_name || !email || !password || password.length < 8) {
    setFlash(req, "error", "Provide full name, email, and password (8+ chars).");
    return res.redirect("/signup");
  }

  const { data: exists } = await supabase.from("users").select("id").eq("email", email.toLowerCase()).maybeSingle();
  if (exists) {
    setFlash(req, "error", "Email already registered.");
    return res.redirect("/signup");
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { error } = await supabase.from("users").insert({
    full_name,
    email: email.toLowerCase(),
    password_hash,
    contact_phone: contact_phone || null
  });

  if (error) {
    setFlash(req, "error", `Signup failed: ${error.message}`);
    return res.redirect("/signup");
  }

  setFlash(req, "success", "Account created. Please login.");
  return res.redirect("/login");
});

app.get("/login", (req, res) => res.render("login"));

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const { data: user } = await supabase.from("users").select("*").eq("email", (email || "").toLowerCase()).maybeSingle();

  if (!user) {
    setFlash(req, "error", "Invalid email or password.");
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok) {
    setFlash(req, "error", "Invalid email or password.");
    return res.redirect("/login");
  }

  req.session.userId = user.id;
  setFlash(req, "success", "Welcome back!");
  return res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/dashboard", requireAuth, async (req, res) => {
  const { data: items } = await supabase.from("items").select("*").eq("user_id", req.session.userId).order("created_at", { ascending: false });

  const itemIds = (items || []).map((i) => i.id);
  let reports = [];
  if (itemIds.length > 0) {
    const { data } = await supabase
      .from("finder_reports")
      .select("id, item_id, finder_name, finder_email, location_hint, message, status, created_at")
      .in("item_id", itemIds)
      .order("created_at", { ascending: false });
    reports = data || [];
  }

  const itemNameMap = Object.fromEntries((items || []).map((i) => [i.id, i.item_name]));
  const openCounts = {};
  for (const report of reports) {
    if (report.status === "open") {
      openCounts[report.item_id] = (openCounts[report.item_id] || 0) + 1;
    }
  }

  const viewItems = (items || []).map((i) => ({ ...i, open_reports: openCounts[i.id] || 0 }));
  const viewReports = reports.map((r) => ({ ...r, item_name: itemNameMap[r.item_id] || "Unknown item" }));

  res.render("dashboard", { items: viewItems, reports: viewReports, baseUrl: BASE_URL });
});

app.post("/dashboard", requireAuth, async (req, res) => {
  const { item_name, item_description } = req.body;

  if (!item_name) {
    setFlash(req, "error", "Item name is required.");
    return res.redirect("/dashboard");
  }

  const token = cryptoRandomToken();
  const qrUrl = `${BASE_URL}/found/${token}`;
  const qr_data_url = await QRCode.toDataURL(qrUrl);

  const { error } = await supabase.from("items").insert({
    user_id: req.session.userId,
    item_name,
    item_description: item_description || null,
    token,
    qr_data_url
  });

  if (error) {
    setFlash(req, "error", `Failed to register item: ${error.message}`);
    return res.redirect("/dashboard");
  }

  setFlash(req, "success", "Item registered and QR generated.");
  return res.redirect("/dashboard");
});

app.get("/found/:token", async (req, res) => {
  const { data: item } = await supabase.from("items").select("*").eq("token", req.params.token).maybeSingle();

  if (!item) return res.status(404).render("not_found");

  const { data: owner } = await supabase.from("users").select("full_name, email, contact_phone").eq("id", item.user_id).single();

  return res.render("found", { item, owner });
});

app.post("/found/:token", async (req, res) => {
  const { finder_name, finder_email, location_hint, message } = req.body;

  const { data: item } = await supabase.from("items").select("id").eq("token", req.params.token).maybeSingle();
  if (!item) return res.status(404).render("not_found");

  if (!finder_name || !finder_email || !message) {
    setFlash(req, "error", "Name, email, and message are required.");
    return res.redirect(`/found/${req.params.token}`);
  }

  const { error } = await supabase.from("finder_reports").insert({
    item_id: item.id,
    finder_name,
    finder_email,
    location_hint: location_hint || null,
    message,
    status: "open"
  });

  if (error) {
    setFlash(req, "error", `Failed to submit report: ${error.message}`);
    return res.redirect(`/found/${req.params.token}`);
  }

  setFlash(req, "success", "Report submitted to owner.");
  return res.redirect(`/found/${req.params.token}`);
});

app.post("/report/:id/resolve", requireAuth, async (req, res) => {
  const reportId = Number(req.params.id);
  const { data: report } = await supabase.from("finder_reports").select("id, item_id").eq("id", reportId).maybeSingle();

  if (!report) return res.status(404).render("not_found");

  const { data: item } = await supabase.from("items").select("id, user_id").eq("id", report.item_id).single();
  if (!item || item.user_id !== req.session.userId) return res.status(403).send("Forbidden");

  await supabase.from("finder_reports").update({ status: "resolved" }).eq("id", reportId);
  setFlash(req, "success", "Report marked as resolved.");
  return res.redirect("/dashboard");
});

app.get("/download/:token", requireAuth, async (req, res) => {
  const { data: item } = await supabase.from("items").select("*").eq("token", req.params.token).eq("user_id", req.session.userId).maybeSingle();

  if (!item) return res.status(404).render("not_found");

  const dataUrl = item.qr_data_url || "";
  const base64 = dataUrl.split(",")[1];
  if (!base64) return res.status(500).send("QR unavailable");

  const imgBuffer = Buffer.from(base64, "base64");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename=\"${safeFile(item.item_name)}-qr.png\"`);
  res.send(imgBuffer);
});

function cryptoRandomToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function safeFile(value) {
  return (value || "item").replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
}

app.listen(PORT, () => {
  console.log(`PUtrace running on port ${PORT}`);
});
