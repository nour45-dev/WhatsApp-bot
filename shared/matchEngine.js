// ==========================================================
// محرك بحث ذكي "بدون" استخدام أي AI مدفوع
// مطابقة تقريبية + ذاكرة محادثة + توضيح تدريجي (صف ثم يوم لو لزم) + عرض احترافي
// ==========================================================

const { MENU_TRIGGER_WORDS, buildMenuTextForQr, matchMenuSelection } = require('./menu');

const STOP_WORDS = new Set([
  'في', 'من', 'الى', 'إلى', 'على', 'عن', 'مع', 'هل', 'يا',
  'ايه', 'إيه', 'اي', 'إي', 'ازاي', 'إزاي', 'امتى', 'إمتى', 'متى',
  'فين', 'ممكن', 'لو', 'سمحت', 'تمام', 'اهلا', 'أهلا', 'استاذ',
  'أستاذ', 'الاستاذ', 'الأستاذ', 'مدرس', 'المدرس',
  'معاد', 'ميعاد', 'مواعيد', 'الجدول', 'جدول', 'انا', 'أنا', 'حضرتك',
  'بتاع', 'بتاعت', 'عايز', 'عايزة', 'محتاج', 'محتاجة', 'اعرف', 'أعرف',
]);

const ISLAMIC_GREETINGS = ['السلام عليكم', 'سلام عليكم'];
const GREETINGS = [
  'اهلا', 'أهلا', 'هاي', 'هلا',
  'ازيك', 'إزيك', 'صباح الخير', 'مساء الخير', 'مرحبا',
];
const THANKS_WORDS = ['شكرا', 'متشكر', 'تسلم', 'يعطيك العافيه', 'مشكور', 'الله يخليك', 'ربنا يخليك'];
const FAREWELL_WORDS = ['مع السلامه', 'باي', 'تصبح على خير', 'وداعا'];
const IDENTITY_WORDS = ['انت مين', 'مين انت', 'انت بشر', 'انت روبوت', 'انت انسان', 'مين بيرد'];
const FULL_LIST_TRIGGERS = ['الجدول كله', 'كل المواعيد', 'كل الجدول', 'عرض الجدول', 'شوف الجدول'];

const FOLLOW_UP_FIELDS = [
  { keywords: ['امتى', 'إمتى', 'الساعه', 'ساعه', 'وقت', 'معاد', 'ميعاد'], headerMatch: ['ميعاد', 'وقت', 'ساعه'] },
  { keywords: ['فين', 'مكان', 'قاعه', 'فرع', 'مكانه'], headerMatch: ['قاعه', 'مكان', 'فرع'] },
  { keywords: ['يوم', 'ايام'], headerMatch: ['يوم'] },
  { keywords: ['ماده', 'مادته'], headerMatch: ['ماده'] },
];

// أعمدة "السنة/الصف الدراسي"
const GRADE_HEADER_KEYWORDS = ['صف', 'سنه', 'مرحله'];

// كلمات ترتيبية بتتحول لأرقام عشان نفهم "تالته ثانوي" = "3ث"
const ORDINAL_TO_DIGIT = {
  'الاولي': '1', 'اولي': '1', 'الاول': '1', 'اول': '1',
  'الثانيه': '2', 'ثانيه': '2', 'الثاني': '2', 'ثاني': '2', 'التانيه': '2', 'تانيه': '2', 'تاني': '2',
  'الثالثه': '3', 'ثالثه': '3', 'الثالث': '3', 'ثالث': '3', 'التالته': '3', 'تالته': '3', 'تالت': '3',
  'الرابعه': '4', 'رابعه': '4', 'الرابع': '4', 'رابع': '4',
  'الخامسه': '5', 'خامسه': '5', 'الخامس': '5', 'خامس': '5',
};
const STAGE_WORDS = ['ثانوي', 'ثانويه', 'اعدادي', 'اعداديه', 'ابتدائي', 'ابتدائيه'];

// تسميات أنيقة للعرض الاحترافي
const LABEL_RULES = [
  { keys: ['اسم', 'مدرس', 'استاذ'], label: '👨‍🏫 المدرس' },
  { keys: ['ماده'], label: '📚 المادة' },
  { keys: ['صف', 'سنه', 'مرحله'], label: '🎓 الصف' },
  { keys: ['يوم'], label: '📅 اليوم' },
  { keys: ['ميعاد', 'وقت', 'ساعه'], label: '🕒 الميعاد' },
  { keys: ['قاعه', 'مكان', 'فرع'], label: '🏫 القاعة' },
];

// ترتيب أولوية الأسئلة التوضيحية اللي بيسألها البوت لما يكون فيه أكتر من نتيجة.
// الصف بس هو اللي بنسأل عنه فعليًا (لأن اختياره غلط = معلومة غلط تمامًا).
// اليوم والميعاد بقوا بيتجمعوا/يتعرضوا تلقائيًا (شوف groupRecordsByDay + resolveCandidates)
// من غير أسئلة زيادة، لأن أكتر من يوم/ميعاد مش "اختيار محتاج توضيح" - كلهم معلومة صحيحة.
const DISCRIMINATING_FIELDS = [
  {
    headerKeywords: GRADE_HEADER_KEYWORDS,
    matches: (msg, val) => gradeMatches(msg, val),
    askText: (teacherName, values) => `تمام 👍 ${teacherName} بيدرّس أكتر من صف (${values.join(' - ')}).\nانت في صف/سنة كام عشان أبعتلك المعاد الصحيح؟`,
  },
];

const ISLAMIC_GREETING_REPLIES = [
  (biz) => `وعليكم السلام ورحمة الله وبركاته 😊 أهلًا بيك في ${biz}!`,
  (biz) => `وعليكم السلام ورحمة الله وبركاته 🌸 يا هلا بيك في ${biz}.`,
];
const GREETING_REPLIES = [
  (biz) => `أهلًا بيك في ${biz} 👋`,
  (biz) => `أهلين! 😊 معاك ${biz}، تحت أمرك.`,
  (biz) => `يا هلا بيك 👋 معاك ${biz}.`,
];
const MULTI_MATCH_INTROS = ['لقيت أكتر من نتيجة قريبة من سؤالك:', 'عندي أكتر من خيار ممكن يكون ده اللي محتاجه:'];
const THANKS_REPLIES = ['العفو! 🙏 تحت أمرك في أي وقت.', 'ولا يهمك، أنا موجود لو محتاج أي حاجة تانية 😊', 'الله يخليك، اتفضل لو عندك سؤال تاني.'];
const FAREWELL_REPLIES = ['مع السلامة 👋 ولو احتجت حاجة أنا موجود.', 'تصبح على خير 🌙 اتفضل تكلمني في أي وقت.'];
const IDENTITY_REPLIES = [
  (biz) => `أنا مساعد ${biz} 🎓 موجود عشان أساعدك تعرف مواعيد المدرسين والحصص بسرعة، تحب تسأل عن إيه؟`,
  (biz) => `معاك المساعد الخاص بـ ${biz} 😊 هنا عشان أوفرلك وقت البحث عن المواعيد، اسأل براحتك.`,
];
const FALLBACK_REPLIES = [
  (name, phone) => `معلش، مقدرتش ألاقي إجابة دقيقة لسؤالك 🙏\nتقدر تتواصل مباشرة مع ${name} على الرقم ${phone} وهيساعدك حالًا.`,
  (name, phone) => `آسف، مش متأكد من الإجابة دي عشان متضمنش تجيبلك معلومة غلط 🙏\nكلم ${name} على ${phone} وهيفيدك أحسن.`,
];

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function normalizeArabic(text) {
  if (!text) return '';
  return text.toString()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[^\u0600-\u06FF0-9a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// نسخة أبسط بتشيل "ال" التعريف كمان، مفيدة لمطابقة أيام زي "سبت" مقابل "السبت"
function normalizeSimple(text) {
  return normalizeArabic(text).replace(/^ال/, '').replace(/\s+/g, '');
}

function tokenize(text) {
  const withDigits = replaceOrdinalWords(normalizeArabic(text));
  return withDigits.split(' ').filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function columnWeight(header) {
  const h = normalizeArabic(header);
  if (h.includes('اسم') || h.includes('مدرس') || h.includes('استاذ')) return 3;
  if (h.includes('ماده') || h.includes('مجموعه') || h.includes('صف')) return 2;
  return 1;
}

function findEntryByHeaderMatch(record, keywords) {
  return Object.entries(record).find(([header]) => {
    const h = normalizeArabic(header);
    return keywords.some(k => h.includes(k));
  });
}

function getTeacherName(record) {
  const entry = Object.entries(record).find(([h]) => columnWeight(h) === 3);
  return entry ? entry[1] : '';
}

// بعض قيم "الميعاد" في الشيت مكتوبة بفاصل ":" بمعنى "من - إلى" (مثال: "9:12" يعني من 9 لـ12)
// مش وقت ساعة:دقيقة، وده بيلخبط العميل. الدالة دي بتحول الصيغة لحاجة واضحة "من 9 إلى 12".
function formatTimeValue(raw) {
  const s = (raw || '').toString().trim();
  const m = s.match(/^(\d{1,2}(?:\.\d{1,2})?)\s*:\s*(\d{1,2}(?:\.\d{1,2})?)$/);
  if (!m) return s;
  const toClock = (p) => p.includes('.') ? p.replace('.', ':') : p;
  return `من ${toClock(m[1])} إلى ${toClock(m[2])}`;
}

// بيدمج مصفوفة أيام في جملة عربية طبيعية: "السبت" أو "السبت والثلاثاء" أو "السبت والاحد والثلاثاء"
function joinArabicList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} و${items[1]}`;
  return `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;
}

// بتجمع نتايج متطابقة في كل حاجة ما عدا "اليوم" في نتيجة واحدة بأيام مدمجة.
// مثال: (سبت، 9-11) + (ثلاثاء، 9-11) => نتيجة واحدة "السبت والثلاثاء" بدل اتنين منفصلين.
// لو مفيش عمود "يوم" أصلاً، أو مفيش تكرار حقيقي، بترجع النتايج زي ما هي من غير تغيير.
function groupRecordsByDay(records) {
  if (!records.length) return records;
  const dayEntry = findEntryByHeaderMatch(records[0], ['يوم']);
  if (!dayEntry) return records;
  const dayHeader = dayEntry[0];

  const groups = [];
  records.forEach(r => {
    const signature = Object.keys(r)
      .filter(h => h !== dayHeader)
      .map(h => (r[h] || '').toString().trim())
      .join('|');
    let group = groups.find(g => g.signature === signature);
    if (!group) {
      group = { signature, days: [], base: r };
      groups.push(group);
    }
    const dayVal = (r[dayHeader] || '').toString().trim();
    if (dayVal && !group.days.includes(dayVal)) group.days.push(dayVal);
  });

  return groups.map(g => ({ ...g.base, [dayHeader]: joinArabicList(g.days) }));
}

const ALL_TRIGGERS_REGEX = /كل|كله|كلهم|اثنين|يومين|الاتنين|كلهم يعني/;
const DAY_ORDER = ['السبت', 'الاحد', 'الأحد', 'الاتنين', 'الإثنين', 'الثلاثاء', 'الاربعاء', 'الأربعاء', 'الخميس', 'الجمعة'];

// بيعرض مجموعة سجلات مقسّمة على أيام، كل يوم لوحده، عشان جدول صف كامل يبان مرتب واحترافي
function groupAndListByDay(records) {
  const dayEntry = findEntryByHeaderMatch(records[0], ['يوم']);
  if (!dayEntry) return listRecords(records);
  const dayHeader = dayEntry[0];

  const sorted = [...records].sort((a, b) => DAY_ORDER.indexOf(a[dayHeader]) - DAY_ORDER.indexOf(b[dayHeader]));
  const groups = [];
  for (const r of sorted) {
    const day = r[dayHeader] || 'غير محدد';
    let group = groups.find(g => g.day === day);
    if (!group) { group = { day, items: [] }; groups.push(group); }
    group.items.push(r);
  }
  return groups
    .map(g => `📅 *${g.day}*\n${g.items.map(r => formatRecordPro(r)).join('\n\n')}`)
    .join('\n\n──────\n\n');
}

function getLabel(header) {
  const h = normalizeArabic(header);
  const rule = LABEL_RULES.find(r => r.keys.some(k => h.includes(k)));
  return rule ? rule.label : `• ${header}`;
}

// عرض احترافي: بيخفي أي حقل فاضي أو "-"، وبيوضّح صيغة الميعاد، وبيخلي اسم الحقل Bold (نجمة واتساب الحقيقية)
function formatRecordPro(record) {
  return Object.entries(record)
    .filter(([, v]) => v && v.toString().trim() !== '' && v.toString().trim() !== '-')
    .map(([k, v]) => {
      const label = getLabel(k);
      const isTimeField = normalizeArabic(k).match(/ميعاد|وقت|ساعه/);
      const value = isTimeField ? formatTimeValue(v) : v;
      return `*${label}:* ${value}`;
    })
    .join('\n');
}

function containsAny(normalizedText, wordsArr) {
  return wordsArr.some(w => normalizedText.includes(normalizeArabic(w)));
}

// بيحول كلمات زي "تالته ثانوي" أو "٣ث" لصيغة موحدة عشان المقارنة
function normalizeGradeText(text) {
  let t = normalizeArabic(text);
  for (const [word, digit] of Object.entries(ORDINAL_TO_DIGIT)) {
    t = t.split(word).join(digit);
  }
  return t.replace(/\s+/g, '');
}

// بيحول كلمات ترتيبية كاملة لأرقام مع الحفاظ على الفواصل بين الكلمات
function replaceOrdinalWords(normalizedText) {
  let result = normalizedText;
  for (const [word, digit] of Object.entries(ORDINAL_TO_DIGIT)) {
    result = result.replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`, 'g'), `$1${digit}`);
  }
  return result;
}

// بيدور جوه رسالة (حتى لو طويلة زي "مصطفى صابر 1") على أجزاء شبه "رقم الصف"
// من غير ما يلزق الجملة كلها في نص واحد (وده كان بيمنع اكتشاف الرقم لوحده في آخر الجملة)
function extractGradeTokens(message) {
  const normalized = replaceOrdinalWords(normalizeArabic(message));
  const words = normalized.split(' ').filter(Boolean);
  const candidates = [];
  words.forEach((w, i) => {
    if (/^[0-9]/.test(w)) {
      candidates.push(w);
      if (words[i + 1] && /^[a-zء-ي]/.test(words[i + 1]) && words[i + 1].length <= 3) {
        candidates.push(w + words[i + 1]); // زي "3" + "ث" مكتوبين منفصلين
      }
    } else if (STAGE_WORDS.some(sw => w.includes(sw))) {
      candidates.push(w);
    }
  });
  return candidates;
}

// مطابقة الصف: بتستخرج الأجزاء اللي شكلها "صف" من الرسالة وتقارنها بقيمة الشيت
// (بتشتغل صح سواء الرسالة "تانية" لوحدها أو "مصطفى صابر 1" فيها اسم كمان)
function gradeMatches(userMessage, candidateGradeValue) {
  if (!candidateGradeValue) return false;
  const candNorm = normalizeGradeText(candidateGradeValue);
  if (!candNorm) return false;

  const tokens = extractGradeTokens(userMessage);
  if (!tokens.length) return false;

  return tokens.some(t => t === candNorm || candNorm.includes(t) || t.includes(candNorm) || similarity(t, candNorm) >= 0.75);
}

// مطابقة عامة لحقول زي اليوم/الميعاد (نصوص عادية، مش محتاجة تحويل ترتيبي)
function fieldTextMatches(userMessage, candidateValue) {
  if (!candidateValue) return false;
  const u = normalizeSimple(userMessage);
  const c = normalizeSimple(candidateValue);
  if (!u || !c) return false;
  return u.includes(c) || c.includes(u) || similarity(u, c) >= 0.75;
}

// هل الرسالة بتذكر اسم مدرس موجود في البيانات؟ (بتفرق بين "سؤال جديد" و"رد على سؤال معلّق")
function hasTeacherNameMention(tokens, records) {
  if (!tokens.length) return false;
  const nameTokens = new Set();
  records.forEach(rec => {
    Object.entries(rec).forEach(([header, value]) => {
      if (columnWeight(header) === 3) {
        tokenize(value).forEach(t => nameTokens.add(t));
      }
    });
  });
  const nameTokensArr = [...nameTokens];
  return tokens.some(qt => nameTokensArr.some(nt =>
    nt === qt || nt.includes(qt) || qt.includes(nt) || similarity(nt, qt) >= 0.8
  ));
}

// بيلاقي أول حقل (بترتيب الأولوية) لسه مختلف بين المرشحين، عشان نسأل عنه
function findNextDiscriminatingField(candidates) {
  for (const field of DISCRIMINATING_FIELDS) {
    const values = candidates.map(r => {
      const e = findEntryByHeaderMatch(r, field.headerKeywords);
      return e ? e[1] : null;
    }).filter(Boolean);
    const distinct = [...new Set(values)];
    if (distinct.length > 1) {
      return { ...field, distinctValues: distinct };
    }
  }
  return null;
}

// بيفلتر مرشحين بناءً على أي حقل تمييزي اترد فيه المستخدم (صف، يوم، ميعاد...)
function narrowCandidatesByMessage(userMessage, candidates) {
  let narrowed = candidates;
  for (const field of DISCRIMINATING_FIELDS) {
    const filtered = narrowed.filter(r => {
      const e = findEntryByHeaderMatch(r, field.headerKeywords);
      return e && field.matches(userMessage, e[1]);
    });
    if (filtered.length && filtered.length < narrowed.length) {
      narrowed = filtered;
    }
  }
  return narrowed;
}

function listRecords(records) {
  const grouped = groupRecordsByDay(records);
  return grouped.map((r, i) => `${i + 1})\n${formatRecordPro(r)}`).join('\n\n');
}

class MatchEngine {
  constructor({ adminName, adminPhone, businessName }) {
    this.adminName = adminName;
    this.adminPhone = adminPhone;
    this.businessName = businessName;
  }

  fallbackMessage() {
    return pickRandom(FALLBACK_REPLIES)(this.adminName, this.adminPhone);
  }

  scoreRecords(records, tokens) {
    return records.map(record => {
      let score = 0;
      for (const [header, value] of Object.entries(record)) {
        const cellTokens = tokenize(value);
        const weight = columnWeight(header);
        for (const qToken of tokens) {
          for (const cToken of cellTokens) {
            if (cToken === qToken) score += 2 * weight;
            else if (cToken.includes(qToken) || qToken.includes(cToken)) score += 1 * weight;
            else if (similarity(cToken, qToken) >= 0.75) score += 0.7 * weight;
          }
        }
      }
      return { record, score };
    });
  }

  tryFollowUp(normalizedMessage, lastRecord) {
    if (!lastRecord) return null;
    for (const field of FOLLOW_UP_FIELDS) {
      if (containsAny(normalizedMessage, field.keywords)) {
        const entry = findEntryByHeaderMatch(lastRecord, field.headerMatch);
        if (entry) {
          const nameText = getTeacherName(lastRecord);
          return `${entry[0]} بتاع ${nameText}: ${entry[1]}`;
        }
      }
    }
    return null;
  }

  // بيحاول يفلتر مجموعة مرشحين (من سؤال سابق أو من سؤال جديد) لحد ما يوصل لنتيجة واحدة،
  // ولو لسه أكتر من واحد، بيسأل عن أول حقل تمييزي متاح (صف، بعدين يوم، بعدين ميعاد)
  resolveCandidates(userMessage, candidates) {
    const teacherName = getTeacherName(candidates[0]);
    let narrowed = narrowCandidatesByMessage(userMessage, candidates);

    if (narrowed.length === 1) {
      return { text: formatRecordPro(narrowed[0]), record: narrowed[0], pending: null };
    }

    // بدل ما نسأل "يوم إيه؟"، بندمج النتايج المتطابقة في كل حاجة ما عدا اليوم (مهما كان عددها)
    const grouped = groupRecordsByDay(narrowed);

    if (grouped.length === 1) {
      return {
        text: `تمام 👍 ${teacherName} بيدّيلكم الحصة دي أكتر من يوم:\n\n${formatRecordPro(grouped[0])}`,
        record: narrowed[0],
        pending: null,
      };
    }

    // لو العميل من نفس الرسالة قال "كلها/الكل" (زي "مواعيد مستر أحمد 3ث كلها")، متسألش تاني واعرض كل حاجة على طول
    if (grouped.length > 1 && ALL_TRIGGERS_REGEX.test(normalizeArabic(userMessage))) {
      return { text: `تمام 👍 ${teacherName} بيدّيلكم أكتر من حصة:\n\n${listRecords(grouped)}`, record: null, pending: null };
    }

    const nextField = findNextDiscriminatingField(grouped);
    if (nextField) {
      return { text: nextField.askText(teacherName, nextField.distinctValues), record: null, pending: narrowed };
    }

    // الصف اتأكد وواضح - المتبقي مجرد أكتر من حصة/ميعاد لنفس المدرس، مش اختيار غامض محتاج سؤال
    return {
      text: `تمام 👍 ${teacherName} بيدّيلكم أكتر من حصة:\n\n${listRecords(grouped)}`,
      record: null,
      pending: null,
    };
  }

  /**
   * @param {string} userMessage
   * @param {Array<object>} records
   * @param {string} readableFullText
   * @param {{ lastRecord: object|null, pendingCandidates: Array<object>|null }} context
   * @returns {{ text: string, record: object|null, pending: Array<object>|null }}
   */
  getReply(userMessage, records, readableFullText, context = {}) {
    const { lastRecord = null, pendingCandidates = null } = context;
    const normalized = normalizeArabic(userMessage);

    if (containsAny(normalized, ISLAMIC_GREETINGS)) {
      const greeting = pickRandom(ISLAMIC_GREETING_REPLIES)(this.businessName);
      return { text: `${greeting}\n\n${buildMenuTextForQr(this.businessName)}`, record: null, pending: null, showMenu: true };
    }
    if (containsAny(normalized, GREETINGS)) {
      const greeting = pickRandom(GREETING_REPLIES)(this.businessName);
      return { text: `${greeting}\n\n${buildMenuTextForQr(this.businessName)}`, record: null, pending: null, showMenu: true };
    }
    if (containsAny(normalized, IDENTITY_WORDS)) {
      return { text: pickRandom(IDENTITY_REPLIES)(this.businessName), record: null, pending: null };
    }
    if (containsAny(normalized, THANKS_WORDS)) {
      return { text: pickRandom(THANKS_REPLIES), record: null, pending: null };
    }
    if (containsAny(normalized, FAREWELL_WORDS)) {
      return { text: pickRandom(FAREWELL_REPLIES), record: null, pending: null };
    }
    if (containsAny(normalized, MENU_TRIGGER_WORDS)) {
      return { text: buildMenuTextForQr(this.businessName), record: null, pending: null, showMenu: true };
    }
    if (containsAny(normalized, FULL_LIST_TRIGGERS)) {
      if (readableFullText.length > 3500) {
        return { text: 'الجدول كبير شوية 🙏 قوللي اسم المدرس أو المادة اللي محتاج تعرف معادها وهبعتلك التفاصيل على طول.', record: null, pending: null };
      }
      return { text: readableFullText, record: null, pending: null };
    }

    const tokens = tokenize(userMessage);
    const mentionsTeacher = hasTeacherNameMention(tokens, records);

    // سؤال "صف/سنة + مرحلة" صريح (زي "اولي ثانوي" أو "تالتة اعدادي") من غير ذكر اسم مدرس -
    // بنستخدم نفس منطق مطابقة الصف الدقيق (gradeMatches) بدل البحث العام، عشان رقم زي "1"
    // مايتلخبطش مع أرقام تانية زي المواعيد أو القاعات
    if (!mentionsTeacher && STAGE_WORDS.some(sw => normalized.includes(sw))) {
      const gradeEntry = findEntryByHeaderMatch(records[0], ['صف']);
      if (gradeEntry) {
        const gradeHeader = gradeEntry[0];
        const gradeMatchedRecords = records.filter(r => gradeMatches(userMessage, r[gradeHeader]));
        if (gradeMatchedRecords.length) {
          const gradeValue = gradeMatchedRecords[0][gradeHeader];
          return {
            text: `تمام 👍 ده جدول *${gradeValue}* بالكامل (${gradeMatchedRecords.length} حصة):\n\n${groupAndListByDay(gradeMatchedRecords)}`,
            record: null,
            pending: null,
          };
        }
      }
    }

    // لو فيه سؤال معلّق (صف/يوم) والرسالة مش بتذكر اسم مدرس جديد، جرب تحل السؤال المعلّق الأول
    // (الأولوية للسؤال المعلّق قبل تفسير الرقم كاختيار من القائمة الرئيسية)
    if (pendingCandidates && pendingCandidates.length && !mentionsTeacher) {
      const narrowed = narrowCandidatesByMessage(userMessage, pendingCandidates);
      if (narrowed.length && narrowed.length < pendingCandidates.length) {
        return this.resolveCandidates(userMessage, narrowed);
      }

      // العميل عايز يشوف كل الخيارات المعلّقة مرة واحدة (زي "هات الاتنين" أو "كل الخيارات")
      if (ALL_TRIGGERS_REGEX.test(normalized)) {
        return { text: listRecords(pendingCandidates), record: null, pending: null };
      }

      // الرد مش واضح بالنسبة للسؤال المعلّق - نعيد نفس السؤال بدل ما نخمن من سياق قديم غلط
      const teacherName = getTeacherName(pendingCandidates[0]);
      const nextField = findNextDiscriminatingField(pendingCandidates);
      if (nextField) {
        return { text: `معلش مقدرتش أفهم قصدك بالظبط 🙏\n${nextField.askText(teacherName, nextField.distinctValues)}`, record: null, pending: pendingCandidates };
      }
    }

    // اختيار رقم من القائمة الرئيسية (1-4) - بس لو مفيش سؤال معلّق شغال دلوقتي
    const menuChoice = matchMenuSelection(userMessage);
    if (menuChoice) {
      if (menuChoice.id === 'full_schedule') {
        if (readableFullText.length > 3500) {
          return { text: 'الجدول كبير شوية 🙏 قوللي اسم المدرس أو المادة اللي محتاج تعرف معادها.', record: null, pending: null };
        }
        return { text: readableFullText, record: null, pending: null };
      }
      return { text: menuChoice.hint, record: null, pending: null };
    }

    if (tokens.length) {
      const scored = this.scoreRecords(records, tokens).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
      if (scored.length) {
        const topScore = scored[0].score;
        const allTopMatches = scored.filter(s => s.score >= topScore * 0.8).map(s => s.record);
        const topMatches = allTopMatches.slice(0, 8);

        if (topMatches.length === 1) {
          return { text: formatRecordPro(topMatches[0]), record: topMatches[0], pending: null };
        }

        const sameTeacher = topMatches.every(r => getTeacherName(r) === getTeacherName(topMatches[0]));
        if (sameTeacher) {
          return this.resolveCandidates(userMessage, topMatches);
        }

        // بحث بالصف/السنة بحته (كل النتايج نفس الصف بس مدرسين ومواد مختلفة) - ده مش "اختار واحد"،
        // العميل عايز يشوف جدول الصف ده كله، فمنعرضهوش منقوص أو نطلب توضيح، نعرضه كامل مقسم على أيام
        const gradeEntry = findEntryByHeaderMatch(allTopMatches[0], ['صف']);
        const sameGrade = gradeEntry && allTopMatches.every(r => (r[gradeEntry[0]] || '').trim() === (allTopMatches[0][gradeEntry[0]] || '').trim());
        if (sameGrade) {
          return {
            text: `تمام 👍 ده جدول *${allTopMatches[0][gradeEntry[0]]}* بالكامل (${allTopMatches.length} حصة):\n\n${groupAndListByDay(allTopMatches)}`,
            record: null,
            pending: null,
          };
        }

        // نتايج لمدرسين مختلفين (تشابه أسماء) - اعرضهم كلهم واطلب توضيح
        return {
          text: `${pickRandom(MULTI_MATCH_INTROS)}\n\n${listRecords(topMatches)}\n\nلو تقصد واحد منهم قوللي أكتر تفاصيل عشان أأكدلك.`,
          record: null,
          pending: null,
        };
      }
    }

    const followUp = this.tryFollowUp(normalized, lastRecord);
    if (followUp) {
      return { text: followUp, record: lastRecord, pending: null };
    }

    return { text: this.fallbackMessage(), record: null, pending: null, isFallback: true };
  }
}

module.exports = MatchEngine;
