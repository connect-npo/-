// LINE・OpenAI・Expressの設定
import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import { OpenAI } from 'openai';
import axios from 'axios';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const GROUP_ID = 'ここに取得したgroupIdを入力'; // 🔁 ここにgroupIdを貼ってください
const EMERGENCY_WORDS = ['しんどい', 'つらい', '死にたい', 'おなかすいた', 'たべられない', '働きすぎ', 'たすけて'];
const PHONE_NUMBER = '09048393313';

const client = new Client(config);
const app = express();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Webhookルート
app.post('/webhook', middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).end();
  }
});

// メッセージ処理
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text;
  const source = event.source;
  console.log('🔍 イベントソース:', source);

  // 🚨 NGワードを検知して通知
  if (EMERGENCY_WORDS.some(word => userMessage.includes(word))) {
    try {
      await client.pushMessage(GROUP_ID, {
        type: 'text',
        text: `🚨 通知：NGワードを検知しました\n内容：「${userMessage}」\n必要に応じて  ${PHONE_NUMBER} に連絡してください。`
      });
    } catch (err) {
      console.error('グループ通知エラー:', err);
    }
  }

  // 💬 ChatGPTによる返信
  try {
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'あなたは思いやりのある相談アドバイザーです。短くやさしく、温かい気持ちで返答してください。少しだけ絵文字も使ってください。' },
        { role: 'user', content: userMessage }
      ]
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
      text: 'ごめんなさい、うまく応答できませんでした。',
    });
  }
}

// ポート起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
