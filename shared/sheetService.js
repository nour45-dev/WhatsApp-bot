const axios = require('axios');

function buildCsvUrl(sheetId, gid) {
  let url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  if (gid) url += `&gid=${gid}`;
  return url;
}

// Parser بسيط لملفات CSV (بيراعي الفواصل جوه علامات تنصيص "")
// ملحوظة: بيحتفظ بالصفوف الفاضية كمان (عكس النسخة القديمة) عشان نستخدمها كـ"حواجز"
// بين مجموعات الأيام المختلفة في forward-fill بدل ما نخلط بينهم.
function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function isBlankRow(row) {
  return row.every(cell => !cell || cell.toString().trim() === '');
}

// بيحول الصفوف الخام لمصفوفة objects {header: value}، مع تعبئة تلقائية للخلايا
// المدمجة (زي عمود اليوم) لكن بحدود: لو فيه صف فاضي (حاجز بين مجموعتين)،
// بنصفّر القيم المحفوظة عشان مانورّيش يوم غلط لمجموعة تانية (نسيب الخانة فاضية
// بدل ما نخمن غلط - أأمن للعميل).
function rowsToObjects(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const mergedHeaders = headers.filter(h => h && h.includes('يوم'));

  const lastValues = {};
  const records = [];

  dataRows.forEach(r => {
    if (isBlankRow(r)) {
      // حاجز بين مجموعتين - نصفّر الذاكرة عشان مايحصلش تسريب من مجموعة لمجموعة
      Object.keys(lastValues).forEach(k => delete lastValues[k]);
      return;
    }

    const obj = {};
    headers.forEach((h, i) => {
      obj[h || `عمود${i + 1}`] = r[i] || '';
    });

    mergedHeaders.forEach(h => {
      const val = (obj[h] || '').toString().trim();
      if (val && val !== '-') {
        lastValues[h] = val;
      } else if (lastValues[h]) {
        obj[h] = lastValues[h];
      }
      // لو مفيش قيمة محفوظة (زي أول صف بعد حاجز فاضي)، الخانة بتفضل فاضية عمدًا
    });

    records.push(obj);
  });

  return { headers, records };
}

function recordsToReadableText(records) {
  if (!records.length) return 'لا توجد بيانات في الجدول حاليًا.';
  return records
    .map((rec, idx) => {
      const parts = Object.entries(rec).map(([k, v]) => `${k}: ${v || '-'}`);
      return `${idx + 1}) ${parts.join(' | ')}`;
    })
    .join('\n');
}

class SheetService {
  constructor({ sheetId, gid, refreshMinutes = 5 }) {
    this.sheetId = sheetId;
    this.gid = gid;
    this.refreshMs = refreshMinutes * 60 * 1000;
    this.cache = { headers: [], records: [] };
    this.lastFetch = 0;
  }

  async refresh(force = false) {
    const isStale = Date.now() - this.lastFetch > this.refreshMs;
    if (!force && this.cache.records.length && !isStale) {
      return this.cache;
    }
    try {
      const url = buildCsvUrl(this.sheetId, this.gid);
      const res = await axios.get(url, { responseType: 'text', timeout: 15000 });
      const rows = parseCsv(res.data);
      this.cache = rowsToObjects(rows);
      this.lastFetch = Date.now();
      console.log(`[Sheet] تم تحديث بيانات الجدول (${this.cache.records.length} صف)`);
      return this.cache;
    } catch (err) {
      console.error('[Sheet] فشل تحديث الشيت:', err.message);
      return this.cache;
    }
  }

  async getRecords() {
    const { records } = await this.refresh();
    return records;
  }

  async getReadableText() {
    const { records } = await this.refresh();
    return recordsToReadableText(records);
  }
}

module.exports = SheetService;
