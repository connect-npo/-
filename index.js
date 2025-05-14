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

// グループIDとNGワード一覧
const groupId = 'C9ff658373801593d72ccbf1a1f09ab49';
const ngWords = ['しにたい', '死にたい', 'つらい', '疲れた', 'やめたい', '消えたい', '苦しい'];

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

  // NGワードが含まれていたらグループに通知
  const matchedNgWord = ngWords.find((word) => userMessage.includes(word));
  if (matchedNgWord) {
    try {
      await client.pushMessage(groupId, {
        type: 'text',
        text: `🔔 重要メッセージを検知：「${userMessage}」\n📞 ご連絡は 090-4839-3313 までお願いいたします。`,
      });
    } catch (notifyErr) {
      console.error('グループ通知に失敗しました:', notifyErr);
    }
  }

  // ChatGPTからの返信
  try {
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'あなたは思いやりのある相談アドバイザーです。短く、やさしく、励ましの言葉と絵文字を添えて答えてください。',
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
      text: 'ごめんなさい、うまく応答できませんでした。',
    });
  }
}

// Renderが必要とするポート設定
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
