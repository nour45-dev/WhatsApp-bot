const express = require('express');
const QRCode = require('qrcode');

// حالة مشتركة بتتحدث من index.js وبتتعرض على المتصفح
const state = {
  status: 'starting', // starting | qr | ready | disconnected
  qrDataUrl: null,
  lastUpdate: Date.now(),
};

function createServer({ businessName }) {
  const app = express();

  app.get('/', (req, res) => {
    res.send(`
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>بوت واتساب - ${businessName}</title>
        <meta http-equiv="refresh" content="5" />
        <style>
          body { font-family: Tahoma, Arial, sans-serif; background:#111827; color:#f9fafb; text-align:center; padding:40px; }
          .card { background:#1f2937; border-radius:16px; padding:32px; max-width:420px; margin:auto; }
          img { border-radius:8px; margin-top:16px; }
          .status { padding:8px 16px; border-radius:999px; display:inline-block; font-weight:bold; }
          .ready { background:#065f46; color:#a7f3d0; }
          .qr { background:#92400e; color:#fde68a; }
          .starting, .disconnected { background:#7f1d1d; color:#fecaca; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>بوت واتساب - ${businessName}</h2>
          ${state.status === 'ready'
            ? `<p class="status ready">✅ متصل وشغال</p><p>البوت بيرد على الرسايل تلقائيًا دلوقتي.</p>`
            : state.status === 'qr'
              ? `<p class="status qr">📱 محتاج مسح QR</p>
                 <p>افتح واتساب بيزنس > الإعدادات > الأجهزة المرتبطة > ربط جهاز</p>
                 <img src="${state.qrDataUrl}" width="280" height="280" />`
              : `<p class="status ${state.status}">⏳ ${state.status === 'disconnected' ? 'اتقطع الاتصال، بيحاول يعيد المحاولة' : 'البوت بيبدأ التشغيل...'}</p>`
          }
          <p style="opacity:0.6; font-size:12px; margin-top:24px;">آخر تحديث: ${new Date(state.lastUpdate).toLocaleString('ar-EG')}</p>
        </div>
      </body>
      </html>
    `);
  });

  // مطلوب من منصات الاستضافة (Render/Railway) للتأكد إن السيرفر شغال
  app.get('/health', (req, res) => res.status(200).json({ status: state.status }));

  return app;
}

async function setQr(qrString) {
  state.status = 'qr';
  state.qrDataUrl = await QRCode.toDataURL(qrString);
  state.lastUpdate = Date.now();
}

function setStatus(status) {
  state.status = status;
  state.lastUpdate = Date.now();
}

module.exports = { createServer, setQr, setStatus, state };
