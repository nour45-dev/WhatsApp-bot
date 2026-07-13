require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');

const SheetService = require('../shared/sheetService');
const MatchEngine = require('../shared/matchEngine');
const AiFallback = require('../shared/aiFallback');
const { createServer, setQr, setStatus } = require('./server');

const {
  GOOGLE_SHEET_ID,
  GOOGLE_SHEET_GID,
  ADMIN_NAME,
  ADMIN_PHONE,
  BUSINESS_NAME,
  SHEET_REFRESH_MINUTES,
  PORT,
  PUPPETEER_EXECUTABLE_PATH,
  OPENROUTER_API_KEY,
  GEMINI_API_KEY,
} = process.env;

if (!GOOGLE_SHEET_ID) {
  console.error('❌ لازم تحط GOOGLE_SHEET_ID في ملف .env');
  process.exit(1);
}

const sheetService = new SheetService({
  sheetId: GOOGLE_SHEET_ID,
  gid: GOOGLE_SHEET_GID || undefined,
  refreshMinutes: Number(SHEET_REFRESH_MINUTES) || 5,
});

const matchEngine = new MatchEngine({
  adminName: ADMIN_NAME || 'الإدارة',
  adminPhone: ADMIN_PHONE || '',
  businessName: BUSINESS_NAME || 'المركز',
});

const aiFallback = new AiFallback({
  openrouterKey: OPENROUTER_API_KEY,
  geminiKey: GEMINI_API_KEY,
  businessName: BUSINESS_NAME || 'المركز',
  adminName: ADMIN_NAME || 'الإدارة',
  adminPhone: ADMIN_PHONE || '',
});
if (aiFallback.enabled) {
  console.log(`🤖 الذكاء الاصطناعي الاحتياطي مفعّل (OpenRouter: ${OPENROUTER_API_KEY ? 'نعم' : 'لا'}, Gemini: ${GEMINI_API_KEY ? 'نعم' : 'لا'})`);
} else {
  console.log('ℹ️ الذكاء الاصطناعي الاحتياطي غير مفعّل (مفيش مفاتيح في .env)');
}

// ---- سيرفر ويب صغير (health check + عرض QR للاستضافة السحابية) ----
const app = createServer({ businessName: BUSINESS_NAME || 'المركز' });
const port = PORT || 3000;
app.listen(port, () => console.log(`🌐 سيرفر المراقبة شغال على المنفذ ${port}`));

// ---- ذاكرة محادثة قصيرة لكل عميل (متابعة الأسئلة + سؤال الصف/السنة) ----
const CONTEXT_TTL_MS = 15 * 60 * 1000; // 15 دقيقة
const contextStore = new Map(); // chatId -> { lastRecord, pendingCandidates, ts }

function getContext(chatId) {
  const ctx = contextStore.get(chatId);
  if (!ctx) return { lastRecord: null, pendingCandidates: null };
  if (Date.now() - ctx.ts > CONTEXT_TTL_MS) {
    contextStore.delete(chatId);
    return { lastRecord: null, pendingCandidates: null };
  }
  return { lastRecord: ctx.lastRecord, pendingCandidates: ctx.pendingCandidates };
}

function setContext(chatId, { record, pending }) {
  const prev = contextStore.get(chatId);
  contextStore.set(chatId, {
    lastRecord: record || prev?.lastRecord || null,
    pendingCandidates: pending || null, // لو مفيش pending جديد، امسح القديم (اتحل السؤال)
    ts: Date.now(),
  });
}

// تنظيف دوري للذاكرة القديمة
setInterval(() => {
  const now = Date.now();
  for (const [chatId, ctx] of contextStore.entries()) {
    if (now - ctx.ts > CONTEXT_TTL_MS) contextStore.delete(chatId);
  }
}, 5 * 60 * 1000);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- إعداد عميل واتساب ----
const puppeteerConfig = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ],
};
// لو شغالين جوه Docker غالبًا هنحدد مسار كروميوم يدويًا (شوف Dockerfile)
if (PUPPETEER_EXECUTABLE_PATH) {
  puppeteerConfig.executablePath = PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: puppeteerConfig,
  // ملحوظة: whatsapp-web.js مكتبة غير رسمية وبتتعطل بشكل متكرر كل ما واتساب يحدّث نسخته.
  // سبنا الإعداد الافتراضي هنا لأن تثبيت نسخة معينة (remote/none) سبب أخطاء تانية حسب حالة الشبكة والنسخة.
  // لو استمرت مشاكل الاتصال، الحل الأضمن على المدى الطويل هو نسخة meta-api-version (رسمية ومستقرة).
});

client.on('qr', (qr) => {
  console.log('\n📱 امسح الكود ده من واتساب بيزنس (الإعدادات > الأجهزة المرتبطة > ربط جهاز):\n');
  qrcodeTerminal.generate(qr, { small: true });
  setQr(qr).catch(err => console.error('خطأ في توليد صورة QR:', err.message));
});

client.on('ready', async () => {
  console.log('✅ البوت شغال ومتصل بواتساب بنجاح!');
  setStatus('ready');
  await sheetService.refresh(true);
  console.log(`📊 تم تحميل ${(await sheetService.getRecords()).length} صف من الجدول`);
});

client.on('auth_failure', (msg) => {
  console.error('❌ فشل تسجيل الدخول:', msg);
  setStatus('disconnected');
});

client.on('disconnected', (reason) => {
  console.error('⚠️ اتقطع الاتصال بواتساب:', reason);
  setStatus('disconnected');
});

client.on('loading_screen', (percent, message) => {
  console.log(`⏳ جاري تحميل واتساب ويب... ${percent}% - ${message}`);
});

function shouldIgnore(message) {
  if (message.from.endsWith('@g.us')) return true; // رسالة جروب
  if (message.fromMe) return true;
  if (message.isStatus) return true;
  return false;
}

client.on('message', async (message) => {
  try {
    if (shouldIgnore(message)) return;

    const userMessage = (message.body || '').trim();
    if (!userMessage) return;

    console.log(`📩 رسالة جديدة من ${message.from}: ${userMessage}`);

    const records = await sheetService.getRecords();
    const readableFullText = await sheetService.getReadableText();
    const context = getContext(message.from);

    let { text: reply, record: matchedRecord, pending, isFallback } = matchEngine.getReply(
      userMessage, records, readableFullText, context
    );

    // لو المحرك العادي معرفش يرد، جرب الذكاء الاصطناعي الاحتياطي (لو مفعّل) قبل ما نستسلم
    if (isFallback) {
      const aiAnswer = await aiFallback.tryAnswer(userMessage, readableFullText);
      if (aiAnswer) reply = aiAnswer;
    }

    // إحساس طبيعي: يظهر "بيكتب..." قبل الرد بمدة تتناسب مع طول الرسالة
    try {
      const chat = await message.getChat();
      await chat.sendStateTyping();
      const typingDelay = Math.min(3500, 600 + reply.length * 15 + Math.random() * 500);
      await delay(typingDelay);
      await chat.clearState();
    } catch (_) { /* لو فشل عرض حالة الكتابة، منكملش نوقف الرد عشانه */ }

    await message.reply(reply);
    setContext(message.from, { record: matchedRecord, pending });

    console.log(`📤 تم الرد: ${reply.slice(0, 80)}...`);
  } catch (err) {
    console.error('❌ خطأ أثناء معالجة الرسالة:', err);
    try {
      await message.reply(matchEngine.fallbackMessage());
    } catch (_) {}
  }
});

console.log('🔄 جاري محاولة تشغيل واتساب (تحميل Chromium)... ده ممكن ياخد لحظات أول مرة');

client.initialize().catch((err) => {
  console.error('❌ فشل تشغيل واتساب:', err);
  console.error('\nنصائح لحل المشكلة:');
  console.error('1) جرب تمسح فولدر node_modules وتعمل npm install تاني');
  console.error('2) تأكد إن مضاد الفيروسات/Windows Defender مش بيمنع chrome.exe بتاع Puppeteer');
  console.error('3) جرب تشغل: npx puppeteer browsers install chrome');
  process.exit(1);
});
