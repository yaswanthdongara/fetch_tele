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
  "Accept": "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN && {
    "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`
  })
};

app.get("/", (req, res) => res.send("Bot running"));

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
    // 🔎 DEBUG: confirm token
    await bot.sendMessage(chatId, `TOKEN PRESENT: ${!!process.env.GITHUB_TOKEN}`);

    const repoRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: GH_HEADERS }
    );

    if (!repoRes.ok) {
      const t = await repoRes.text();
      throw new Error(`REPO ${repoRes.status}: ${t}`);
    }

    const repoJson = await repoRes.json();
    const branch = repoJson.default_branch;

    const refRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      { headers: GH_HEADERS }
    );

    if (!refRes.ok) {
      const t = await refRes.text();
      throw new Error(`REF ${refRes.status}: ${t}`);
    }

    const refJson = await refRes.json();
    const sha = refJson.object.sha;

    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
      { headers: GH_HEADERS }
    );

    if (!treeRes.ok) {
      const t = await treeRes.text();
      throw new Error(`TREE ${treeRes.status}: ${t}`);
    }

    const treeJson = await treeRes.json();
    const files = treeJson.tree.filter(f => f.type === "blob");

    for (const f of files) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${f.path}`;
      const r = await fetch(rawUrl);
      const buf = Buffer.from(await r.arrayBuffer());

      await bot.sendDocument(chatId, buf, {}, {
        filename: f.path.split("/").pop()
      });
    }

    await bot.sendMessage(chatId, `✅ Sent ${files.length} files`);

  } catch (err) {
    await bot.sendMessage(chatId, `❌ ERROR:\n${err.message.slice(0, 350)}`);
  }
});

app.listen(PORT, () => console.log("Server running"));
