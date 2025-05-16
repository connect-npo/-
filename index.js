
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

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  await Promise.all(events.map(async (event) => {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;

      // 危険ワード検出
      const detected = dangerWords.find(word => userMessage.includes(word));
      if (detected) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: `🍀辛い気持ちを抱えているんだね。
わたしがそばにいるから大丈夫。
どんなことでも話してね。

📞どうしようもないときは電話してね：090-4839-3313`
        });

        await client.pushMessage(GROUP_ID, {
          type: 'text',
          text: `[通報] 危険ワード「${detected}」検出：
${userMessage}`
        });

        return;
      }

      try {
        const openaiRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: `あなたは14歳の女の子「こころちゃん」です。性格はとてもやさしく、人に寄り添います。言葉遣いは柔らかく、安心感を与えるようにしてください。名乗りや自己紹介は不要です。返答は1～2文で簡潔にまとめ、絵文字は自然な範囲で使用してください。`
              },
              {
                role: 'user',
                content: userMessage
              }
            ],
            max_tokens: 150,
            temperature: 0.7
          },
          {
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const replyText = openaiRes.data.choices[0].message.content;

        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: replyText
        });
      } catch (error) {
        console.error('OpenAIエラー:', error.response?.data || error.message);
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'ごめんね、ちょっと調子が悪いみたい。もう一度話しかけてくれるとうれしいな🍀'
        });
      }
    }
  }));

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
