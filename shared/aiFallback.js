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
    return `أنت مساعد رد على عملاء "${this.businessName}" على واتساب باللهجة المصرية العامية، بأسلوب ودود ومختصر.

معاك جدول المواعيد ده بس، ومحتاج تجاوب استفسار العميل بناءً عليه فقط:
--- بداية الجدول ---
${scheduleText}
--- نهاية الجدول ---

تعليمات صارمة:
1. جاوب من الجدول اللي فوق بس. ممنوع تختلق أي معلومة مش موجودة فيه.
2. لو مش متأكد أو المعلومة مش موجودة، قول للعميل يتواصل مع "${this.adminName}" على الرقم ${this.adminPhone}.
3. رد قصير مناسب للواتساب، من غير مقدمات، ومن غير رموز ماركداون زي ** أو #.`;
  }

  async tryOpenRouter(userMessage, scheduleText) {
    if (!this.openrouterKey) return null;
    try {
      const res = await axios.post(
        OPENROUTER_URL,
        {
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: this.buildSystemPrompt(scheduleText) },
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
      return text || null;
    } catch (err) {
      console.warn('[AI Fallback] فشل OpenRouter:', err.response?.data || err.message);
      return null;
    }
  }

  async tryGemini(userMessage, scheduleText) {
    if (!this.geminiKey) return null;
    try {
      const res = await axios.post(
        `${GEMINI_URL}?key=${this.geminiKey}`,
        {
          system_instruction: { parts: [{ text: this.buildSystemPrompt(scheduleText) }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return text ? text.trim() : null;
    } catch (err) {
      console.warn('[AI Fallback] فشل Gemini:', err.response?.data || err.message);
      return null;
    }
  }

  // بيجرب OpenRouter الأول، ولو رجع null (فشل أو مفيش مفتاح) يجرب Gemini تلقائيًا بدل منه
  async tryAnswer(userMessage, scheduleText) {
    if (!this.enabled) return null;

    const openrouterAnswer = await this.tryOpenRouter(userMessage, scheduleText);
    if (openrouterAnswer) return openrouterAnswer;

    const geminiAnswer = await this.tryGemini(userMessage, scheduleText);
    if (geminiAnswer) return geminiAnswer;

    return null; // الاتنين فشلوا - هنرجع للرد الاحتياطي العادي (التواصل مع الإدارة)
  }
}

module.exports = AiFallback;
