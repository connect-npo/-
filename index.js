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
const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

const dangerWords = [
  'suicide', 'die', 'want to die', 'kill myself', 'disappear', 'help me', 'limit',
  'overwork', 'tired', 'painful', 'sleepless', 'lonely', 'despair',
  'self-harm', 'OD', 'overdose', 'medicine', 'sleeping pills',
  'violence', 'abuse', 'DV', 'neglect', 'yell', 'bullying', 'ignored',
  'can’t go to school', 'no money', 'debt', 'poverty',
  'nobody understands me', 'I’m done', 'want to disappear'
];

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
              messages: [
                {
                  type: 'text',
                  text: `⚠️ Danger word detected: "${matchedWord}"\n📞 Please respond ASAP.\n📱 090-4839-3313`
                }
              ]
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
            {
              role: 'system',
              content: 'You are "Kokoro-chan", a sweet 14-year-old girl. Always reply kindly with emojis in 1-2 short sentences.'
            },
            {
              role: 'user',
              content: userMessage
            }
          ]
        });

        const replyText = completion.data.choices[0].message.content;

        await client.replyMessage(replyToken, [
          {
            type: 'text',
            text: replyText
          }
        ]);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).end();
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
