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
   ROUTES
   =============================== */

app.get("/", (req, res) => {
  res.send("🤖 Telegram GitHub Downloader Bot is running");
});

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

/* ===============================
   HELPERS
   =============================== */

// Detect and parse GitHub repo URL
function parseGitHubRepoUrl(text) {
  const match = text.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/\s]+)(?:\/)?$/
  );

  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2].replace(".git", "")
  };
}

/* ===============================
   BOT LOGIC
   =============================== */

// Start message
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Just send a GitHub repository URL.\n\nExample:\nhttps://github.com/username/repository"
  );
});

// 🔥 MAIN LOGIC: listen to ALL messages
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  const parsed = parseGitHubRepoUrl(text);
  if (!parsed) return; // ignore non-GitHub messages

  const { owner, repo } = parsed;
  const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball`;

  try {
    await bot.sendMessage(chatId, "⏳ Downloading repository…");

    const response = await fetch(zipUrl, {
      headers: {
        "User-Agent": "telegram-github-downloader"
      }
    });

    if (!response.ok) {
      throw new Error("GitHub ZIP download failed");
    }

    const buffer = await response.buffer();

    await bot.sendDocument(chatId, buffer, {}, {
      filename: `${repo}.zip`
    });

    await bot.sendMessage(chatId, "✅ Repository downloaded successfully");

  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "❌ Failed to download repository");
  }
});

/* ===============================
   SERVER
   =============================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
