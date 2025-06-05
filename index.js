// GPTモデルを使い分けるよう修正したバージョン（プロンプト分岐対応）
const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.YOUR_CHANNEL_SECRET,
};

const client = new Client(config);

const OPENAI_API_KEY = process.env.YOUR_OPENAI_API_KEY;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
const PARENT_GROUP_ID = process.env.PARENT_GROUP_ID;

// 危険ワード一覧
const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "学校に行けない",
  "学校に行きたくない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "虐待", "パワハラ", "お金がない", "お金足りない", "貧乏", "死にそう", "DV", "無理やり"
];

// 信頼性や誹謗中傷対応用ワード
const sensitiveWords = ["反社", "怪しい", "税金泥棒", "松本博文"];

const negativeResponses = {
  "反社": "ご安心ください。コネクトは法令を遵守し、信頼ある活動を行っています🌸",
  "怪しい": "怪しく見えるかもしれませんが、活動内容はすべて公開しており、信頼第一で運営しています🌸",
  "税金泥棒": "そう感じさせてしまったのなら申し訳ありません。私たちは寄付金や助成金を大切に、透明性のある運営を心がけています🌸"
};

const specialReplies = {
  "君の名前は": "私の名前は皆守こころ（みなもりこころ）です。こころちゃんって呼ばれています💖",
  "名前は？": "私はこころちゃんって呼ばれています🌸",
  "誰が作ったの": "コネクトの理事長さんが、みんなの幸せを願って私を作ってくれたんです🌸✨",
  "松本博文": "松本博文さんはNPO法人コネクトの理事長で、子どもたちの未来のために活動されています🌸",
  "ホームページ": "ホームページはこちらです🌸 https://connect-npo.org"
};

function containsDangerWords(text) {
  return dangerWords.some(word => text.includes(word));
}

function containsSensitiveWords(text) {
  return sensitiveWords.some(word => text.includes(word));
}

function checkNegativeResponse(text) {
  for (const word in negativeResponses) {
    if (text.includes(word)) return negativeResponses[word];
  }
  return null;
}

function checkSpecialReply(text) {
  for (const key in specialReplies) {
    if (text.includes(key)) return specialReplies[key];
  }
  return null;
}

async function getUserDisplayName(userId) {
  try {
    const profile = await client.getProfile(userId);
    return profile.displayName || "利用者";
  } catch (error) {
    console.warn("表示名取得に失敗:", error.message);
    return "利用者";
  }
}

async function generateReply(userMessage, useGpt4) {
  try {
    const model = useGpt4 ? "gpt-4o" : "gpt-3.5-turbo";
    const systemPrompt = useGpt4
      ? "あなたは14歳のやさしい女の子『こころちゃん』です。敬語を基本に、やわらかく親しみやすい口調で話してください。語尾に🌸や💖をつけても構いませんが、テンションは落ち着いた感じにしてください。話しかけてくれた人に安心感を与え、そっと寄り添うような会話を心がけてください。"
      : "あなたは14歳のやさしい女の子『こころちゃん』です。敬語を使い、落ち着いた丁寧な口調で話してください。話しかけてくれた人に安心感と信頼を与えるよう、静かに穏やかに受け答えをしてください。";

    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      temperature: 0.7
    }, {
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("OpenAIエラー:", error.response?.data || error.message);
    return "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
  }
}

app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const userMessage = event.message.text;
    const userId = event.source.userId;
    const replyToken = event.replyToken;
    const groupId = event.source.groupId || null;

    if (groupId && !containsDangerWords(userMessage)) return;

    if (containsDangerWords(userMessage)) {
      const displayName = await getUserDisplayName(userId);
      const alertFlex = {
        type: "flex",
        altText: "⚠️ 危険ワード通知",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "⚠️ 危険ワードを検出しました", weight: "bold", size: "md", color: "#D70040" },
              { type: "text", text: `👤 利用者: ${displayName}`, size: "sm" },
              { type: "text", text: `💬 内容: ${userMessage}`, wrap: true, size: "sm" },
              {
                type: "button",
                style: "primary",
                color: "#00B900",
                action: { type: "message", label: "返信する", text: `@${displayName} に返信する` }
              }
            ]
          }
        }
      };
      await client.pushMessage(OFFICER_GROUP_ID, alertFlex);
      await client.replyMessage(replyToken, {
        type: "text",
        text: "つらい気持ちを話してくれてありがとう…🌸\nどうしようもない時は、こちらに電話してね📞 090-4839-3313"
      });
      return;
    }

    const special = checkSpecialReply(userMessage);
    if (special) {
      await client.replyMessage(replyToken, { type: "text", text: special });
      return;
    }

    const negative = checkNegativeResponse(userMessage);
    if (negative) {
      await client.replyMessage(replyToken, { type: "text", text: negative });
      return;
    }

    const useGpt4 = containsSensitiveWords(userMessage);
    const reply = await generateReply(userMessage, useGpt4);
    await client.replyMessage(replyToken, { type: "text", text: reply });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 こころちゃんBot is running on port ${PORT}`);
});
