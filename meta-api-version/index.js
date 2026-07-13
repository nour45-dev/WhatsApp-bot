require('dotenv').config();

const express = require('express');
const SheetService = require('../shared/sheetService');
const MatchEngine = require('../shared/matchEngine');
const AiFallback = require('../shared/aiFallback');
const { buildMenuListPayload } = require('../shared/menu');
const MetaClient = require('./metaClient');

const {
  GOOGLE_SHEET_ID,
  GOOGLE_SHEET_GID,
  ADMIN_NAME,
  ADMIN_PHONE,
  BUSINESS_NAME,
  SHEET_REFRESH_MINUTES,
  META_VERIFY_TOKEN,
  META_ACCESS_TOKEN,
  META_PHONE_NUMBER_ID,
  OPENROUTER_API_KEY,
  GEMINI_API_KEY,
  PORT,
} = process.env;

const missing = [];
if (!GOOGLE_SHEET_ID) missing.push('GOOGLE_SHEET_ID');
if (!META_VERIFY_TOKEN) missing.push('META_VERIFY_TOKEN');
if (!META_ACCESS_TOKEN) missing.push('META_ACCESS_TOKEN');
if (!META_PHONE_NUMBER_ID) missing.push('META_PHONE_NUMBER_ID');
if (missing.length) {
  console.error(`❌ ناقص متغيرات في .env: ${missing.join(', ')}`);
  process.exit(1);
}

const businessName = BUSINESS_NAME || 'المركز';

const sheetService = new SheetService({
  sheetId: GOOGLE_SHEET_ID,
  gid: GOOGLE_SHEET_GID || undefined,
  refreshMinutes: Number(SHEET_REFRESH_MINUTES) || 5,
});

const matchEngine = new MatchEngine({
  adminName: ADMIN_NAME || 'الإدارة',
  adminPhone: ADMIN_PHONE || '',
  businessName,
});

const aiFallback = new AiFallback({
  openrouterKey: OPENROUTER_API_KEY,
  geminiKey: GEMINI_API_KEY,
  businessName,
  adminName: ADMIN_NAME || 'الإدارة',
  adminPhone: ADMIN_PHONE || '',
});
if (aiFallback.enabled) {
  console.log(`🤖 الذكاء الاصطناعي الاحتياطي مفعّل (OpenRouter: ${OPENROUTER_API_KEY ? 'نعم' : 'لا'}, Gemini: ${GEMINI_API_KEY ? 'نعم' : 'لا'})`);
} else {
  console.log('ℹ️ الذكاء الاصطناعي الاحتياطي غير مفعّل (مفيش مفاتيح في .env)');
}

const metaClient = new MetaClient({
  phoneNumberId: META_PHONE_NUMBER_ID,
  accessToken: META_ACCESS_TOKEN,
});

// ---- ذاكرة محادثة قصيرة لكل عميل (متابعة الأسئلة + سؤال الصف/السنة) ----
const CONTEXT_TTL_MS = 15 * 60 * 1000;
const contextStore = new Map(); // from -> { lastRecord, pendingCandidates, ts }

function getContext(from) {
  const ctx = contextStore.get(from);
  if (!ctx) return { lastRecord: null, pendingCandidates: null };
  if (Date.now() - ctx.ts > CONTEXT_TTL_MS) {
    contextStore.delete(from);
    return { lastRecord: null, pendingCandidates: null };
  }
  return { lastRecord: ctx.lastRecord, pendingCandidates: ctx.pendingCandidates };
}

function setContext(from, { record, pending }) {
  const prev = contextStore.get(from);
  contextStore.set(from, {
    lastRecord: record || prev?.lastRecord || null,
    pendingCandidates: pending || null,
    ts: Date.now(),
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [from, ctx] of contextStore.entries()) {
    if (now - ctx.ts > CONTEXT_TTL_MS) contextStore.delete(from);
  }
}, 5 * 60 * 1000);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// بيستخرج نص الرسالة سواء كانت نص عادي أو اختيار من قائمة تفاعلية حقيقية
function extractUserMessage(message) {
  if (message.type === 'interactive') {
    return message.interactive?.list_reply?.id || message.interactive?.button_reply?.id || '';
  }
  return message.text?.body?.trim() || '';
}

// ---- سيرفر Express ----
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`
    <html dir="rtl" lang="ar">
    <head><meta charset="utf-8" /><title>بوت واتساب - Meta Cloud API</title></head>
    <body style="font-family:Tahoma; text-align:center; padding:40px;">
      <h2>✅ بوت ${businessName} شغال (Meta Cloud API)</h2>
      <p>الـ Webhook جاهز يستقبل رسائل على المسار /webhook</p>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// 1) التحقق من الـ Webhook وقت الإعداد على Meta for Developers
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('✅ تم التحقق من الـ Webhook بنجاح');
    return res.status(200).send(challenge);
  }
  console.warn('⚠️ محاولة تحقق فشلت - تأكد من META_VERIFY_TOKEN');
  return res.sendStatus(403);
});

// 2) استقبال الرسائل الفعلية من العملاء
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // لازم نرد بسرعة عشان Meta ماتعدش تحاول تبعت تاني

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const userMessage = extractUserMessage(message);
    if (!userMessage) return;

    console.log(`📩 رسالة جديدة من ${from}: ${userMessage}`);

    metaClient.markAsRead(message.id);

    const records = await sheetService.getRecords();
    const readableFullText = await sheetService.getReadableText();
    const context = getContext(from);

    let { text: reply, record: matchedRecord, pending, showMenu, isFallback } = matchEngine.getReply(
      userMessage, records, readableFullText, context
    );

    // لو المحرك العادي معرفش يرد، جرب الذكاء الاصطناعي الاحتياطي (لو مفعّل) قبل ما نستسلم
    if (isFallback) {
      const aiAnswer = await aiFallback.tryAnswer(userMessage, readableFullText);
      if (aiAnswer) reply = aiAnswer;
    }

    const typingDelay = Math.min(3000, 500 + reply.length * 12 + Math.random() * 400);
    await delay(typingDelay);

    // لو الرد المفروض يبقى قائمة، ابعت List Message حقيقية بدل النص
    if (showMenu) {
      await metaClient.sendListMessage(from, buildMenuListPayload(businessName));
    } else {
      await metaClient.sendText(from, reply);
    }
    setContext(from, { record: matchedRecord, pending });

    console.log(`📤 تم الرد على ${from}: ${reply.slice(0, 80)}...`);
  } catch (err) {
    console.error('❌ خطأ أثناء معالجة رسالة Meta:', err);
  }
});

const port = PORT || 3000;
app.listen(port, async () => {
  console.log(`🌐 سيرفر Meta Cloud API شغال على المنفذ ${port}`);
  await sheetService.refresh(true);
  console.log(`📊 تم تحميل ${(await sheetService.getRecords()).length} صف من الجدول`);
  console.log('✅ البوت جاهز يستقبل رسائل على /webhook');
});
