const { google } = require("googleapis");
require("dotenv").config();

// ─── Auth ────────────────────────────────────────────────────────────────────
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    token_uri: process.env.GOOGLE_TOKEN_URI,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read all rows from a sheet tab, return as array of objects keyed by header row
 */
async function getSheetData(sheetName) {
  try {
    console.log(
      `Fetching data from sheet: "${sheetName}", Spreadsheet: "${SPREADSHEET_ID}"`,
    );
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:Z1000`,
    });
    const rows = res.data.values || [];
    if (rows.length < 2) return { headers: rows[0] || [], data: [] };

    const headers = rows[0];
    const data = rows.slice(1).map((row, idx) => {
      const obj = { _rowIndex: idx + 2 };
      headers.forEach((h, i) => {
        obj[h] = row[i] || "";
      });
      return obj;
    });
    return { headers, data };
  } catch (err) {
    console.error(
      "Full error:",
      JSON.stringify(err.response?.data || err.message),
    );
    throw err;
  }
}

/**
 * Get pending leads from Master:
 *   - Planned is NOT empty
 *   - Actual IS empty
 */
async function getPendingLeads() {
  const { headers, data } = await getSheetData(process.env.MASTER_SHEET);
  const pending = data.filter(
    (row) =>
      row["Planned"] &&
      row["Planned"].trim() !== "" &&
      (!row["Actual"] || row["Actual"].trim() === ""),
  );
  return { headers, data: pending };
}

/**
 * Mark a lead as Done:
 *   1. Update Master row → set Actual = now, Status = Done
 *   2. Append to Consolidated sheet (Task id, Timestamp, Remark, Any lead details, Status, Channel Partner Name)
 */
async function markLeadDone({ taskId, remark, leadDetails }) {
  // Step 1: Find the row in Master by Task ID
  const { headers, data } = await getSheetData(process.env.MASTER_SHEET);
  const row = data.find(
    (r) => String(r["Task ID"]).trim() === String(taskId).trim(),
  );

  if (!row) {
    throw new Error(`Task ID ${taskId} not found in Master sheet`);
  }

  const rowIndex = row._rowIndex; // actual sheet row number
  const now = formatTimestamp(new Date());

  // Find column indices (0-based) for Actual and Status
  const actualColIdx = headers.indexOf("Actual");
  const statusColIdx = headers.indexOf("Status");

  if (actualColIdx === -1 || statusColIdx === -1) {
    throw new Error(
      "Could not find 'Actual' or 'Status' columns in Master sheet",
    );
  }

  // Build batch update for Master row
  const colLetter = (idx) => String.fromCharCode(65 + idx);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `${process.env.MASTER_SHEET}!${colLetter(actualColIdx)}${rowIndex}`,
          values: [[now]],
        },
        {
          range: `${process.env.MASTER_SHEET}!${colLetter(statusColIdx)}${rowIndex}`,
          values: [["Done"]],
        },
      ],
    },
  });

  // Step 2: Append to Consolidated sheet
  // Consolidated columns: Task id | Timestamp | Remark | Any lead details | Status | Channel Partner Name
  const cpName = row["Task"] || ""; // "Task" column in Master = Channel Partner Name
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${process.env.CONSOLIDATED_SHEET}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[taskId, now, remark || "", leadDetails || "", "Done", cpName]],
    },
  });

  return { success: true, taskId, actualTimestamp: now };
}

/**
 * Get distinct Channel Partner (Task) names for filter dropdown
 */
async function getChannelPartners() {
  const { data } = await getSheetData(process.env.MASTER_SHEET);
  const cpSet = new Set();
  data.forEach((row) => {
    if (row["Task"] && row["Task"].trim()) cpSet.add(row["Task"].trim());
  });
  return Array.from(cpSet).sort();
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatTimestamp(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

module.exports = {
  getSheetData,
  getPendingLeads,
  markLeadDone,
  getChannelPartners,
};
