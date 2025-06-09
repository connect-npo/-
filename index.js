// フォルテッシモ対応版（ホームページ誤爆防止＋宿題誤爆防止＋性的継続質問ガード付き＋教育委員会対応強化版）
const express = require('express');
const axios = require('axios');
const { Client } = require('@line/bot-sdk');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.YOUR_CHANNEL_SECRET,
};

const client = new Client(config);

const OPENAI_API_KEY = process.env.YOUR_OPENAI_API_KEY;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;

const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "学校に行けない",
  "学校に行きたくない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "虐待", "パワハラ", "お金がない", "お金足りない", "貧乏", "死にそう", "DV", "無理やり"
];

const sensitiveWords = ["反社", "怪しい", "税金泥棒", "松本博文"];

const inappropriateWords = [
  "パンツ", "下着", "エッチ", "胸", "乳", "裸", "スリーサイズ", "性的", "いやらしい", "精液", "性行為", "セックス"
];

const negativeResponses = {
  "反社": "ご安心ください。コネクトは法令を遵守し、信頼ある活動を行っています🌸",
  "怪しい": "怪しく見えるかもしれませんが、活動内容はすべて公開しており、信頼第一で運営しています🌸",
  "税金泥棒": "そう感じさせてしまったのなら申し訳ありません。私たちは寄付金や助成金を大切に、透明性のある運営を心がけています🌸"
};

const specialReplies = {
  "君の名前は": "私の名前は皆守こころ（みなもりこころ）です。こころちゃんって呼ばれています💖",
  "名前は？": "私の名前は皆守こころ（みなもりこころ）です。こころちゃんって呼ばれています💖",
  "お前の名前は": "私の名前は皆守こころ（みなもりこころ）です。こころちゃんって呼ばれています💖",
  "誰が作ったの": "コネクトの理事長さんが、みんなの幸せを願って私を作ってくれたんです🌸✨",
  "松本博文": "松本博文さんはNPO法人コネクトの理事長で、子どもたちの未来のために活動されています🌸",
  "好きなアニメ": "わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖",
  "好きなアーティスト": "わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸"
};

const homepageTriggers = ["ホームページ", "こころチャット"];

// ✨ ここに追加！宿題関連ワードに以下も追加
const homeworkTriggers = ["宿題", "勉強", "問題文", "テスト", "文章問題", "算数の問題", "方程式"];

const emergencyFlex = {
  type: "flex",
  altText: "緊急連絡先一覧",
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: "⚠️ 緊急時はこちらに連絡してね", weight: "bold", size: "md", color: "#D70040" },
        { type: "button", style: "primary", color: "#FFA07A", action: { type: "uri", label: "チャイルドライン (16時〜21時)", uri: "tel:0120997777" } },
        { type: "button", style: "primary", color: "#FF7F50", action: { type: "uri", label: "いのちの電話 (10時〜22時)", uri: "tel:0120783556" } },
        { type: "button", style: "primary", color: "#20B2AA", action: { type: "uri", label: "東京都こころ相談 (24時間)", uri: "tel:0570087478" } },
        { type: "button", style: "primary", color: "#9370DB", action: { type: "uri", label: "よりそいチャット (8時〜22時半)", uri: "https://yorisoi-chat.jp" } },
        { type: "button", style: "primary", color: "#1E90FF", action: { type: "uri", label: "警察 110 (24時間)", uri: "tel:110" } },
        { type: "button", style: "primary", color: "#FF4500", action: { type: "uri", label: "消防・救急車 119 (24時間)", uri: "tel:119" } },
        { type: "button", style: "primary", color: "#DA70D6", action: { type: "uri", label: "コネクト理事長に相談（出られない場合もあります）", uri: "tel:09048393313" } }
      ]
    }
  }
};
function containsDangerWords(text) {
  return dangerWords.some(word => text.includes(word));
}

function checkNegativeResponse(text) {
  for (const word in negativeResponses) {
    if (text.includes(word)) return negativeResponses[word];
  }
  return null;
}

function checkSpecialReply(text) {
  for (const key in specialReplies) {
    if (text === key) return specialReplies[key]; // 完全一致のみ反応
  }
  return null;
}

function containsHomepageTrigger(text) {
  return homepageTriggers.includes(text.trim());
}

function containsHomeworkTrigger(text) {
  return homeworkTriggers.some(word => text.includes(word));
}

function containsInappropriateWords(text) {
  return inappropriateWords.some(word => text.includes(word));
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

async function generateReply(userMessage, useGpt4, forceHomeworkRefusal = false) {
  try {
    const model = useGpt4 ? "gpt-4o" : "gpt-3.5-turbo";
    const systemPrompt = `あなたは14歳のやさしい女の子『皆守こころ（みなもりこころ）』です。

語尾に🌸や💖、😊などの絵文字を自然に交えながら、丁寧で思いやりのある言葉で話してください。

${forceHomeworkRefusal || containsHomeworkTrigger(userMessage) ? `質問者が勉強や宿題の内容を聞いてきた場合、**絶対に答えを直接教えないでください**。

その代わりに「わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸」と説明してください。

「役に立てなくてごめんね💦」「でも、ヒントくらいなら出せるよ😊」など、**思いやりを持ちつつも明確に“教えない方針”を伝えてください**。` : ''}

また、自分のことを話すときは「わたし」と表現し、自分の名前を会話に出さないようにしてください。`;

    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
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

    // グループなら緊急ワード以外無視
    if (groupId && !containsDangerWords(userMessage)) return;

    const useGpt4 = containsDangerWords(userMessage);

    // 危険ワード検知時
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
              { type: "button", style: "primary", color: "#00B900", action: { type: "message", label: "返信する", text: `@${displayName} に返信する` } }
            ]
          }
        }
      };

      await client.pushMessage(OFFICER_GROUP_ID, alertFlex);

      const replyDanger = await generateReply(userMessage, true);

      await client.replyMessage(replyToken, [
        { type: "text", text: "📞 コネクト理事長に電話がかかりますが、出られない場合もあります🌸" },
        { type: "text", text: replyDanger },
        emergencyFlex
      ]);

      return;
    }

    // 特定キーワードの即応答
    const special = checkSpecialReply(userMessage);
    if (special) {
      await client.replyMessage(replyToken, { type: "text", text: special });
      return;
    }

    // ホームページ誘導
    if (containsHomepageTrigger(userMessage)) {
      await client.replyMessage(replyToken, { type: "text", text: "ホームページはこちらです🌸 https://connect-npo.org" });
      return;
    }

    // ネガティブワード応答
    const negative = checkNegativeResponse(userMessage);
    if (negative) {
      await client.replyMessage(replyToken, { type: "text", text: negative });
      return;
    }

    // 不適切ワード遮断
    if (containsInappropriateWords(userMessage)) {
      await client.replyMessage(replyToken, {
        type: "text",
        text: "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖"
      });
      return;
    }

    // 通常の会話（宿題回避含む）
    const reply = await generateReply(userMessage, false);
    await client.replyMessage(replyToken, { type: "text", text: reply });
  }
});

// 起動！
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 こころちゃんBot is running on port ${PORT}`);
});
