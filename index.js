import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import { OpenAI } from 'openai';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 特定ワードに反応してグループ通知する設定
const ALERT_KEYWORDS = ['しにたい', '死にたい', 'つらい', '消えたい'];
const ADMIN_PHONE = '09048393313';
const GROUP_ID_FOR_ALERT = 'ここに通知先グループID'; // ←ここは後で置き換える

app.post('/webhook', middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text;
  const source = event.source;

  // グループIDをログ出力
  if (source.type === 'group' && source.groupId) {
    console.log('✅ グループID検出:', source.groupId);
  }

  // NGワードチェック
  const containsAlert = ALERT_KEYWORDS.some(word => userMessage.includes(word));

  if (containsAlert) {
    const alertText = `⚠️ ご相談内容に重要ワードが含まれました。\n\n📩 内容:「${userMessage}」\n📞 至急連絡：${ADMIN_PHONE}`;

    // グループ通知（通知先が設定されている場合のみ）
    if (GROUP_ID_FOR_ALERT !== 'ここに通知先グループID') {
      await client.pushMessage(GROUP_ID_FOR_ALERT, {
        type: 'text',
        text: alertText,
      });
    }

    // 返信：やさしく反応
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `🌸 大変そうですね…。\nあなたの話を聞けてうれしいです。\n必要なら ${ADMIN_PHONE} にもご連絡くださいね。`,
    });
  }

  // 通常応答（ChatGPT）
  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "あなたは思いやりのある相談アドバイザーです。短く、やさしく、温かく答えてください。"
        },
        {
          role: "user",
          content: userMessage
        }
      ],
    });

    const replyText = chatResponse.choices[0].message.content;

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: replyText,
    });
  } catch (err) {
    console.error('OpenAI API Error:', err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ごめんなさい、うまく応答できませんでした。🙇‍♀️',
    });
  }
}

// Render用ポート
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
