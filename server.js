import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;

// ---- WEBHOOK ----
app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ---- START COMMAND ----
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Send:\n/file <owner> <repo> <path>\n\nExample:\n/file octocat Hello-World README.md"
  );
});

// ---- FILE COMMAND ----
bot.onText(/\/file (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const [owner, repo, path] = match[1].split(" ");

  if (!owner || !repo || !path) {
    return bot.sendMessage(chatId, "❌ Invalid format");
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url);

    if (!response.ok) {
      return bot.sendMessage(chatId, "❌ File not found");
    }

    const data = await response.json();
    const fileBuffer = Buffer.from(data.content, "base64");

    await bot.sendDocument(chatId, fileBuffer, {}, {
      filename: path
    });

  } catch (err) {
    bot.sendMessage(chatId, "⚠️ Error fetching file");
  }
});

// ---- SERVER ----
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
