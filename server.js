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

// ── Helper Functions ──

// Remove extra spaces from user input
function sanitize(str) {
  return (str || "").trim();
}

// Check if email format is valid
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Generate a random token for QR codes
function generateToken() {
  return crypto.randomBytes(16).toString("hex");
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

// Show a one-time message (success or error)
function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

// Block access if not logged in
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    setFlash(req, "error", "Please login first.");
    return res.redirect("/login");
  }
  next();
}

// ── Home Page ──

app.get("/", (req, res) => res.render("home"));

// ── Sign Up ──

app.get("/signup", (req, res) => res.render("signup"));

app.post("/signup", async (req, res) => {
  try {
    const full_name = sanitize(req.body.full_name);
    const email = sanitize(req.body.email).toLowerCase();
    const password = req.body.password || "";

    // Validate inputs
    if (full_name.length < 2 || full_name.length > 100) {
      setFlash(req, "error", "Full name must be 2–100 characters.");
      return res.redirect("/signup");
    }
    if (!isValidEmail(email)) {
      setFlash(req, "error", "Please enter a valid email address.");
      return res.redirect("/signup");
    }
    if (password.length < 8) {
      setFlash(req, "error", "Password must be at least 8 characters.");
      return res.redirect("/signup");
    }

    // Check if email already exists
    const { data: exists } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
    if (exists) {
      setFlash(req, "error", "Email already registered.");
      return res.redirect("/signup");
    }

    // Hash password and create account
    const password_hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from("users").insert({ full_name, email, password_hash });

    if (error) {
      setFlash(req, "error", "Signup failed. Please try again.");
      return res.redirect("/signup");
    }

    setFlash(req, "success", "Account created. Please login.");
    return res.redirect("/login");
  } catch (err) {
    console.error("Signup error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/signup");
  }
});

// ── Login / Logout ──

app.get("/login", (req, res) => res.render("login"));

app.post("/login", async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const password = req.body.password || "";

    // Find user by email
    const { data: user } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
    if (!user) {
      setFlash(req, "error", "Invalid email or password.");
      return res.redirect("/login");
    }

    // Check password
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      setFlash(req, "error", "Invalid email or password.");
      return res.redirect("/login");
    }

    // Save user session
    req.session.userId = user.id;
    setFlash(req, "success", "Welcome back!");
    return res.redirect("/dashboard");
  } catch (err) {
    console.error("Login error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/login");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ── Dashboard (view items + register new ones) ──

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
    let filteredItems = items || [];
    if (search) {
      const s = search.toLowerCase();
      filteredItems = filteredItems.filter((i) =>
        i.item_name.toLowerCase().includes(s) ||
        (i.item_description || "").toLowerCase().includes(s) ||
        (i.category || "").toLowerCase().includes(s)
      );
    }

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

    // Count open reports per item
    const itemNameMap = Object.fromEntries(filteredItems.map((i) => [i.id, i.item_name]));
    const openCounts = {};
    for (const r of reports) {
      if (r.status === "open") openCounts[r.item_id] = (openCounts[r.item_id] || 0) + 1;
    }

    res.render("dashboard", {
      items: filteredItems.map((i) => ({ ...i, open_reports: openCounts[i.id] || 0 })),
      reports: reports.map((r) => ({ ...r, item_name: itemNameMap[r.item_id] || "Unknown item" })),
      baseUrl: BASE_URL,
      categories: CATEGORIES,
      search, filterCategory, filterStatus
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    setFlash(req, "error", "Failed to load dashboard.");
    return res.redirect("/");
  }
});

// Register a new item
app.post("/dashboard", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const item_name = sanitize(req.body.item_name);
    const item_description = sanitize(req.body.item_description);
    const category = req.body.category || "Other";

    if (!item_name || item_name.length > 150) {
      setFlash(req, "error", "Item name is required (max 150 characters).");
      return res.redirect("/dashboard");
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
      category: CATEGORIES.includes(category) ? category : "Other",
      item_status: "active",
      image_url, token, qr_data_url
    });

    if (error) {
      setFlash(req, "error", "Failed to register item.");
      return res.redirect("/dashboard");
    }

    setFlash(req, "success", "Item registered and QR generated.");
    return res.redirect("/dashboard");
  } catch (err) {
    console.error("Register item error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/dashboard");
  }
});

// ── Lost Board (public page showing items marked as lost) ──

app.get("/lost", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const filterCategory = req.query.category || "";

    // Get all items marked as "lost"
    let query = supabase
      .from("items")
      .select("id, item_name, item_description, category, image_url, created_at, user_id")
      .eq("item_status", "lost")
      .order("created_at", { ascending: false });
    if (filterCategory) query = query.eq("category", filterCategory);

    const { data: items } = await query;
    let filteredItems = items || [];

    if (search) {
      const s = search.toLowerCase();
      filteredItems = filteredItems.filter((i) =>
        i.item_name.toLowerCase().includes(s) ||
        (i.item_description || "").toLowerCase().includes(s) ||
        (i.category || "").toLowerCase().includes(s)
      );
    }

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
    setFlash(req, "error", "Failed to load lost board.");
    return res.redirect("/");
  }
});

// Submit a sighting report for a lost item
app.post("/lost/:id/sighting", async (req, res) => {
  try {
    const reporter_name = sanitize(req.body.reporter_name);
    const reporter_email = sanitize(req.body.reporter_email);
    const location = sanitize(req.body.location);
    const message = sanitize(req.body.message);

    // Find the lost item
    const { data: item } = await supabase.from("items").select("id, item_name").eq("id", req.params.id).eq("item_status", "lost").maybeSingle();
    if (!item) {
      setFlash(req, "error", "Item not found.");
      return res.redirect("/lost");
    }

    // Validate inputs
    if (reporter_name.length < 2) { setFlash(req, "error", "Name is too short."); return res.redirect("/lost"); }
    if (!isValidEmail(reporter_email)) { setFlash(req, "error", "Invalid email."); return res.redirect("/lost"); }
    if (message.length < 3) { setFlash(req, "error", "Message is too short."); return res.redirect("/lost"); }

    // Save report
    const { error } = await supabase.from("finder_reports").insert({
      item_id: item.id,
      finder_name: reporter_name,
      finder_email: reporter_email,
      location_hint: location || null,
      message: `[Sighting] ${message}`,
      status: "open"
    });

    if (error) {
      setFlash(req, "error", "Failed to submit sighting.");
    } else {
      setFlash(req, "success", `Sighting reported for "${item.item_name}". The owner has been notified!`);
    }
    return res.redirect("/lost");
  } catch (err) {
    console.error("Sighting error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/lost");
  }
});

// ── QR Code Scan Page (shown when someone scans a QR sticker) ──

app.get("/found/:token", async (req, res) => {
  try {
    const { data: item } = await supabase.from("items").select("*").eq("token", req.params.token).maybeSingle();
    if (!item) return res.status(404).render("not_found");

    const { data: owner } = await supabase.from("users").select("full_name, email").eq("id", item.user_id).single();
    return res.render("found_qr", { item, owner });
  } catch (err) {
    console.error("QR page error:", err);
    return res.status(500).send("Something went wrong.");
  }
});

// Handle the finder's report form from the QR page
app.post("/found/:token", async (req, res) => {
  try {
    const finder_name = sanitize(req.body.finder_name);
    const finder_email = sanitize(req.body.finder_email);
    const location_hint = sanitize(req.body.location_hint);
    const message = sanitize(req.body.message);

    const { data: item } = await supabase.from("items").select("id, item_name").eq("token", req.params.token).maybeSingle();
    if (!item) return res.status(404).render("not_found");

    // Basic validation
    if (finder_name.length < 2) { setFlash(req, "error", "Name is too short."); return res.redirect(`/found/${req.params.token}`); }
    if (!isValidEmail(finder_email)) { setFlash(req, "error", "Invalid email."); return res.redirect(`/found/${req.params.token}`); }
    if (message.length < 3) { setFlash(req, "error", "Message is too short."); return res.redirect(`/found/${req.params.token}`); }

    // Save report to database
    const { error } = await supabase.from("finder_reports").insert({
      item_id: item.id,
      finder_name,
      finder_email,
      location_hint: location_hint || null,
      message,
      status: "open"
    });

    if (error) {
      setFlash(req, "error", "Failed to submit report.");
    } else {
      setFlash(req, "success", "Report submitted to owner!");
    }
    return res.redirect(`/found/${req.params.token}`);
  } catch (err) {
    console.error("QR report error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect(`/found/${req.params.token}`);
  }
});

// ── Found Items Board (finders post items they picked up) ──

app.get("/found-items", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const filterCategory = req.query.category || "";

    let query = supabase
      .from("found_posts")
      .select("*")
      .eq("status", "unclaimed")
      .order("created_at", { ascending: false });
    if (filterCategory) query = query.eq("category", filterCategory);

    const { data: posts } = await query;
    let filtered = posts || [];

    // Search filter
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter((p) =>
        p.item_name.toLowerCase().includes(s) ||
        (p.item_description || "").toLowerCase().includes(s) ||
        (p.category || "").toLowerCase().includes(s) ||
        (p.location_found || "").toLowerCase().includes(s)
      );
    }

    res.render("found_items", { posts: filtered, categories: CATEGORIES, search, filterCategory });
  } catch (err) {
    console.error("Found board error:", err);
    setFlash(req, "error", "Failed to load found items.");
    return res.redirect("/");
  }
});

// Post a found item to the board
app.post("/found-items", upload.single("image"), async (req, res) => {
  try {
    const finder_name = sanitize(req.body.finder_name);
    const finder_email = sanitize(req.body.finder_email);
    const item_name = sanitize(req.body.item_name);
    const item_description = sanitize(req.body.item_description);
    const category = req.body.category || "Other";
    const location_found = sanitize(req.body.location_found);

    // Validate
    if (finder_name.length < 2) { setFlash(req, "error", "Name is too short."); return res.redirect("/found-items"); }
    if (!isValidEmail(finder_email)) { setFlash(req, "error", "Invalid email."); return res.redirect("/found-items"); }
    if (!item_name || item_name.length > 150) { setFlash(req, "error", "Item name is required (max 150 chars)."); return res.redirect("/found-items"); }

    // Upload image if provided (reuse helper)
    const image_url = req.file ? await uploadImage(req.file.buffer, "found") : null;

    // Save to database
    const { error } = await supabase.from("found_posts").insert({
      finder_name, finder_email, item_name,
      item_description: item_description || null,
      category: CATEGORIES.includes(category) ? category : "Other",
      location_found: location_found || null,
      image_url,
      status: "unclaimed"
    });

    if (error) {
      setFlash(req, "error", "Failed to post item.");
    } else {
      setFlash(req, "success", "Found item posted! The owner can now find it here.");
    }
    return res.redirect("/found-items");
  } catch (err) {
    console.error("Post found item error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/found-items");
  }
});

// Claim a found item (must be logged in)
app.post("/found-items/:id/claim", requireAuth, async (req, res) => {
  try {
    const { data: post } = await supabase
      .from("found_posts")
      .select("*")
      .eq("id", Number(req.params.id))
      .eq("status", "unclaimed")
      .maybeSingle();

    if (!post) {
      setFlash(req, "error", "Post not found or already claimed.");
      return res.redirect("/found-items");
    }

    await supabase.from("found_posts").update({ status: "claimed" }).eq("id", post.id);
    setFlash(req, "success", `You claimed "${post.item_name}". Contact the finder at ${post.finder_email} to arrange pickup.`);
    return res.redirect("/found-items");
  } catch (err) {
    console.error("Claim error:", err);
    setFlash(req, "error", "Something went wrong.");
    return res.redirect("/found-items");
  }
});

// ── Resolve a finder report ──

app.post("/report/:id/resolve", requireAuth, async (req, res) => {
  try {
    const { data: report } = await supabase.from("finder_reports").select("id, item_id").eq("id", Number(req.params.id)).maybeSingle();
    if (!report) return res.status(404).render("not_found");

    // Make sure the logged-in user owns the item
    const { data: item } = await supabase.from("items").select("id, user_id").eq("id", report.item_id).single();
    if (!item || item.user_id !== req.session.userId) return res.status(403).send("Forbidden");

    await supabase.from("finder_reports").update({ status: "resolved" }).eq("id", report.id);
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
    // Get user info and item stats for the account page
    const { data: user } = await supabase.from("users").select("created_at").eq("id", req.session.userId).single();
    const { data: items } = await supabase.from("items").select("id").eq("user_id", req.session.userId);
    const itemIds = (items || []).map((i) => i.id);

    let openReports = 0;
    let resolvedReports = 0;
    if (itemIds.length > 0) {
      const { data: reports } = await supabase.from("finder_reports").select("status").in("item_id", itemIds);
      for (const r of reports || []) {
        if (r.status === "open") openReports++;
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
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      setFlash(req, "error", "New password must be at least 8 characters.");
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

// ── Change Item Status (active / lost / recovered) ──

app.post("/item/:id/status", requireAuth, async (req, res) => {
  const { item_status } = req.body;
  const allowed = ["active", "lost", "recovered"];

  const { data: item } = await supabase.from("items").select("id, user_id").eq("id", req.params.id).maybeSingle();
  if (!item || item.user_id !== req.session.userId) { setFlash(req, "error", "Item not found."); return res.redirect("/dashboard"); }
  if (!allowed.includes(item_status)) { setFlash(req, "error", "Invalid status."); return res.redirect("/dashboard"); }

  await supabase.from("items").update({ item_status }).eq("id", item.id);
  setFlash(req, "success", `Item marked as ${item_status}.`);
  return res.redirect("/dashboard");
});

// ── Delete Item ──

app.post("/item/:id/delete", requireAuth, async (req, res) => {
  const { data: item } = await supabase.from("items").select("id, user_id").eq("id", req.params.id).maybeSingle();
  if (!item || item.user_id !== req.session.userId) { setFlash(req, "error", "Item not found."); return res.redirect("/dashboard"); }

  // Delete related reports first, then the item
  await supabase.from("finder_reports").delete().eq("item_id", item.id);
  await supabase.from("items").delete().eq("id", item.id);
  setFlash(req, "success", "Item deleted.");
  return res.redirect("/dashboard");
});

// ── Download QR Code as PNG ──

app.get("/download/:token", requireAuth, async (req, res) => {
  const { data: item } = await supabase.from("items").select("*").eq("token", req.params.token).eq("user_id", req.session.userId).maybeSingle();
  if (!item) return res.status(404).render("not_found");

  const base64 = (item.qr_data_url || "").split(",")[1];
  if (!base64) return res.status(500).send("QR unavailable");

  const imgBuffer = Buffer.from(base64, "base64");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(item.item_name)}-qr.png"`);
  res.send(imgBuffer);
});

// ── Start the server ──

app.listen(PORT, () => {
  console.log(`PUTrace running on port ${PORT}`);
});
