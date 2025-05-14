// LINE Bot + ChatGPT連携 + 特定ワード検知 + グループIDログ出力対応

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

app.post('/webhook', middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  console.log('event source:', event.source); // 🔍 groupIdなどを表示

  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text;
  const lowered = userMessage.toLowerCase();

  // 📢 特定ワードを含む場合はグループ通知＋個別メッセージ
  if (lowered.includes('しにたい') || lowered.includes('死にたい') || lowered.includes('つらい') || lowered.includes('しんどい')) {
    const phoneText = 'とても心配です。今すぐ相談できます → 090-4839-3313 📞';

    // ※ここにグループ通知を入れるには groupId を確認して設定が必要です
    // 例: await client.pushMessage('YOUR_GROUP_ID', { type: 'text', text: `⚠️ 注意: ${userMessage}` });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `${phoneText}\nこころちゃんがいつでも寄り添います 🌸`,
    });
  }

  try {
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'あなたは思いやりのある相談アドバイザーです。短く、やさしく、少しだけ絵文字を使って答えてください。',
        },
        {
          role: 'user',
          content: userMessage,
        },
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
      text: 'ごめんなさい、うまく応答できませんでした🙏',
    });
  }
}

// Render用ポート
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
