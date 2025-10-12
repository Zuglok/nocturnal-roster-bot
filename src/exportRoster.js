// /roster export: replaces the "Raw Discord Data" sheet with guild members data.
// Columns: ID | Username | Display Name | Roles | User Type | Join Date
// Data is written as plain text (valueInputOption: "RAW") to avoid any conversion in Google Sheets.

import { cfg } from "./config.js";

// Sheet title to write to
const RAW_SHEET_NAME = "Raw Discord Data";

// Quote a sheet title for A1 notation, handling apostrophes
function a1Sheet(title) {
  return `'${String(title).replace(/'/g, "''")}'!`;
}

// Format join date as: 2025-09-22 13:34:19.825000+00:00 (UTC)
function formatJoinDateUTC(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const MM = String(d.getUTCMinutes()).padStart(2, "0");
  const SS = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  const micro = ms + "000"; // .SSS000
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}.${micro}+00:00`;
}

// Build role label like: [Server Booster,Member,Officer] (excludes @everyone, sorted by position desc)
function rolesToLabel(member) {
  const roles = member.roles.cache
    .filter(r => r.name !== "@everyone")
    .sort((a, b) => b.position - a.position)
    .map(r => r.name);
  return `[${roles.join(",")}]`;
}

// Permission check: member must have a role named exactly "Officer"
function hasOfficerRole(member) {
  return member.roles.cache.some(r => r.name === "Officer");
}

// Ensure the target sheet exists (create if missing)
async function ensureRawSheetExists(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: cfg.google.sheetId });
  const found = meta.data.sheets?.find(s => s.properties?.title === RAW_SHEET_NAME);
  if (found) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: cfg.google.sheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: RAW_SHEET_NAME } } }]
    }
  });
}

export async function handleRosterExport(interaction) {
  // Only handle /roster export
  if (!interaction.isChatInputCommand() || interaction.commandName !== "roster") return false;
  const sub = interaction.options.getSubcommand(false);
  if (sub !== "export") return false;

  // Officer role required
  if (!hasOfficerRole(interaction.member)) {
    await interaction.reply({ content: "You need the **Officer** role to run this command.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  // Make sure members cache is populated (requires GuildMembers intent + Server Members Intent in the portal)
  try {
    await interaction.guild.members.fetch();
  } catch {
    await interaction.editReply({
      content: "Cannot fetch guild members. Enable **Server Members Intent** in the Developer Portal and add `GuildMembers` intent to the client."
    });
    return true;
  }

  // Build the data (plain text)
  const header = ["ID","Username","Display Name","Roles","User Type","Join Date"];
  const rows = [];
  for (const m of interaction.guild.members.cache.values()) {
    const id = String(m.user.id);
    const username = String(m.user.username || "");
    const display = String(m.displayName || "");
    const roles = String(rolesToLabel(m));
    const userType = m.user.bot ? "Bot" : "Human";
    const joined = m.joinedAt ? formatJoinDateUTC(m.joinedAt) : "";
    rows.push([id, username, display, roles, userType, joined]);
  }

  // Sort by Join Date ascending to match your sample
  rows.sort((a, b) => (a[5] || "").localeCompare(b[5] || ""));

  // Write to Google Sheets (RAW = plain text, no parsing)
  const { sheets } = await import("./googleClients.js");

  // Ensure the sheet exists (no-op if already there)
  await ensureRawSheetExists(sheets);

  // Clear all content in the target sheet (quotes are mandatory because of spaces in the title)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: cfg.google.sheetId,
    range: `${a1Sheet(RAW_SHEET_NAME)}A:Z`
  });

  // Write header + rows starting at A1 (RAW to avoid any conversion)
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.google.sheetId,
    range: `${a1Sheet(RAW_SHEET_NAME)}A1`,
    valueInputOption: "RAW",
    requestBody: { values: [header, ...rows] }
  });

  await interaction.editReply({ content: `Exported ${rows.length} members to '${RAW_SHEET_NAME}'.` });
  return true;
}
