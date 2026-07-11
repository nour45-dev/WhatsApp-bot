const axios = require('axios');

function buildCsvUrl(sheetId, gid) {
  let url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  if (gid) url += `&gid=${gid}`;
  return url;
}

// Parser بسيط لملفات CSV (بيراعي الفواصل جوه علامات تنصيص "")
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
  return rows.filter(r => r.some(cell => cell !== ''));
}

// جوجل شيتس بيصدّر الخلايا المدمجة (Merged Cells) فاضية في كل الصفوف عدا الأولى.
// ده بيأثر غالبًا على عمود "اليوم" في جداول المواعيد (يوم واحد لصفوف كتير مجمّعة تحته).
// الدالة دي بتـ"نزّل" آخر قيمة معروفة على الصفوف الفاضية اللي بعدها.
function forwardFillMergedColumns(records, headers) {
  const mergedHeaders = headers.filter(h => h && h.includes('يوم'));
  if (!mergedHeaders.length) return records;

  const lastValues = {};
  return records.map(rec => {
    const newRec = { ...rec };
    mergedHeaders.forEach(h => {
      const val = (newRec[h] || '').toString().trim();
      if (val && val !== '-') {
        lastValues[h] = val;
      } else if (lastValues[h]) {
        newRec[h] = lastValues[h];
      }
    });
    return newRec;
  });
}

// بيحول الصفوف الخام لمصفوفة objects {header: value} عشان يبقى سهل البحث فيها
function rowsToObjects(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0];
  let records = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h || `عمود${i + 1}`] = r[i] || '';
    });
    return obj;
  });
  records = forwardFillMergedColumns(records, headers);
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
      return this.cache; // رجّع آخر نسخة متاحة لو التحديث فشل
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
