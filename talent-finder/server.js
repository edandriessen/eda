// server.js — Talent Finder web server
//
// Step 2 (MVP): this server only serves the web page in /public.
// Step 3 adds /api/chat (Claude runs the interview) and Step 4 adds /api/analyze.
//
// PRIVACY: this server never writes interview data to disk or a database.
// The transcript lives only in the user's browser tab.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies (used by the API routes we add in later steps).
app.use(express.json({ limit: "1mb" }));

// Serve index.html, styles.css, app.js, voice.js from /public.
app.use(express.static(path.join(__dirname, "public")));

// Simple check that the server is up: http://localhost:3000/api/health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Talent Finder running at http://localhost:${PORT}`);
});
