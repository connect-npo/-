require('dotenv').config();
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();
const port = process.env.PORT || 10000;

const config = {
  channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.YOUR_CHANNEL_SECRET,
};

const client = new Client(config);

// 危険ワード一覧（検出時にグループ通知）
const dangerWords = [
  "しにたい", "自殺", "消えたい", "つらい", "助けて", "死にたい", "苦しい",
  "学校に行けない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "貧乏", "お金が足りない"
];

const GROUP_ID = process.env.GROUP_ID;

app.post('/webhook', middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const messageText = event.message.text;

  // 危険ワードチェック
  const foundWord = dangerWords.find(word => messageText.includes(word));
  if (foundWord) {
    // グループに通知
    await client.pushMessage(GROUP_ID, {
      type: 'text',
      text: `⚠️ 危険ワード「${foundWord}」を含むメッセージを検出しました：\n${messageText}`
    });

    // 利用者へ返信
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'つらいときは、ひとりで抱え込まないでください。\n\nどうしようもないときは、こちらへお電話ください 📞\n090-4839-3313'
    });
  }

  // 通常の応答（こころちゃん）
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `こころちゃんです🌸\n「${messageText}」って送ってくれてありがとう！\n何かあれば、いつでもお話ししてね☺️`
  });
}

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
