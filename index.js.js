import express from "express";
import { Client, middleware, SignatureValidationFailed, JSONParseError } from "@line/bot-sdk";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

const groupIdToAlert = "YOUR_GROUP_ID";

const alertWords = [
  "しにたい", "死にたい", "自殺", "じさつ", "もうだめ", "限界", "消えたい",
  "いなくなりたい", "存在しない方がいい", "おわりにしたい", "生きていたくない",
  "うつ", "鬱", "ねむれない", "つらい", "疲れた", "泣きたい", "たべられない",
  "やる気が出ない", "誰にも言えない", "頑張れない", "何もしたくない", "ひとりぼっち",
  "不安", "不登校", "いじめ", "仲間はずれ", "無視された", "学校行きたくない",
  "友達いない", "暴力", "怖い", "先生が怖い", "叩かれた",
  "たすけて", "やばいです", "SOS", "困っています"
];

app.post("/line/webhook", middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const msg = event.message.text;
      const found = alertWords.find((w) => msg.includes(w));
      if (found) {
        await client.pushMessage(groupIdToAlert, {
          type: "text",
          text: `🚨 注意ワード「${found}」が検出されました\n内容: ${msg}`,
        });
      }

      const reply = await askGPT(msg);

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `${reply}\n\n⚠このBotはAIが自動応答しています。\n緊急時は保護者や大人に相談してください。`,
      });
    }
  }

  res.status(200).end();
});

app.use((err, req, res, next) => {
  if (err instanceof SignatureValidationFailed) {
    res.status(401).send("署名が一致しません");
    return;
  } else if (err instanceof JSONParseError) {
    res.status(400).send("無効なJSON形式です");
    return;
  }
  next(err);
});

async function askGPT(userInput) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: userInput }],
        max_tokens: 200,
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "うまく応答できませんでした。";
  } catch (error) {
    return "現在、AIの応答ができません。";
  }
}

app.listen(3000, () => {
  console.log("Bot起動中（ポート3000）");
});
