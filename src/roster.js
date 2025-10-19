// Roster management: /roster add|edit|remove|export
// - Column A stores the user's current Discord display name (text).
// - Column A note stores: "Discord ID: <id>" (primary key).
// - Class columns (D..R) store "Name (Level)" or "Name (M-<Level>)" / "Name (M2-<Level>)".
// - Class-cell note stores "AA: <n>" and "Access: <csv>".
// - Access labels are loaded from access.txt; selection is done via an ephemeral multi-select menu with action buttons.
// - /roster export replaces the "Raw Discord Data" sheet with guild members data (handled in exportRoster.js).

import {
  ROSTER_SHEET_NAME, colIndexToA1,
  findRowByDiscordIdOrDisplayName, appendRosterRow,
  readSingleCellNoteA1, writeSingleCellNoteByRC, updateCellA1,
  upsertNoteLines, ensureIdentityOnColumnA, getRosterSheetId
} from "./sheets.js";
import { cfg } from "./config.js";
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags
} from "discord.js";
import { handleRosterExport } from "./exportRoster.js";

// ---- Constants ----
const CLASS_LIST = [
  "Bard","Cleric","Druid","Enchanter","Magician","Monk","Necromancer","Paladin",
  "Ranger","Rogue","Shadow Knight","Shaman","Warrior","Wizard","Beastlord"
];

// ---- Slash command schema ----
export const rosterCommandJSON = new SlashCommandBuilder()
  .setName("roster")
  .setDescription("Manage your guild roster")
  // add
  .addSubcommand(sub => sub
    .setName("add")
    .setDescription("Add or upsert a character in your roster row")
    .addStringOption(o => o.setName("name").setDescription("Character name").setRequired(true))
    .addStringOption(o => o.setName("class").setDescription("Class").setRequired(true)
      .addChoices(...CLASS_LIST.map(c => ({ name: c, value: c }))))
    .addIntegerOption(o => o.setName("level").setDescription("Level 1–65").setRequired(true).setMinValue(1).setMaxValue(65))
    .addIntegerOption(o => o.setName("aa").setDescription("Alternate Abilities 1–1000").setRequired(false).setMinValue(1).setMaxValue(1000))
  )
  // edit
  .addSubcommand(sub => sub
    .setName("edit")
    .setDescription("Edit an existing character in your roster row")
    .addStringOption(o => o.setName("name").setDescription("Character name").setRequired(true))
    .addStringOption(o => o.setName("class").setDescription("Class").setRequired(true)
      .addChoices(...CLASS_LIST.map(c => ({ name: c, value: c }))))
    .addIntegerOption(o => o.setName("level").setDescription("Level 1–65").setRequired(true).setMinValue(1).setMaxValue(65))
    .addIntegerOption(o => o.setName("aa").setDescription("Alternate Abilities 1–1000").setRequired(false).setMinValue(1).setMaxValue(1000))
  )
  // remove
  .addSubcommand(sub => sub
    .setName("remove")
    .setDescription("Remove a character from your roster row")
    .addStringOption(o => o.setName("name").setDescription("Character name").setRequired(true))
  )
  // export
  .addSubcommand(sub => sub
    .setName("export")
    .setDescription("Replace 'Raw Discord Data' with current guild members"))
  .toJSON();

// ---- Access helpers ----
function parseAccessFromNote(note) {
  const m = (note || "").match(/^\s*Access\s*:\s*(.+)\s*$/mi);
  if (!m) return [];
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}

// Ephemeral multi-select with action buttons: Save / Keep current / Clear
async function askAccessMenu(interaction, preselected = []) {
  const options = cfg.access.list.map(label => {
    const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(label);
    if (preselected.includes(label)) opt.setDefault(true);
    return opt;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("access-select")
    .setPlaceholder("Select access labels (optional)")
    .setMinValues(0)
    .setMaxValues(Math.min(options.length, 25))
    .setOptions(options);

  const btnSave  = new ButtonBuilder().setCustomId("access-save").setLabel("Save").setStyle(ButtonStyle.Primary);
  const btnKeep  = new ButtonBuilder().setCustomId("access-keep").setLabel("Keep current").setStyle(ButtonStyle.Secondary);
  const btnClear = new ButtonBuilder().setCustomId("access-clear").setLabel("Clear").setStyle(ButtonStyle.Danger);

  let current = [...preselected];
  const row1 = new ActionRowBuilder().addComponents(select);
  const row2 = new ActionRowBuilder().addComponents(btnSave, btnKeep, btnClear);

  const msg = await interaction.followUp({
    content: "Access selection:",
    components: [row1, row2],
    flags: MessageFlags.Ephemeral
  });

  const filter = i => i.user.id === interaction.user.id;
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    let i;
    try {
      const remaining = Math.max(0, deadline - Date.now());
      i = await msg.awaitMessageComponent({ time: remaining, filter });
    } catch {
      break; // timeout
    }
    if (!i) break;

    if (i.componentType === ComponentType.StringSelect) {
      current = i.values;
      await i.deferUpdate();
      continue;
    }
    if (i.componentType === ComponentType.Button) {
      if (i.customId === "access-save") {
        await i.update({ content: "Access captured.", components: [] });
        return current;
      }
      if (i.customId === "access-keep") {
        await i.update({ content: "Access unchanged.", components: [] });
        return preselected;
      }
      if (i.customId === "access-clear") {
        current = [];
        await i.update({ content: "Access selection: (cleared)", components: [row1, row2] });
        continue;
      }
    }
  }

  try { await msg.edit({ content: "Access selection skipped (timeout).", components: [] }); } catch {}
  return preselected;
}

// ---- Value builder (preserve M-/M2- on edit) ----
async function buildCellValueForClass(classCol, rowNumber, charName, level, isEdit) {
  if (!isEdit) return `${charName} (${level})`;

  const res = await (await import("./googleClients.js")).sheets.spreadsheets.values.get({
    spreadsheetId: cfg.google.sheetId,
    range: `${ROSTER_SHEET_NAME}!${classCol}${rowNumber}:${classCol}${rowNumber}`,
  });
  const current = res.data.values?.[0]?.[0]?.toString() || "";

  // Preserve "Name (M-60)" or "Name (M2-60)" by updating only the numeric part
  const m = current.match(/^\s*.*?\s*\(\s*(?:(M2?-))?(\d{1,3})\s*\)\s*$/i);
  if (m && m[1]) {
    const tag = m[1]; // "M-" or "M2-"
    return `${charName} (${tag}${level})`;
  }
  return `${charName} (${level})`;
}

// ---- Handler ----
export async function handleRosterInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "roster") return;

  const sub = interaction.options.getSubcommand();

  // Delegate export early (it gère son propre deferReply)
  if (sub === "export") {
    const handled = await handleRosterExport(interaction);
    if (handled) return;
  }

  // Defer immediately to avoid Unknown interaction if operations take >3s
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    if (err?.code === 10062) { // Unknown interaction
      console.warn("[roster] Interaction expired before deferReply");
      return;
    }
    throw err;
  }

  if (sub === "add" || sub === "edit") {
    const displayName = (interaction.member?.displayName || interaction.user.username).trim();
    const discordId   = interaction.user.id;

    let { rowNumber } = await findRowByDiscordIdOrDisplayName(discordId, displayName);

    if (!rowNumber) {
      if (sub === "add") {
        rowNumber = await appendRosterRow(displayName);
      } else {
        await interaction.editReply({ content: "No row found. Use `/roster add`." });
        return;
      }
    }

    await ensureIdentityOnColumnA(rowNumber, displayName, discordId);

    const charName = interaction.options.getString("name", true);
    const klass = interaction.options.getString("class", true);
    const level = interaction.options.getInteger("level", true);

    const classIndex1 = 4 + CLASS_LIST.indexOf(klass);
    if (classIndex1 < 4) {
      await interaction.editReply({ content: `Class "${klass}" is not recognized.` });
      return;
    }
    const classCol = colIndexToA1(classIndex1);

    const cellValue = await buildCellValueForClass(classCol, rowNumber, charName, level, sub === "edit");
    await updateCellA1(`${ROSTER_SHEET_NAME}!${classCol}${rowNumber}`, cellValue);

    const oldClassNote = await readSingleCellNoteA1(`${ROSTER_SHEET_NAME}!${classCol}${rowNumber}:${classCol}${rowNumber}`);
    const aa = interaction.options.getInteger("aa") || null;

    const preselected = sub === "edit" ? parseAccessFromNote(oldClassNote) : [];
    const picked = await askAccessMenu(interaction, preselected);
    const accessJoined = picked.join(", ");

    const newClassNote = upsertNoteLines(oldClassNote, {
      ...(aa ? { "AA": aa } : {}),
      ...(picked.length ? { "Access": accessJoined } : { "Access": "" })
    });

    const sheetId = await getRosterSheetId();
    await writeSingleCellNoteByRC(sheetId, rowNumber - 1, classIndex1 - 1, newClassNote);

    await interaction.editReply({
      content: `${sub === "add" ? "Saved" : "Updated"} • ${klass}: \`${cellValue}\`${aa ? ` • AA=${aa}` : ""}${picked.length ? ` • Access=[${accessJoined}]` : ""}`
    });
    return;
  }

  if (sub === "remove") {
    const displayName = (interaction.member?.displayName || interaction.user.username).trim();
    const discordId   = interaction.user.id;

    let { rowNumber } = await findRowByDiscordIdOrDisplayName(discordId, displayName);
    if (!rowNumber) {
      await interaction.editReply({ content: "No row found." });
      return;
    }
    await ensureIdentityOnColumnA(rowNumber, displayName, discordId);

    const name = interaction.options.getString("name", true);
    const vals = await (await import("./googleClients.js")).sheets.spreadsheets.values.get({
      spreadsheetId: cfg.google.sheetId,
      range: `${ROSTER_SHEET_NAME}!D${rowNumber}:R${rowNumber}`,
    });
    const rowVals = vals.data.values?.[0] || [];
    const updates = [];
    for (let i = 0; i < CLASS_LIST.length; i++) {
      const val = (rowVals[i] || "").trim();
      if (val.toLowerCase().startsWith((name + " (").toLowerCase())) {
        const col1 = 4 + i;
        const a1 = `${ROSTER_SHEET_NAME}!${colIndexToA1(col1)}${rowNumber}`;
        updates.push({ range: a1, values: [[""]] });
      }
    }
    if (!updates.length) {
      await interaction.editReply({ content: `Nothing to remove for **${name}**.` });
      return;
    }
    await (await import("./googleClients.js")).sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: cfg.google.sheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates }
    });
    await interaction.editReply({ content: `Removed **${name}** from your row.` });
    return;
  }
}
