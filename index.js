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

// 👇 グループ通知用（実際のIDに変更してください）
const GROUP_ID = 'YOUR_GROUP_ID_HERE'; // 例: 'C4f3c5a5f8a9dxxxxx'

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
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text.toLowerCase();

  // NGワードリスト（SOS検知）
  const ngWords = ['しんどい', '死にたい', 'つらい', '消えたい', 'もうだめ'];
  const foundNgWord = ngWords.find(word => userMessage.includes(word));

  // NGワード対応（通知＆特別返信）
  if (foundNgWord) {
    // グループ通知（関係者LINEグループへ）
    await client.pushMessage(GROUP_ID, {
      type: 'text',
      text: `⚠️ NGワード検知: 「${foundNgWord}」が投稿されました。すぐに確認してください。`,
    });

    // 本人へ優しい言葉と連絡先
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `心配しています…ひとりで抱えこまないでね。\nわたしたちはここにいます。\n📞 090-4839-3313`,
    });
  }

  // ChatGPTでやさしい「こころちゃん」の返答
  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "あなたは『こころちゃん』という14歳のやさしい相談アドバイザーです。\
相談してくれた人に安心感とあたたかさを伝えるように、\
短くやさしい言葉で答えてください。相手の気持ちを否定せず、そっと寄り添ってください。\
🌸や🫧など、やさしい絵文字を1つだけ添えてください。"
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
    console.error('OpenAI API Error:', err.response?.data || err.message || err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ごめんなさい、うまく応答できませんでした。',
    });
  }
}

// ポート設定
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
