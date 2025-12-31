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
   SESSION STORE
   =============================== */
// chatId -> { owner, repo, branch, tree, path, prevPath, entries, page, searching }
const sessions = new Map();

/* ===============================
   ROUTES
   =============================== */

app.get("/", (_, res) => {
  res.send("🤖 Telegram GitHub File Navigator Bot running");
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

async function getTree(owner, repo, sha) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers: GH_HEADERS }
  );
  const j = await r.json();
  return j.tree;
}

function getEntries(tree, path) {
  const prefix = path ? `${path}/` : "";
  const depth = prefix.split("/").length;

  return tree.filter(item => {
    if (!item.path.startsWith(prefix)) return false;
    return item.path.split("/").length === depth;
  });
}

/* ===============================
   KEYBOARD BUILDER
   =============================== */

function buildKeyboard(entries, page, options = {}) {
  const PAGE_SIZE = 8;
  const start = page * PAGE_SIZE;
  const slice = entries.slice(start, start + PAGE_SIZE);

  const rows = slice.map(e => [{
    text: e.type === "tree"
      ? `📂 ${e.path.split("/").pop()}`
      : `📄 ${e.path.split("/").pop()}`,
    callback_data: `${e.type}:${e.path}`
  }]);

  const nav = [];
  if (page > 0) nav.push({ text: "⏮ Prev", callback_data: "nav:prev" });
  if (start + PAGE_SIZE < entries.length) nav.push({ text: "Next ⏭", callback_data: "nav:next" });
  if (nav.length) rows.push(nav);

  if (options.showBack) {
    rows.push([{ text: "🔙 Back", callback_data: "nav:back" }]);
  }

  if (options.searching) {
    rows.push([{ text: "❌ Cancel Search", callback_data: "search:cancel" }]);
  } else {
    rows.push([{ text: "🔎 Search", callback_data: "search" }]);
  }

  return rows;
}

/* ===============================
   MESSAGE HANDLER
   =============================== */

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  const session = sessions.get(chatId);

  // SEARCH MODE
  if (session?.searching) {
    const keyword = text.toLowerCase();
    const matches = session.tree.filter(
      f => f.type === "blob" && f.path.toLowerCase().includes(keyword)
    );

    session.searching = false;
    session.entries = matches.length ? matches : session.entries;
    session.page = 0;

    await bot.sendMessage(
      chatId,
      matches.length ? "🔎 Search results:" : "❌ No matching files found",
      {
        reply_markup: {
          inline_keyboard: buildKeyboard(session.entries, 0, {
            showBack: session.path !== "",
            searching: false
          })
        }
      }
    );
    return;
  }

  const parsed = parseGitHubRepoUrl(text);
  if (!parsed) return;

  const { owner, repo } = parsed;

  try {
    await bot.sendMessage(chatId, "⏳ Loading repository…");

    const branch = await getDefaultBranch(owner, repo);
    const sha = await getCommitSha(owner, repo, branch);
    const tree = await getTree(owner, repo, sha);

    const entries = getEntries(tree, "");

    sessions.set(chatId, {
      owner,
      repo,
      branch,
      tree,
      path: "",
      prevPath: "",
      entries,
      page: 0,
      searching: false
    });

    await bot.sendMessage(chatId, "📂 Repository root:", {
      reply_markup: {
        inline_keyboard: buildKeyboard(entries, 0)
      }
    });

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "❌ Failed to load repository");
  }
});

/* ===============================
   CALLBACK HANDLER
   =============================== */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  const session = sessions.get(chatId);
  if (!session) return;

  await bot.answerCallbackQuery(q.id);

  if (data === "nav:next") session.page++;
  else if (data === "nav:prev") session.page--;
  else if (data === "nav:back") {
    session.path = session.prevPath || "";
    session.prevPath = session.path.includes("/")
      ? session.path.substring(0, session.path.lastIndexOf("/"))
      : "";
    session.entries = getEntries(session.tree, session.path);
    session.page = 0;
  }
  else if (data === "search") {
    session.searching = true;
    await bot.sendMessage(chatId, "🔎 Send file name to search:", {
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Cancel Search", callback_data: "search:cancel" }]]
      }
    });
    return;
  }
  else if (data === "search:cancel") {
    session.searching = false;
    session.entries = getEntries(session.tree, session.path);
    session.page = 0;
  }
  else if (data.startsWith("tree:")) {
    session.prevPath = session.path;
    session.path = data.split(":")[1];
    session.entries = getEntries(session.tree, session.path);
    session.page = 0;
  }
  else if (data.startsWith("blob:")) {
    const filePath = data.split(":")[1];
    const rawUrl =
      `https://raw.githubusercontent.com/${session.owner}/${session.repo}/${session.branch}/${filePath}`;

    const r = await fetch(rawUrl);
    const buffer = Buffer.from(await r.arrayBuffer());
    const stream = Readable.from(buffer);

    await bot.sendDocument(chatId, stream, {
      filename: filePath.replace(/\//g, "__")
    });
    await bot.sendMessage(chatId, `📄 ${filePath}`);
    return;
  }

  await bot.editMessageReplyMarkup({
    inline_keyboard: buildKeyboard(
      session.entries,
      session.page,
      {
        showBack: session.path !== "",
        searching: session.searching
      }
    )
  }, {
    chat_id: chatId,
    message_id: q.message.message_id
  });
});

/* ===============================
   SERVER
   =============================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
