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

// 👇 グループ通知用（見つかったらここを更新）
const GROUP_ID_FOR_ALERT = ''; // 例: 'C1234567890abcdef1234567890abcdef'

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

  const userMessage = event.message.text;
  const source = event.source;

  // 👀 ログで groupId を見つけるためのヒント
  if (source && source.groupId) {
    console.log('✅ グループID検出:', source.groupId);
  }

  // 🚨 特定ワード検出時に通知
  const keywords = ['しにたい', '死にたい', 'つらい', '消えたい', '自殺'];
  const alertMatched = keywords.some(word => userMessage.includes(word));

  if (alertMatched) {
    const alertText = `🚨 ユーザーから気になる言葉が届きました:\n「${userMessage}」`;

    if (GROUP_ID_FOR_ALERT && GROUP_ID_FOR_ALERT.length > 0) {
      try {
        await client.pushMessage(GROUP_ID_FOR_ALERT, {
          type: 'text',
          text: alertText,
        });
        console.log('🔔 グループに通知を送信しました');
      } catch (e) {
        console.error('❌ グループ通知エラー:', e);
      }
    } else {
      console.log('⚠ グループIDが未設定のため通知をスキップ');
    }
  }

  // ChatGPT応答処理
  try {
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'あなたは思いやりのある相談アドバイザーです。やさしく温かく、短く答えてください。絵文字も少し使ってください。'
        },
        {
          role: 'user',
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
      text: 'ごめんなさい、ちょっとうまく答えられませんでした🙏 また気軽に話しかけてくださいね。',
    });
  }
}

// 🚪 Renderが必要とするポート
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
