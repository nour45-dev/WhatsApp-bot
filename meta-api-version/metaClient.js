const axios = require('axios');

const GRAPH_VERSION = 'v20.0';

class MetaClient {
  constructor({ phoneNumberId, accessToken }) {
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
    this.baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}`;
  }

  async sendText(to, body) {
    try {
      await axios.post(
        `${this.baseUrl}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        },
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
    } catch (err) {
      console.error('❌ فشل إرسال الرسالة عبر Meta API:', err.response?.data || err.message);
    }
  }

  // بيعلّم الرسالة كمقروءة (تظهر تكة زرقاء عند العميل) - تحسين للمظهر بس مش ضروري
  async markAsRead(messageId) {
    try {
      await axios.post(
        `${this.baseUrl}/messages`,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
    } catch (err) {
      // مش مشكلة كبيرة لو فشلت، منوقفش عشانها
      console.warn('⚠️ فشل تعليم الرسالة كمقروءة:', err.response?.data?.error?.message || err.message);
    }
  }

  // بيبعت قائمة تفاعلية حقيقية (List Message) - العميل بيدوس عليها زي أزرار حقيقية
  async sendListMessage(to, listPayload) {
    try {
      await axios.post(
        `${this.baseUrl}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'interactive',
          interactive: listPayload,
        },
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
    } catch (err) {
      console.error('❌ فشل إرسال القائمة التفاعلية:', err.response?.data || err.message);
      // لو فشل إرسال القائمة، نرجع نبعت نص عادي كخطة بديلة
      await this.sendText(to, 'اكتب اسم المدرس أو المادة اللي عايز تعرف معادها.');
    }
  }
}

module.exports = MetaClient;
