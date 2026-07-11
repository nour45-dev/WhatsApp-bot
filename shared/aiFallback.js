// ==========================================================
// طبقة ذكاء اصطناعي احتياطية (اختيارية) - بتشتغل فقط لما محرك القواعد
// العادي (matchEngine) يفشل يلاقي إجابة من الجدول (زي أسئلة برة نطاق
// الجدول، أو كلام عام). بتدعم مزوّدين: OpenRouter (موديلات مجانية) و
// Google Gemini، وبتتبادل بينهم عشان لو واحد وقع أو اتعمله Rate Limit
// نلاقي بديل جاهز على طول من غير ما العميل حتى يحس.
// ==========================================================

const axios = require('axios');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// موديلات مجانية معروفة الجودة عند OpenRouter، بالترتيب. لو حد منهم اتشال
// من قايمة المجاني مستقبلاً، يتحدّث من openrouter.ai/models
const OPENROUTER_FREE_MODELS = [
  'openai/gpt-oss-120b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openrouter/free', // خط دفاع أخير: الراوتر العشوائي لو كل حاجة تانية فشلت
];

class AiFallback {
  constructor({ apiKey, geminiApiKey, businessName, adminName, adminPhone }) {
    this.apiKey = apiKey; // OpenRouter
    this.geminiApiKey = geminiApiKey; // Gemini (اختياري)
    this.enabled = Boolean(apiKey) || Boolean(geminiApiKey);
    this.businessName = businessName;
    this.adminName = adminName;
    this.adminPhone = adminPhone;
    this._turn = 0; // بيتزود كل مرة، عشان نتبادل مين يتجرب الأول
  }

  buildSystemPrompt(scheduleText, historyText) {
    return `أنت "مساعد ${this.businessName}" على واتساب. مصري، ودود جدًا، طبيعي وإنساني في كلامك - مش شكل روبوت أو رد آلي.

معاك جدول المواعيد ده بس، ومحتاج تجاوب استفسار العميل بناءً عليه فقط:
--- بداية الجدول ---
${scheduleText}
--- نهاية الجدول ---
${historyText ? `\nآخر كام رسالة من نفس المحادثة (عشان تفهم السياق وتكمل الكلام بطبيعية، من غير ما تكرر نفس الرد أو تنسى اللي اتقال):\n${historyText}\n` : ''}
تعليمات صارمة:
1. جاوب من الجدول اللي فوق بس. ممنوع تختلق أو "تتوقع" أي معلومة مش موجودة فيه حرفيًا - لو رقم أو يوم مش مكتوب صراحة في الجدول، متقولوش.
2. لو مش متأكد 100% أو المعلومة مش موجودة، قول للعميل يتواصل مع "${this.adminName}" على الرقم ${this.adminPhone}. متحاولش تخمن.
3. لو حد سألك "انت مين"، قوله انت مساعد ${this.businessName} بأسلوب ودود بسيط.
4. رد قصير مناسب للواتساب (2-3 جمل بحد أقصى)، من غير مقدمات، ومن غير رموز ماركداون زي ** أو #.
5. اكتب بلغة عربية عامية مصرية سليمة ومفهومة 100%. ممنوع أي كلام مبهم أو غير مترابط أو جمل ناقصة المعنى.
6. لو مش لاقي إجابة واضحة، اعتذر بجملة واحدة بسيطة ودودة وحوّل العميل للإدارة.`;
  }

  async callOpenRouter(userMessage, systemPrompt) {
    if (!this.apiKey) return null;
    for (const model of OPENROUTER_FREE_MODELS) {
      try {
        const res = await axios.post(
          OPENROUTER_URL,
          {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            max_tokens: 300,
          },
          {
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            timeout: 12000,
          }
        );
        const text = res.data?.choices?.[0]?.message?.content?.trim();
        if (text && text.length >= 5) return text;
        console.warn(`[AI Fallback] رد غير مقبول من OpenRouter/${model}, بنجرب اللي بعده`);
      } catch (err) {
        console.warn(`[AI Fallback] فشل OpenRouter/${model}:`, err.response?.data?.error?.message || err.message);
      }
    }
    return null;
  }

  async callGemini(userMessage, systemPrompt) {
    if (!this.geminiApiKey) return null;
    try {
      const res = await axios.post(
        GEMINI_URL,
        {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { maxOutputTokens: 300 },
        },
        {
          headers: { 'x-goog-api-key': this.geminiApiKey, 'Content-Type': 'application/json' },
          timeout: 12000,
        }
      );
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text && text.length >= 5) return text;
      console.warn('[AI Fallback] رد غير مقبول من Gemini');
    } catch (err) {
      console.warn('[AI Fallback] فشل الاتصال بـ Gemini:', err.response?.data?.error?.message || err.message);
    }
    return null;
  }

  /**
   * @param {string} userMessage
   * @param {string} scheduleText
   * @param {Array<{role:string, content:string}>} history آخر رسايل المحادثة (اختياري)
   */
  async tryAnswer(userMessage, scheduleText, history = []) {
    if (!this.enabled) return null;

    const historyText = history
      .slice(-15)
      .map(h => `${h.role === 'user' ? 'العميل' : 'المساعد'}: ${h.content}`)
      .join('\n');
    const systemPrompt = this.buildSystemPrompt(scheduleText, historyText);

    // بنتبادل مين يتجرب الأول كل مرة (لو الاتنين متفعّلين) عشان نوزع الحمل
    // ومنعتمدش على مزوّد واحد بس لو بقى بطيء أو وصل لحده اليومي
    this._turn += 1;
    const providers = [
      { name: 'openrouter', run: () => this.callOpenRouter(userMessage, systemPrompt) },
      { name: 'gemini', run: () => this.callGemini(userMessage, systemPrompt) },
    ];
    const ordered = this._turn % 2 === 0 ? providers : [providers[1], providers[0]];

    for (const provider of ordered) {
      const answer = await provider.run();
      if (answer) return answer;
    }
    return null; // كل المزوّدين فشلوا - هنرجع للرد الاحتياطي العادي (التواصل مع الإدارة)
  }
}

module.exports = AiFallback;
