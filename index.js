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

// 通知を送るグループID（ログから取得したIDに置き換えてください）
const GROUP_ID = 'C9ff65837380159d372ccbf1a0189a49';

// 特定ワードに反応するパターン
const alertKeywords = ['死にたい', 'しんどい', 'つらい', '消えたい', '生きてる意味'];

// メイン処理
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

  // 特定ワードが含まれていたらグループに通知
  if (alertKeywords.some(word => userMessage.includes(word))) {
    const alertMsg = `🚨 ご相談が届きました\n「${userMessage}」\n📞至急ご確認ください：090-4839-3313`;
    try {
      await client.pushMessage(GROUP_ID, {
        type: 'text',
        text: alertMsg,
      });
      console.log('✅ グループに通知を送りました');
    } catch (err) {
      console.error('❌ グループ通知に失敗しました', err);
    }
  }

  // ChatGPTに相談文を送信
  try {
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'あなたは優しい相談アドバイザー「こころちゃん」です。小学生にもわかるように、絵文字をまじえた思いやりある言葉で短く返答してください。',
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
      text: 'ごめんなさい💦 うまく応答できませんでした。しばらくしてもう一度ためしてね🍀',
    });
  }
}

// ポート設定
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
