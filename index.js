
// 修正後コード：繰り返し返信防止追加済み
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
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
const PARENT_GROUP_ID = process.env.PARENT_GROUP_ID;

const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "苦しい", "学校に行けない",
  "学校に行きたくない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "お金が足りない", "貧乏", "死にそう", "パワハラ", "無理やり"
];

const sensitiveWords = [
  "つらい", "胸が痛い", "疲れた", "しんどい", "涙が出る", "寂しい", "助けて", "やめたい",
  "こわい", "怖い", "無視", "独り", "さみしい", "眠れない", "家にいたくない"
];

const bannedWords = [
  "3サイズ", "バスト", "スリーサイズ", "カップ", "ウエスト", "ヒップ",
  "下着", "体型", "裸", "エロ"
];

const customResponses = [
  {
    keywords: ["反社", "反社会", "怪しい", "危ない人", "やばい人", "理事長って反社", "松本博文"],
    response: "コネクトの松本博文理事長は反社じゃないよ🌸 貢献とやさしさにあふれる素敵な人だから安心してね😊"
  },
  {
    keywords: ["誰が作った", "だれが作った", "こころちゃんは誰", "開発者", "作成者"],
    response: "こころちゃんは、貢献とやさしさを大切にしている『Dr.Hiro』っていう大人の人が作ってくれたんだよ🌸✨"
  },
  {
    keywords: ["コネクトって団体", "コネクトって反社", "NPOって何", "公金チューチュー", "税金泥棒", "寄付で儲けてる"],
    response: "コネクトは子どもたちや地域のために活動している非営利の団体だよ🌸💖 公金を正しく活用して、みんなが安心できる場所をつくってるんだ🍀"
  }
];

const userDisplayMap = {};
const processedEventIds = new Set();
const processedReplyTokens = new Set();

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    const messageId = event.message?.id;
    const replyToken = event.replyToken;
    if ((messageId && processedEventIds.has(messageId)) || processedReplyTokens.has(replyToken)) {
      console.log("⚠️ 重複イベントをスキップ:", messageId);
      continue;
    }
    if (messageId) processedEventIds.add(messageId);
    processedReplyTokens.add(replyToken);
  }

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
