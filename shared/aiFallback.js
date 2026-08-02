// ==========================================================
// طبقة ذكاء اصطناعي احتياطية (اختيارية) - OpenRouter + Gemini مع تبديل تلقائي
// - بتجرب OpenRouter الأول (لو فيه مفتاح)
// - لو فشل أو مفيش مفتاح OpenRouter، تجرب Gemini تلقائيًا بدل منه
// - بتشتغل فقط لما محرك القواعد العادي (matchEngine) يفشل يلاقي إجابة
// ==========================================================

const axios = require('axios');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openrouter/free'; // راوتر بيختار موديل مجاني متاح تلقائيًا

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

class AiFallback {
  constructor({ openrouterKey, geminiKey, businessName, adminName, adminPhone }) {
    this.openrouterKey = openrouterKey;
    this.geminiKey = geminiKey;
    this.enabled = Boolean(openrouterKey) || Boolean(geminiKey);
    this.businessName = businessName;
    this.adminName = adminName;
    this.adminPhone = adminPhone;
  }

  buildSystemPrompt(scheduleText) {
    return `انت المساعد الذكي الرسمي بتاع "${this.businessName}" على واتساب. بترد على أولياء الأمور والطلاب باللهجة المصرية العامية، بأسلوب إنساني ودود ومحترم ومحترف في نفس الوقت - زي موظف استقبال شاطر وبيحب شغله، مش زي بوت آلي جامد.

أسلوب الرد:
- ابدأ بشكل طبيعي ومباشر من غير مقدمات طويلة أو حشو.
- كن دافئ ومتعاون، استخدم إيموجي واحد أو اتنين بس لو مناسب (زي 👍 🙏 😊)، من غير مبالغة.
- لو العميل قلقان أو مستعجل، طمّنه وجاوبه بسرعة ووضوح.
- ممنوع نهائيًا أي رموز ماركداون زي ** أو # أو _، الرسالة نص عادي بس زي ما بيتكتب في واتساب.
- الرد يكون مختصر ومركّز، من غير إطالة أو تكرار.

معاك جدول المواعيد ده بس، وكل إجابتك لازم تُبنى عليه فقط:
--- بداية الجدول ---
${scheduleText}
--- نهاية الجدول ---

تعليمات صارمة (ممنوع مخالفتها):
1. جاوب من الجدول اللي فوق بس. ممنوع نهائيًا تختلق أو تخمّن أي معلومة (اسم مدرس، معاد، يوم، قاعة) مش موجودة فيه حرفيًا.
2. لو السؤال مش عن الجدول (مواعيد/مدرسين/مواد/صفوف)، أو المعلومة مش موجودة، أو مش متأكد 100%، قول للعميل بلطف يتواصل مباشرة مع "${this.adminName}" على الرقم ${this.adminPhone} وهو هيساعده.
3. متقولش "أنا ذكاء اصطناعي" أو تشرح تفاصيل تقنية عن نفسك - أنت ببساطة المساعد بتاع المركز.`;
  }

  // شبكة أمان: بتشيل أي رموز ماركداون لو الموديل خالفها رغم التعليمات (زي ** أو # أو _)
  sanitize(text) {
    if (!text) return text;
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/__(.*?)__/g, '$1')
      .trim();
  }

  async tryOpenRouter(userMessage, scheduleText, history = []) {
    if (!this.openrouterKey) return null;
    try {
      const res = await axios.post(
        OPENROUTER_URL,
        {
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: this.buildSystemPrompt(scheduleText) },
            ...history,
            { role: 'user', content: userMessage },
          ],
          max_tokens: 300,
        },
        {
          headers: {
            Authorization: `Bearer ${this.openrouterKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      const text = res.data?.choices?.[0]?.message?.content?.trim();
      return text ? this.sanitize(text) : null;
    } catch (err) {
      console.warn('[AI Fallback] فشل OpenRouter:', err.response?.data || err.message);
      return null;
    }
  }

  async tryGemini(userMessage, scheduleText, history = []) {
    if (!this.geminiKey) return null;
    try {
      // Gemini بيستخدم role: 'model' بدل 'assistant'
      const historyContents = history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      }));
      const res = await axios.post(
        `${GEMINI_URL}?key=${this.geminiKey}`,
        {
          system_instruction: { parts: [{ text: this.buildSystemPrompt(scheduleText) }] },
          contents: [...historyContents, { role: 'user', parts: [{ text: userMessage }] }],
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return text ? this.sanitize(text.trim()) : null;
    } catch (err) {
      console.warn('[AI Fallback] فشل Gemini:', err.response?.data || err.message);
      return null;
    }
  }

  // بيجرب OpenRouter الأول، ولو رجع null (فشل أو مفيش مفتاح) يجرب Gemini تلقائيًا بدل منه
  // history: آخر رسائل المحادثة (زودها لو متاحة عشان يفهم السياق مش بس آخر رسالة)
  async tryAnswer(userMessage, scheduleText, history = []) {
    if (!this.enabled) return null;

    const openrouterAnswer = await this.tryOpenRouter(userMessage, scheduleText, history);
    if (openrouterAnswer) return openrouterAnswer;

    const geminiAnswer = await this.tryGemini(userMessage, scheduleText, history);
    if (geminiAnswer) return geminiAnswer;

    return null; // الاتنين فشلوا - هنرجع للرد الاحتياطي العادي (التواصل مع الإدارة)
  }
}

module.exports = AiFallback;
