require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const OpenAI = require("openai");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 5000);

if (!process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is missing. Set it in .env before using authentication.");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ai_saas",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.use(cors({
  origin: process.env.CLIENT_URL || true
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again later." }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "AI request limit reached. Please wait a minute." }
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, plan: user.plan },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required." });

    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function cleanText(value, max = 10000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

async function getUserById(id) {
  const [rows] = await pool.query(
    "SELECT id, name, email, plan, created_at FROM users WHERE id = ?",
    [id]
  );
  return rows[0] || null;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

async function getUsage(userId) {
  const month = currentMonth();
  const [rows] = await pool.query(
    "SELECT message_count FROM usage_monthly WHERE user_id = ? AND usage_month = ?",
    [userId, month]
  );
  const count = rows[0]?.message_count || 0;
  const limit = Number(process.env.FREE_MONTHLY_LIMIT || 50);
  return { month, used: count, limit, remaining: Math.max(limit - count, 0) };
}

async function incrementUsage(userId) {
  const month = currentMonth();
  await pool.query(
    `INSERT INTO usage_monthly (user_id, usage_month, message_count)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE message_count = message_count + 1`,
    [userId, month]
  );
}

function modeInstruction(mode) {
  const instructions = {
    chat: "Answer naturally and helpfully. Be concise unless the user asks for detail.",
    summarize: "Summarize the user's content into clear, structured bullet points. Preserve important facts.",
    rewrite: "Rewrite the user's content to be clearer, more professional, and grammatically correct while preserving meaning.",
    ideas: "Generate practical, specific ideas. Organize them with short headings and bullets."
  };
  return instructions[mode] || instructions.chat;
}

async function generateAI(messages, mode) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to the .env file.");
  }

  const input = [
    {
      role: "system",
      content: modeInstruction(mode)
    },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content
    }))
  ];

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    input
  });

  return response.output_text || "I couldn't generate a response.";
}

// ---------- Auth ----------
app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const name = cleanText(req.body.name, 100);
    const email = cleanText(req.body.email, 190).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) return res.status(409).json({ error: "An account with this email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name, email, passwordHash]
    );

    const user = await getUserById(result.insertId);
    return res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const email = cleanText(req.body.email, 190).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";

    const [rows] = await pool.query(
      "SELECT id, name, email, password_hash, plan, created_at FROM users WHERE email = ?",
      [email]
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    delete user.password_hash;
    return res.json({ token: signToken(user), user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Login failed." });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load user." });
  }
});

// ---------- Dashboard ----------
app.get("/api/usage", authRequired, async (req, res) => {
  try {
    const usage = await getUsage(req.user.id);
    res.json(usage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load usage." });
  }
});

app.get("/api/conversations", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, created_at, updated_at
       FROM conversations
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ conversations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load conversations." });
  }
});

app.post("/api/conversations", authRequired, async (req, res) => {
  try {
    const title = cleanText(req.body.title, 180) || "New conversation";
    const [result] = await pool.query(
      "INSERT INTO conversations (user_id, title) VALUES (?, ?)",
      [req.user.id, title]
    );
    res.status(201).json({ id: result.insertId, title });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create conversation." });
  }
});

app.get("/api/conversations/:id", authRequired, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const [conversations] = await pool.query(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?",
      [conversationId, req.user.id]
    );
    if (!conversations.length) return res.status(404).json({ error: "Conversation not found." });

    const [messages] = await pool.query(
      "SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC",
      [conversationId]
    );

    res.json({ conversation: conversations[0], messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load conversation." });
  }
});

app.delete("/api/conversations/:id", authRequired, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const [result] = await pool.query(
      "DELETE FROM conversations WHERE id = ? AND user_id = ?",
      [conversationId, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Conversation not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete conversation." });
  }
});

// ---------- AI ----------
app.post("/api/chat", authRequired, aiLimiter, async (req, res) => {
  try {
    const conversationId = Number(req.body.conversationId);
    const content = cleanText(req.body.message, 10000);
    const mode = cleanText(req.body.mode, 30) || "chat";

    if (!conversationId || !content) {
      return res.status(400).json({ error: "conversationId and message are required." });
    }

    const [owned] = await pool.query(
      "SELECT id, title FROM conversations WHERE id = ? AND user_id = ?",
      [conversationId, req.user.id]
    );
    if (!owned.length) return res.status(404).json({ error: "Conversation not found." });

    const usage = await getUsage(req.user.id);
    if (req.user.plan === "free" && usage.used >= usage.limit) {
      return res.status(429).json({
        error: "Monthly free-plan limit reached. Upgrade to Pro to continue.",
        usage
      });
    }

    await pool.query(
      "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)",
      [conversationId, content]
    );

    const [history] = await pool.query(
      `SELECT role, content
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      [conversationId]
    );

    const aiMessages = history.reverse();
    const answer = await generateAI(aiMessages, mode);

    await pool.query(
      "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)",
      [conversationId, answer]
    );

    await incrementUsage(req.user.id);

    const currentTitle = owned[0].title;
    if (currentTitle === "New conversation") {
      const newTitle = content.replace(/\s+/g, " ").slice(0, 60);
      await pool.query(
        "UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?",
        [newTitle || "New conversation", conversationId, req.user.id]
      );
    } else {
      await pool.query(
        "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        [conversationId, req.user.id]
      );
    }

    res.json({
      answer,
      usage: await getUsage(req.user.id)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "AI request failed." });
  }
});

// ---------- Health ----------
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "connected",
      aiConfigured: Boolean(openai),
      time: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: "error",
      database: "disconnected",
      aiConfigured: Boolean(openai)
    });
  }
});

// SPA fallback
app.get("*splat", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AI SaaS running at http://localhost:${PORT}`);
});
