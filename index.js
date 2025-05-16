
const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();

const config = {
  channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const client = new Client(config);

const OPENAI_API_KEY = process.env.YOUR_OPENAI_API_KEY;
const GROUP_ID = process.env.GROUP_ID;

const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "つらい", "助けて", "やめたい", "苦しい",
  "学校に行けない", "殴られる", "たたかれる", "リストカット", "オーバードーズ", "いじめ",
  "お金が足りない", "貧乏"
];

const kokoroProfile = {
  name: "こころちゃん",
  age: "14歳",
  personality: "とてもやさしくて人に寄り添う性格",
  creator: "ドクターHiro",
  website: "https://connect-npo.org"
};

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  const results = await Promise.all(events.map(async (event) => {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;

      const detected = dangerWords.find(word => userMessage.includes(word));
      if (detected) {
        // 優しい励ましメッセージ
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: `🌸辛い気持ち、抱えているんだね。
大丈夫だよ、ひとりじゃないからね。
わたしがそばにいるよ。ゆっくり話してね。

💡どうしようもないときは、お電話くださいね📞 090-4839-3313`
        });

        // 危険ワードをグループに通知
        await client.pushMessage(GROUP_ID, {
          type: 'text',
          text: `[通報] 危険ワード「${detected}」検出：
${userMessage}`
        });

        return;
      }

      // 通常のChatGPT返信
      const openaiRes = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `あなたは14歳の女の子「こころちゃん」です。性格はとてもやさしく、人に寄り添います。元気すぎず、丁寧で安心感のある言葉遣いで話してください。作成者はドクターHiroで、ホームページは https://connect-npo.org です。`
            },
            {
              role: 'user',
              content: userMessage
            }
          ],
          max_tokens: 100
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const kokoroReply = openaiRes.data.choices[0].message.content;

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: kokoroReply
      });
    }
  }));

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
