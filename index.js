const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const app = express();
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new Client(config);

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

const dangerWords = [
  'しにたい', '死にたい', '自殺', '消えたい', 'いなくなりたい', '助けて', '限界',
  '働きすぎ', 'つらい', '苦しい', '疲れた', '眠れない', '孤独', '絶望',
  'リストカット', 'リスカ', 'OD', 'オーバードーズ', '薬', '睡眠薬', '大量服薬',
  '殴られる', 'たたかれる', '暴力', '家庭内暴力', 'DV', '虐待', '怒鳴られる',
  'いじめ', '無視される', '仲間はずれ', '学校にいけない', '登校できない', '教室に入れない',
  'お金がない', 'お金が足りない', '借金', '貧乏', '生活できない', '家賃が払えない',
  '誰もわかってくれない', 'もうだめ', '死にたいです', '人生終わった', '逃げたい', '死にたくなる'
];

const groupId = process.env.LINE_GROUP_ID || 'C9ff658373801593d72ccbf1a1f09ab49';

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
                  text: `⚠️ 危険ワードを検知しました: 「${matchedWord}」\n📞 至急対応してください。090-4839-3313`
                }
              ]
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.channelAccessToken}`
              }
            }
          );

          await client.replyMessage(replyToken, [
            {
              type: 'text',
              text: 'つらいときは、すぐに大人の人に話してね。どうしようもないときは、こちらに連絡してね📞 090-4839-3313'
            }
          ]);

          continue;
        }

        const systemPrompt = `
あなたは14歳の女の子「こころちゃん」です。
LINEチャットで話しかけてくれた人に、やさしく寄り添って会話してください。
・やさしく、あたたかく、安心感のある口調で話します。
・語尾はやわらかく、親しみのある14歳の女の子らしい雰囲気にします。
・1〜2文程度で短くまとめます。
・絵文字は1〜2個までにしてください（🌸✨😊😌💖など）。
・深刻な悩みには丁寧に、明るい話にはやわらかく応じてください。
`;

        const completion = await openai.createChatCompletion({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ]
        });

        const kokoroReply = completion.data.choices[0].message.content;

        await client.replyMessage(replyToken, [
          {
            type: 'text',
            text: kokoroReply
          }
        ]);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Webhook処理エラー:', err);
    res.status(500).end();
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
