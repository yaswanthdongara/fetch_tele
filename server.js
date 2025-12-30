import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;

/* ===============================
   BASIC ROUTES
   =============================== */

// Health check
app.get("/", (req, res) => {
  res.send("🤖 Telegram GitHub Repo Fetch Bot is running");
});

// Webhook
app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

/* ===============================
   HELPER FUNCTIONS
   =============================== */

// Extract owner & repo from GitHub URL
function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// Recursively fetch all files
async function fetchFiles(owner, repo, path = "") {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error("GitHub API error");
  }

  const data = await response.json();
  let files = [];

  for (const item of data) {
    if (item.type === "file") {
      files.push({
        name: item.name,
        download_url: item.download_url
      });
    } else if (item.type === "dir") {
      const subFiles = await fetchFiles(owner, repo, item.path);
      files = files.concat(subFiles);
    }
  }

  return files;
}

/* ===============================
   BOT COMMANDS
   =============================== */

// Start command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Send a GitHub repo URL:\n\n/repo https://github.com/username/repository"
  );
});

// Repo command
bot.onText(/\/repo (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const repoUrl = match[1];

  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return bot.sendMessage(chatId, "❌ Invalid GitHub repository URL");
  }

  const { owner, repo } = parsed;

  try {
    bot.sendMessage(chatId, "⏳ Fetching files, please wait...");

    const files = await fetchFiles(owner, repo);

    if (files.length === 0) {
      return bot.sendMessage(chatId, "⚠️ No downloadable files found");
    }

    for (const file of files) {
      const res = await fetch(file.download_url);
      const buffer = await res.buffer();

      await bot.sendDocument(chatId, buffer, {}, {
        filename: file.name
      });
    }

    bot.sendMessage(chatId, `✅ Sent ${files.length} files successfully`);

  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "❌ Error fetching repository files");
  }
});

/* ===============================
   SERVER
   =============================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
