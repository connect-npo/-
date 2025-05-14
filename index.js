const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: 'CcR+KCvQBys6Cr0ZYmpVkXv/GJmW+7uuO6FC+M/Ml0bGSaHdLeKbR3YHVZmNgwuGqX3sTrqlRFtlYAQydhLUWVyz6BbCAbY8xd/orUSsLPI/qlb/t8DcHKV1dgpl7Jd3nqifSz8iTVxSgkNTPTupZQdB04t89/1O/w1cDnyilFU=',
  channelSecret: 'c9b8ec33af29ae44345e0648bf33d4c0'
};

const client = new Client(config);

const dangerWords = [
  'しにたい', '死にたい', '自殺', '消えたい', 'いなくなりたい', '助けて', '限界',
  '働きすぎ', 'つらい', '苦しい', '疲れた', '眠れない', '孤独', '絶望',
  'リストカット', 'リスカ', 'OD', 'オーバードーズ',
  '殴られる', 'たたかれる', '暴力', '家庭内暴力', 'DV', '虐待',
  'いじめ', '無視される', '仲間はずれ', '学校にいけない', '登校できない',
  'お金がない', 'お金が足りない', '借金', '貧乏', '生活できない',
  '誰もわかってくれない', 'もうだめ', '死にたいです'
];

// LINEグループID
const groupId = 'C9ff658373801593d72ccbf1a1f09ab49';

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      // 危険ワード検知
      const matchedWord = dangerWords.find(word => userMessage.includes(word));
      if (matchedWord) {
        // 通知メッセージ送信（グループ宛）
        try {
          await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
              to: groupId,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 重要メッセージを検知: 「${matchedWord}」\n📞 ご連絡は 090-4839-3313 までお願いいたします。`
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
        } catch (err) {
          console.error('グループ通知エラー:', err.message);
        }
      }

      // 通常の返信
      await client.replyMessage(replyToken, [
        {
          type: 'text',
          text: '大丈夫ですか？ご無理なさらず、少しずつ進んでいきましょう。'
        }
      ]);
    }
  }

  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
