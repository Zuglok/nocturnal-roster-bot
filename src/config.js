import fs from "fs";

function decodeGooglePrivateKey() {
  const b64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (b64) {
    try { return Buffer.from(b64, "base64").toString("utf8"); }
    catch { /* ignore */ }
  }
  return (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

export const cfg = {
  discord: {
    token: process.env.DISCORD_BOT_TOKEN || "",
    appId: process.env.DISCORD_CLIENT_ID || "",
    guildId: process.env.DISCORD_GUILD_ID || "",
    channelIds: (process.env.DISCORD_CHANNEL_ID || "")
      .split(",").map(s => s.trim()).filter(Boolean),
  },
  google: {
    sheetId: process.env.GOOGLE_SHEET_ID || "",
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL || "",
    privateKey: decodeGooglePrivateKey(),
    driveFolderId: process.env.GDRIVE_FOLDER_ID || "",
  },
  backups: {
    delayMs: Math.max(0, parseInt(process.env.ATTACHMENT_DELAY || "800", 10) || 0),
  },
  access: {
    list: (() => {
      const raw = fs.readFileSync("access.txt", "utf-8"); 
      const arr = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      return arr.slice(0, 25);
    })(),
  }
};

export function assertEnv() {
  const miss = [];
  if (!cfg.discord.token) miss.push("DISCORD_BOT_TOKEN");
  if (!cfg.discord.appId) miss.push("DISCORD_CLIENT_ID");
  if (!cfg.discord.guildId) miss.push("DISCORD_GUILD_ID");
  if (!cfg.google.sheetId) miss.push("GOOGLE_SHEET_ID");
  if (!cfg.google.clientEmail) miss.push("GOOGLE_CLIENT_EMAIL");
  if (!cfg.google.privateKey) miss.push("GOOGLE_PRIVATE_KEY_BASE64/GOOGLE_PRIVATE_KEY");
  if (!cfg.access.list.length) miss.push("access.txt (no labels found)");
  if (miss.length) {
    console.error("Missing config:", miss.join(", "));
    process.exit(1);
  }
}
