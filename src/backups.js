// Backs up .json/.zip attachments from a target Discord channel to Google Drive.

import fs from "fs";
import axios from "axios";
import { google } from "googleapis";

// --- Environment ---
const TARGET_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; // single channel ID to watch
const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID;   // Drive folder to upload into
const ATTACHMENT_DELAY =
  parseInt(process.env.ATTACHMENT_DELAY, 10) || 1000000; // default delay in ms

// --- Google Drive client ---
const privateKey = process.env.GOOGLE_PRIVATE_KEY_BASE64
  ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, "base64").toString("utf8")
  : (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: privateKey,
  },
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});
const drive = google.drive({ version: "v3", auth });

// --- Deduplication state ---
const processedAttachments = new Set();

// --- Google Drive upload helper ---
async function uploadToDrive(filePath, fileName) {
  try {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
    const baseName = fileName.split(".")[0];
    const extension = fileName.split(".").pop();
    const newFileName = `${baseName}_${timestamp}.${extension}`;

    const fileMetadata = { name: newFileName, parents: [GDRIVE_FOLDER_ID] };
    const media = {
      mimeType: extension === "zip" ? "application/zip" : "application/json",
      body: fs.createReadStream(filePath),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id",
    });

    console.log(`✅ [Drive] Uploaded: ${newFileName} (ID: ${response.data.id})`);
    return true;
  } catch (err) {
    console.error(`❌ [Drive] Upload Error: ${err.message}`);
    return false;
  }
}

// --- Single attachment processing (download → upload → cleanup) ---
async function processAttachment(attachment, channel) {
  if (processedAttachments.has(attachment.id)) {
    console.log(`⚠️ [Backup] Already processed: ${attachment.name} (${attachment.id}). Skipping.`);
    return false;
  }
  processedAttachments.add(attachment.id);

  if (!attachment.name.endsWith(".zip") && !attachment.name.endsWith(".json")) {
    console.log(`❌ [Backup] Unsupported file type: ${attachment.name}`);
    return false;
  }

  const filePath = `./${attachment.name}`;
  try {
    console.log(`📝 [Backup] Detected attachment: ${attachment.name}`);

    const writer = fs.createWriteStream(filePath);
    const response = await axios.get(attachment.url, { responseType: "stream" });
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
    console.log(`📥 [Backup] Downloaded: ${filePath}`);

    const ok = await uploadToDrive(filePath, attachment.name);
    fs.unlink(filePath, () => {});
    if (ok) channel.send(`✅ Uploaded **${attachment.name}** to Drive.`).catch(() => {});
    return ok;
  } catch (err) {
    console.error(`❌ [Backup] Error with ${attachment.name}: ${err.message}`);
    try { fs.unlinkSync(filePath); } catch {}
    return false;
  }
}

// --- Public: attach listeners to a Discord client ---
export function attachBackups(client) {
  client.on("messageCreate", (message) => {
    if (!TARGET_CHANNEL_ID || message.channel.id !== TARGET_CHANNEL_ID) return;
    setTimeout(async () => {
      for (const attachment of message.attachments.values()) {
        await processAttachment(attachment, message.channel);
      }
    }, ATTACHMENT_DELAY);
  });

  client.on("messageUpdate", async (oldMessage, newMessage) => {
    if (!TARGET_CHANNEL_ID || newMessage.channel.id !== TARGET_CHANNEL_ID) return;

    if (oldMessage.partial) oldMessage = await oldMessage.fetch();
    if (newMessage.partial) newMessage = await newMessage.fetch();

    const oldIds = new Set(oldMessage.attachments.keys());
    for (const [id, attachment] of newMessage.attachments) {
      if (!oldIds.has(id)) {
        await processAttachment(attachment, newMessage.channel);
      }
    }
  });

  console.log(`[Backups] Watching channel ${TARGET_CHANNEL_ID} with delay ${ATTACHMENT_DELAY}ms`);
}
