import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

/* ===============================
   BASIC SETUP
   =============================== */

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;

/* ===============================
   GITHUB HEADERS (RATE LIMIT FIX)
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
  res.send("🤖 Telegram GitHub File Fetch Bot is running");
});

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

/* ===============================
   HELPERS
   =============================== */

// Extract owner & repo from GitHub URL
function parseGitHubRepoUrl(text) {
  const match = text.match(/^https?:\/\/github\.com\/([^/]+)\/([^/\s]+)/);
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2].replace(".git", "")
  };
}

// Get default branch
async function getDefaultBranch(owner, repo) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: GH_HEADERS }
  );
  if (!res.ok) throw new Error("Failed to fetch repo");
  const data = await res.json();
  return data.default_branch;
}

// Get commit SHA of branch
async function getCommitSha(owner, repo, branch) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { headers: GH_HEADERS }
  );
  if (!res.ok) throw new Error("Failed to fetch branch SHA");
  const data = await res.json();
  return data.object.sha;
}

// Get all files using Tree API
async function getAllFiles(owner, repo, sha) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers: GH_HEADERS }
  );
  if (!res.ok) throw new Error("Failed to fetch tree");
  const data = await res.json();
  return data.tree.filter(item => item.type === "blob");
}

/* ===============================
   BOT LOGIC
   =============================== */

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  const parsed = parseGitHubRepoUrl(text);
  if (!parsed) return; // ignore non-GitHub messages

  const { owner, repo } = parsed;

  try {
    await bot.sendMessage(chatId, "⏳ Fetching repository files…");

    const branch = await getDefaultBranch(owner, repo);
    const sha = await getCommitSha(owner, repo, branch);
    const files = await getAllFiles(owner, repo, sha);

    if (!files.length) {
      return bot.sendMessage(chatId, "⚠️ No files found in repository");
    }

    for (const file of files) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
      const res = await fetch(rawUrl);

      if (!res.ok) continue;

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // ✅ CORRECT TELEGRAM FILE UPLOAD
      await bot.sendDocument(chatId, {
        source: buffer,
        filename: file.path.split("/").pop()
      });
    }

    await bot.sendMessage(chatId, `✅ Sent ${files.length} files successfully`);

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

/* ===============================
   SERVER
   =============================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
