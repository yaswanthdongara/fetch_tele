import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;

const GH_HEADERS = {
  "User-Agent": "telegram-github-bot",
  "Accept": "application/vnd.github+json"
};

app.get("/", (req, res) => {
  res.send("DIAGNOSTIC MODE ACTIVE");
});

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  const match = text.match(/^https?:\/\/github\.com\/([^/]+)\/([^/\s]+)/);
  if (!match) return;

  const owner = match[1];
  const repo = match[2];

  try {
    // 1️⃣ Repo
    const repoRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: GH_HEADERS }
    );
    const repoText = await repoRes.text();

    await bot.sendMessage(
      chatId,
      `REPO STATUS: ${repoRes.status}\n${repoText.slice(0, 350)}`
    );

    const repoJson = JSON.parse(repoText);
    const branch = repoJson.default_branch;

    // 2️⃣ Branch ref
    const refRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      { headers: GH_HEADERS }
    );
    const refText = await refRes.text();

    await bot.sendMessage(
      chatId,
      `REF STATUS: ${refRes.status}\n${refText.slice(0, 350)}`
    );

    const refJson = JSON.parse(refText);
    const sha = refJson.object.sha;

    // 3️⃣ Tree
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
      { headers: GH_HEADERS }
    );
    const treeText = await treeRes.text();

    await bot.sendMessage(
      chatId,
      `TREE STATUS: ${treeRes.status}\n${treeText.slice(0, 350)}`
    );

  } catch (err) {
    await bot.sendMessage(chatId, `❌ ERROR:\n${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log("Diagnostic server running");
});
