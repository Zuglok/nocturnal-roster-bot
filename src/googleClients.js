import { google } from "googleapis";
import { cfg } from "./config.js";

const jwt = new google.auth.JWT({
  email: cfg.google.clientEmail,
  key: cfg.google.privateKey,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ],
});

export const sheets = google.sheets({ version: "v4", auth: jwt });
export const drive  = google.drive({ version: "v3", auth: jwt });
