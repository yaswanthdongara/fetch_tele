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
   IN-MEMORY SESSION STORE
   (simple & enough for Render free)
   =============================== */

const sessions = new Map();

/* ===============================
   ROUTES
   =============================== */

app.get("/", (req, res) => {
  res.send("🤖 Telegram GitHub File Selector Bot is running");
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
  const j = await r.json();
  return j.default_branch;
}

async function getCommitSha(owner, repo, branch) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { headers: GH_HEADERS }
  );
  const j = await r.json();
  return j.object.sha;
}

async function getAllFiles(owner, repo, sha) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers: GH_HEADERS }
  );
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
    await bot.sendMessage(chatId, "⏳ Reading repository files…");

    const branch = await getDefaultBranch(owner, repo);
    const sha = await getCommitSha(owner, repo, branch);
    const files = await getAllFiles(owner, repo, sha);

    if (!files.length) {
      await bot.sendMessage(chatId, "⚠️ No files found");
      return;
    }

    // Save session
    sessions.set(chatId, { owner, repo, branch, files });

    // Build inline keyboard (max 10 buttons per message)
    const keyboard = files.slice(0, 10).map((f, index) => ([
      {
        text: f.path.split("/").pop(),
        callback_data: `file_${index}`
      }
    ]));

    await bot.sendMessage(chatId, "📂 Select a file to download:", {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

/* ===============================
   BUTTON HANDLER
   =============================== */

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!data.startsWith("file_")) return;

  const index = Number(data.split("_")[1]);
  const session = sessions.get(chatId);
  if (!session) return;

  const { owner, repo, branch, files } = session;
  const file = files[index];
  if (!file) return;

  try {
    await bot.answerCallbackQuery(query.id);

    const rawUrl =
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;

    const r = await fetch(rawUrl);
    const buffer = Buffer.from(await r.arrayBuffer());
    const stream = Readable.from(buffer);

    const safeFilename = file.path.replace(/\//g, "__");

    // Send file
    await bot.sendDocument(chatId, stream, {
      filename: safeFilename
    });

    // Send exact GitHub path
    await bot.sendMessage(chatId, `📄 ${file.path}`);

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "❌ Failed to download file");
  }
});

/* ===============================
   SERVER
   =============================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
