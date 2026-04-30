const express = require("express");
const router = express.Router();
const {
  getPendingLeads,
  markLeadDone,
  getChannelPartners,
} = require("./sheetsHelper");

// ─── GET /api/leads ──────────────────────────────────────────────────────────
// Returns pending leads from Master (Planned != empty, Actual == empty)
// Query params: ?cp=ChannelPartnerName&from=2026-04-28&to=2026-04-29
router.get("/leads", async (req, res) => {
  try {
    const { cp, from, to } = req.query;
    let { data } = await getPendingLeads();

    // Filter by Channel Partner (Task column)
    if (cp && cp.trim()) {
      data = data.filter(
        (row) =>
          row["Task"] &&
          row["Task"].trim().toLowerCase() === cp.trim().toLowerCase(),
      );
    }

    // Filter by Planned date range
    if (from || to) {
      data = data.filter((row) => {
        const planned = parseSheetDate(row["Planned"]);
        if (!planned) return false;
        if (from && planned < new Date(from + "T00:00:00")) return false;
        if (to && planned > new Date(to + "T23:59:59")) return false;
        return true;
      });
    }

    // Map to frontend-friendly format
    const leads = data.map((row) => ({
      taskId: row["Task ID"] || "",
      name: row["Name"] || "",
      planned: row["Planned"] || "",
      task: row["Task"] || "", // Channel Partner Name
      freq: row["Freq"] || "",
      phoneNumber: row["Phone Number"] || "",
      status: row["Status"] || "",
      email: row["Email"] || "",
      department: row["Department"] || "",
      _rowIndex: row._rowIndex,
    }));

    res.json({ success: true, count: leads.length, leads });
  } catch (err) {
    console.error("GET /api/leads error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/leads/done ────────────────────────────────────────────────────
// Mark a lead as Done → update Master + append to Consolidated
// Body: { taskId, remark, leadDetails }
router.post("/leads/done", async (req, res) => {
  try {
    const { taskId, remark, leadDetails } = req.body;
    if (!taskId) {
      return res
        .status(400)
        .json({ success: false, error: "taskId is required" });
    }

    const result = await markLeadDone({ taskId, remark, leadDetails });
    res.json(result);
  } catch (err) {
    console.error("POST /api/leads/done error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/channel-partners ───────────────────────────────────────────────
// Returns distinct list of Channel Partner names for filter dropdown
router.get("/channel-partners", async (req, res) => {
  try {
    const partners = await getChannelPartners();
    res.json({ success: true, partners });
  } catch (err) {
    console.error("GET /api/channel-partners error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Parse date strings from Google Sheets (handles multiple formats)
 * "28 Apr 2026, 00:00:00" or "15/11/2025 11:40:00" or "28/04/2026 00:00:00"
 */
function parseSheetDate(dateStr) {
  if (!dateStr) return null;
  const str = dateStr.trim();

  // Format: "DD/MM/YYYY HH:MM:SS"
  const slashMatch = str.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (slashMatch) {
    const [, dd, mm, yyyy, hh, min, ss] = slashMatch;
    return new Date(
      parseInt(yyyy),
      parseInt(mm) - 1,
      parseInt(dd),
      parseInt(hh),
      parseInt(min),
      parseInt(ss),
    );
  }

  // Format: "DD/MM/YYYY"
  const slashShort = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashShort) {
    const [, dd, mm, yyyy] = slashShort;
    return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
  }

  // Format: "28 Apr 2026, 00:00:00" or "28 Apr 2026"
  const months = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const textMatch = str.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (textMatch) {
    const [, dd, mon, yyyy] = textMatch;
    const timeMatch = str.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (timeMatch) {
      return new Date(
        parseInt(yyyy),
        months[mon],
        parseInt(dd),
        parseInt(timeMatch[1]),
        parseInt(timeMatch[2]),
        parseInt(timeMatch[3]),
      );
    }
    return new Date(parseInt(yyyy), months[mon], parseInt(dd));
  }

  // Format: "YYYY-MM-DD" or ISO
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
  }

  // Fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = router;
