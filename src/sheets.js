import { sheets } from "./googleClients.js";
import { cfg } from "./config.js";

export const ROSTER_SHEET_NAME = "Roster";
let rosterSheetIdCache = null;

export async function getRosterSheetId() {
  if (rosterSheetIdCache) return rosterSheetIdCache;
  const res = await sheets.spreadsheets.get({ spreadsheetId: cfg.google.sheetId });
  const sheet = res.data.sheets.find(s => s.properties.title === ROSTER_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${ROSTER_SHEET_NAME}" not found`);
  rosterSheetIdCache = sheet.properties.sheetId;
  return rosterSheetIdCache;
}

export function colIndexToA1(colIdx1) {
  let n = colIdx1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export async function getColumnAValuesAndNotes() {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: cfg.google.sheetId,
    ranges: [`${ROSTER_SHEET_NAME}!A:A`],
    includeGridData: true,
  });
  const data = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const cell = data[i]?.values?.[0] || {};
    out.push({
      rowNumber: i + 1,
      valueText: (cell.formattedValue || "").trim(),
      noteText:  (cell.note || "").trim()
    });
  }
  return out;
}

export function getDiscordIdFromNote(note) {
  const m = (note || "").match(/^\s*Discord ID\s*:\s*(\d+)\s*$/mi);
  return m ? m[1] : null;
}

export async function findRowByDiscordIdOrDisplayName(discordId, displayName) {
  const rows = await getColumnAValuesAndNotes();
  for (const r of rows) {
    const idInNote = getDiscordIdFromNote(r.noteText);
    if (idInNote && idInNote === String(discordId)) {
      return { rowNumber: r.rowNumber, foundBy: "id" };
    }
  }
  for (const r of rows) {
    if (r.valueText && r.valueText === displayName) {
      return { rowNumber: r.rowNumber, foundBy: "name" };
    }
  }
  return { rowNumber: null, foundBy: null };
}

export async function appendRosterRow(displayName) {
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.google.sheetId,
    range: `${ROSTER_SHEET_NAME}!A:A`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[displayName]] },
  });
  const updated = res.data.updates?.updatedRange || "";
  const m = updated.match(/!(?:[A-Z]+)(\d+):/);
  if (m) return parseInt(m[1], 10);
  const rows = await getColumnAValuesAndNotes();
  const f = rows.find(r => r.valueText === displayName);
  return f ? f.rowNumber : null;
}

export async function updateCellA1(a1, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.google.sheetId,
    range: a1,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });
}

export async function readSingleCellNoteA1(a1) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: cfg.google.sheetId,
    ranges: [a1],
    includeGridData: true,
  });
  const v = res.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0];
  return (v && v.note) ? v.note : "";
}

export async function writeSingleCellNoteByRC(sheetId, row0, col0, note) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: cfg.google.sheetId,
    requestBody: {
      requests: [{
        updateCells: {
          range: { sheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
          rows: [{ values: [{ note }] }],
          fields: "note"
        }
      }]
    }
  });
}

export function upsertNoteLines(existingNote, kv) {
  const lines = (existingNote || "").split(/\r?\n/).filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) map.set(m[1].trim(), m[2]); else map.set(line, "");
  }
  for (const [k, v] of Object.entries(kv)) {
    if (v === undefined || v === null || v === "") continue;
    map.set(k, String(v));
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}: ${v}`).join("\n");
}

export async function ensureIdentityOnColumnA(rowNumber, currentDisplayName, discordId) {
  const sheetId = await getRosterSheetId();
  // note with Discord ID
  const a1 = `${ROSTER_SHEET_NAME}!A${rowNumber}:A${rowNumber}`;
  const existingANote = await readSingleCellNoteA1(a1);
  const newNote = upsertNoteLines(existingANote, { "Discord ID": discordId });
  await writeSingleCellNoteByRC(sheetId, rowNumber - 1, 0, newNote);
  // visible value as current display name
  await updateCellA1(`${ROSTER_SHEET_NAME}!A${rowNumber}`, currentDisplayName);
}
