// index.js
const express = require('express');
const axios = require('axios');
const { Configuration, OpenAIApi } = require('openai');
const { Client, middleware } = require('@line/bot-sdk');
require('dotenv').config();

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

const dangerWords = ['死にたい', '消えたい', '助けて', 'リスカ', 'OD'];

const groupId = process.env.LINE_GROUP_ID;

app.post('/webhook', middleware(config), express.json(), async (req, res) => {
  try {
    const events = req.body.events;
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        const replyToken = event.replyToken;

        const matchedWord = dangerWords.find(word => userMessage.includes(word));
        if (matchedWord) {
          await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
              to: groupId,
              messages: [{ type: 'text', text: `⚠️ 危険ワード: ${matchedWord}\n📞 090-4839-3313` }]
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.channelAccessToken}`
              }
            }
          );
        }

        const completion = await openai.createChatCompletion({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'あなたは14歳の優しい女の子「こころちゃん」です。相談者に寄り添ってください。' },
            { role: 'user', content: userMessage }
          ]
        });

        const replyText = completion.data.choices[0].message.content;
        await client.replyMessage(replyToken, [{ type: 'text', text: replyText }]);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ エラー:', err);
    res.sendStatus(500);
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
