// ==========================================================
// قائمة رئيسية بسيطة (زي أزرار تليجرام) لتوجيه العميل
// - نسخة Meta: بتتحول لقائمة تفاعلية حقيقية (List Message)
// - نسخة QR: بتتبعت كنص مرقّم عادي (أزرار واتساب الحقيقية بقت مش شغالة
//   في المكتبات الغير رسمية زي whatsapp-web.js من فترة)
// ==========================================================

const MENU_OPTIONS = [
  { id: 'search_teacher', emoji: '👨‍🏫', title: 'بحث بالمدرس', hint: 'تمام 👍 اكتب اسم المدرس اللي عايز تعرف معاده.' },
  { id: 'search_subject', emoji: '📚', title: 'بحث بالمادة', hint: 'تمام 👍 اكتب اسم المادة اللي عايز تعرف مواعيدها.' },
  { id: 'search_grade', emoji: '🎓', title: 'بحث بالسنة/الصف', hint: 'تمام 👍 اكتب السنة أو الصف اللي عايز تشوف جدوله (مثال: تالتة ثانوي).' },
];

function buildMenuTextForQr(businessName) {
  const lines = MENU_OPTIONS.map((opt, i) => `${i + 1}️⃣ ${opt.emoji} ${opt.title}`);
  return `📖 القائمة الرئيسية - ${businessName}\n\n${lines.join('\n')}\n\nابعت رقم الخيار، أو اكتب سؤالك مباشرة في أي وقت (زي اسم المدرس).`;
}

// شكل الـ Interactive List Message المطلوب من Meta Cloud API
function buildMenuListPayload(businessName) {
  return {
    type: 'list',
    header: { type: 'text', text: businessName },
    body: { text: 'إيه اللي عايز تعمله؟ اختار من القائمة، أو اكتب سؤالك مباشرة في أي وقت.' },
    footer: { text: 'مركز الارائج التعليمي' },
    action: {
      button: 'القائمة',
      sections: [
        {
          title: 'الخدمات المتاحة',
          rows: MENU_OPTIONS.map(opt => ({
            id: opt.id,
            title: `${opt.emoji} ${opt.title}`,
          })),
        },
      ],
    },
  };
}

// بيحاول يفهم رد العميل كاختيار من القائمة: إما رقم (1-4) أو الـ id بتاع زر Meta الحقيقي
function matchMenuSelection(message) {
  const trimmed = (message || '').trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && String(num) === trimmed && num >= 1 && num <= MENU_OPTIONS.length) {
    return MENU_OPTIONS[num - 1];
  }
  return MENU_OPTIONS.find(o => o.id === trimmed) || null;
}

const MENU_TRIGGER_WORDS = ['قائمة', 'القائمة', 'مساعدة', 'المساعدة', 'ابدأ', 'menu', 'start'];

module.exports = {
  MENU_OPTIONS,
  MENU_TRIGGER_WORDS,
  buildMenuTextForQr,
  buildMenuListPayload,
  matchMenuSelection,
};
