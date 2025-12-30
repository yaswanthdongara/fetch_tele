import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { Readable } from "stream";

dotenv.config();

/* ===============================
   BASIC SETUP
   =============================== */

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;

/* ===============================
   GITHUB HEADERS
   =============================== */

const GH_HEADERS = {
  "User-Agent": "telegram-github-bot",
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`
};

/* ===============================
   ROUTES
   =============================== */

app.get("/", (req, res) => {
  res.send("🤖 Telegram GitHub File Fetch Bot running");
});

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

/* ===============================
   HELPERS
   =============================== */

function parseGitHubRepoUrl(text) {
  const m = text.match(/^https?:\/\/github\.com\/([^/]+)\/([^/\s]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(".git", "") };
}

async function getDefaultBranch(owner, repo) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: GH_HEADERS }
  );
  if (!r.ok) throw new Error("Repo fetch failed");
  const j = await r.json();
  return j.default_branch;
}

async function getCommitSha(owner, repo, branch) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { headers: GH_HEADERS }
  );
  if (!r.ok) throw new Error("Branch ref fetch failed");
  const j = await r.json();
  return j.object.sha;
}

async function getAllFiles(owner, repo, sha) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers: GH_HEADERS }
  );
  if (!r.ok) throw new Error("Tree fetch failed");
  const j = await r.json();
  return j.tree.filter(x => x.type === "blob");
}

/* ===============================
   BOT LOGIC
   =============================== */

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  const parsed = parseGitHubRepoUrl(text);
  if (!parsed) return;

  const { owner, repo } = parsed;

  try {
    await bot.sendMessage(chatId, "⏳ Fetching repository files…");

    const branch = await getDefaultBranch(owner, repo);
    const sha = await getCommitSha(owner, repo, branch);
    const files = await getAllFiles(owner, repo, sha);

    if (!files.length) {
      await bot.sendMessage(chatId, "⚠️ No files found");
      return;
    }

    for (const f of files) {
      const rawUrl =
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${f.path}`;

      const r = await fetch(rawUrl);
      if (!r.ok) continue;

      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length) continue;

      // ✅ STREAM FIX (THIS SOLVES EVERYTHING)
      const stream = Readable.from(buffer);

      await bot.sendDocument(chatId, stream, {
        filename: f.path.split("/").pop()
      });
    }

    await bot.sendMessage(chatId, `✅ Sent ${files.length} files`);

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `❌ ${err.message}`);
  }
});

/* ===============================
   SERVER
   =============================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
