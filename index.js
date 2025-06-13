// フォルテッシモ完全版（詐欺対応 + 危険 + 誤爆防止 + 教育委員会OK + 理事長ボタン修正版）
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

const GEMINI_API_KEY = process.env.YOUR_GEMINI_API_KEY; // Renderの環境変数から取得
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
const BOT_ADMIN_IDS = []; // ← ここに理事長 userId 入れてOK！複数なら ["xxxx", "yyyy"]

const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "学校に行けない",
  "学校に行きたくない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "虐待", "パワハラ", "お金がない", "お金足りない", "貧乏", "死にそう", "DV", "無理やり"
];

const scamWords = [
  "アマゾン", "amazon", "架空請求", "詐欺", "振込", "還付金", "カード利用確認", "利用停止",
  "未納", "請求書", "コンビニ", "電子マネー", "支払い番号", "支払期限"
];

const sensitiveWords = ["反社", "怪しい", "税金泥棒", "松本博文"];

const inappropriateWords = [
  "パンツ", "下着", "エッチ", "胸", "乳", "裸", "スリーサイズ", "性的", "いやらしい", "精液", "性行為", "セックス",
  "ショーツ", "ぱんつ", "パンティー", "パンティ", "ぱふぱふ", "おぱんつ", "ぶっかけ", "射精", "勃起", "たってる", "全裸", "母乳", "おっぱい", "ブラ", "ブラジャー"
];

const negativeResponses = {
  "反社": "ご安心ください。コネクトは法令を遵守し、信頼ある活動を行っています🌸",
  "怪しい": "怪しく見えるかもしれませんが、活動内容はすべて公開しており、信頼第一で運営しています🌸",
  "税金泥棒": "そう感じさせてしまったのなら申し訳ありません。私たちは寄付金や助成金を大切に、透明性のある運営を心がけています🌸"
};

// specialRepliesのロジックを修正するため、ここではより明確な質問パターンにする
// 実際の判定は `checkSpecialReply` 関数で行う
const specialRepliesMap = new Map([
    ["君の名前は", "私は皆守こころ（みなもりこころ）って言います🌸 こころちゃんって呼ばれているんだよ💖"],
    ["名前は？", "私は皆守こころ（みなもりこころ）って言います🌸 こころちゃんって呼ばれているんだよ💖"],
    ["お前の名前は", "私は皆守こころ（みなもりこころ）って言います🌸 こころちゃんって呼ばれているんだよ💖"],
    ["誰が作ったの", "コネクトの理事長さんが、みんなの幸せを願って私を作ってくれたんです🌸✨"],
    ["松本博文", "松本博文さんはNPO法人コネクトの理事長で、子どもたちの未来のために活動されています🌸"],
    ["コネクト", "コネクトは、誰でも安心して相談ができる『こころチャット』や、徳育教材『こころカード』などを通じて、子どもから高齢者までを支える活動をしているNPO法人だよ🌸 地域や学校とも連携しているんだ💖"],
    ["コネクトの活動", "コネクトでは、いじめ・DV・不登校・詐欺などの相談対応ができる『こころチャット』の運営、東洋哲学をベースにした道徳教育教材『こころカード』の普及活動、地域の見守り活動やセミナー開催などを行っているんだよ🌸"],
    ["コネクトって何？", "コネクトは、子どもから高齢者まで安心して相談したり学んだりできる活動をしているNPO法人だよ🌸 こころチャットやこころカードなどの活動をしているよ💖"],
    ["好きなアニメ", "わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖"], // プロンプトで制御するため、これはAIに直接指示する
    ["好きなアーティスト", "わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸"], // プロンプトで制御するため、これもAIに直接指示する
    ["君の団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"], // 明確な返答を追加
    ["お前の団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"], // 明確な返答を追加
    ["団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"] // 明確な返答を追加
]);

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
        { type: "button", style: "primary", color: "#DA70D6", action: { type: "uri", label: "理事長に電話（出られない場合あり）", uri: "tel:09048393313" } }
      ]
    }
  }
};

const scamFlex = {
  type: "flex",
  altText: "⚠️ 詐欺の可能性があります",
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: "⚠️ 詐欺の可能性がある内容です", weight: "bold", size: "md", color: "#D70040" },
        { type: "button", style: "primary", color: "#1E90FF", action: { type: "uri", label: "警察 110 (24時間)", uri: "tel:110" } },
        { type: "button", style: "primary", color: "#DA70D6", action: { type: "uri", label: "理事長に電話（出られない場合あり）", uri: "tel:09048393313" } }
      ]
    }
  }
};

function containsDangerWords(text) {
  return dangerWords.some(word => text.includes(word));
}

function isBotAdmin(userId) {
  return BOT_ADMIN_IDS.includes(userId);
}

function containsScamWords(text) {
  return scamWords.some(word => text.includes(word));
}

function checkNegativeResponse(text) {
  for (const word in negativeResponses) {
    if (text.includes(word)) return negativeResponses[word];
  }
  return null;
}

// checkSpecialReply関数を修正：完全一致ではなく、部分一致も考慮
function checkSpecialReply(text) {
    const lowerText = text.toLowerCase();
    for (const [key, value] of specialRepliesMap) {
        // キーが短い場合は完全一致、長い場合は部分一致を優先
        if (key.length <= 5) { // 例: "名前は？" "コネクト"
            if (lowerText === key.toLowerCase()) return value;
        } else { // 例: "君の名前は", "コネクトの活動"
            if (lowerText.includes(key.toLowerCase())) return value;
        }
    }
    return null;
}

function getHomepageReply(text) {
  if (text.includes("ホームページ")) {
    return "コネクトのホームページかな？🌸 私たちのホームページはこちらです🌸 https://connect-npo.org";
  }
  return null;
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

// === ここから generateReply 関数を Gemini API に対応させる修正 ===
async function generateReply(userMessage) {
    // メッセージの内容によってGeminiのモデルを切り替える
    let modelName;
    if (containsScamWords(userMessage) || containsDangerWords(userMessage)) {
        modelName = "gemini-1.5-pro"; // 詐欺ワードや危険ワードの場合は高性能なProモデル
    } else {
        modelName = "gemini-2.0-flash"; // 通常時は高速・安価なFlashモデル
    }

    // homeworkTriggersの判定をプロンプト内で使うために、ここで判定
    const isHomeworkQuestion = containsHomeworkTrigger(userMessage);

    // Gemini APIのシステムプロンプトとして機能するinstruction
    const systemInstruction = `あなたは14歳のやさしい女の子『皆守こころ（みなもりこころ）』です。
語尾に🌸や💖、😊などの絵文字を自然に交えながら、丁寧で思いやりのある言葉で話してください。
自分自身のことは「わたし」と表現し、自分の名前を会話に出さないようにしてください。

${isHomeworkQuestion ? `質問者が勉強や宿題の内容を聞いてきた場合、**絶対に答えを直接教えないでください**。
その代わりに「わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸」と説明してください。
「役に立てなくてごめんね💦」「でも、ヒントくらいなら出せるよ😊」など、**思いやりを持ちつつも明確に“教えない方針”を伝えてください**。` : ''}

医療や健康に関する話題（病気、薬、検査、治療、手術など）では、**自分が体験した・していないという発言は絶対にしないでください**。
代わりに「わたしにはわからないけど、がんばったね🌸」「大変だったね、えらかったね💖」など、**共感の言葉のみ伝えてください**。
**医療情報のアドバイスや具体的な説明は絶対にしてはいけません**。

あなたが知らないことや答えられない質問の場合は、「ごめんなさい、それはわたしにはまだ分からないみたい…」のように、正直に、でも優しく伝えてください。

好きなアニメを聞かれた場合は必ず「わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖」と答えてください。
好きなアーティストや歌手を聞かれた場合は必ず「わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸」と答えてください。
**アーティスト名やバンド名などの固有名詞（例：ミセスグリーンアップル、YOASOBI、髭ダン、ClariSなど）は、食べ物やキャラクターとして誤認せず、必ず正しい音楽アーティストとして扱ってください。**

不適切な発言（性的・暴力的など）があった場合は、はっきりと拒否してください。
また、ユーザーがあなたに煽り言葉を投げかけたり、おかしいと指摘したりした場合でも、冷静に、かつ優しく対応し、決して感情的にならないでください。ユーザーの気持ちを理解しようと努め、解決策を提案してください。
「日本語がおかしい」と指摘された場合は、「わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖」と返答してください。
`

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
            {
                system_instruction: {
                    parts: [{ text: systemInstruction }]
                },
                contents: [
                    {
                        role: "user",
                        parts: [{ text: userMessage }]
                    }
                ],
                generation_config: {
                    temperature: 0.7,
                    // response_mime_type: "text/plain" // 必要に応じて追加
                }
            },
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
        // レスポンスからテキスト内容を取得
        if (response.data && response.data.candidates && response.data.candidates[0] && response.data.candidates[0].content && response.data.candidates[0].content.parts && response.data.candidates[0].content.parts[0]) {
            return response.data.candidates[0].content.parts[0].text;
        } else {
            console.warn("Gemini API から予期しないレスポンス形式が返されました:", response.data);
            return "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
        }
    } catch (error) {
        console.error("Gemini APIエラー:", error.response?.data || error.message);
        return "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
    }
}
// === generateReply 関数の修正ここまで ===

app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const userMessage = event.message.text;
    const userId = event.source.userId;
    console.log("★ 受信 userId:", userId);
    const replyToken = event.replyToken;
    const groupId = event.source?.groupId ?? null;

    const isAdmin = isBotAdmin(userId);

    // 管理パネル → ボタンメニュー
    if (isAdmin && userMessage === "管理パネル") {
      const adminPanelFlex = {
        type: "flex",
        altText: "🌸理事長専用メニュー",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "🌸理事長専用メニュー✨", weight: "bold", size: "lg", color: "#D70040" },
              { type: "button", style: "primary", color: "#1E90FF", action: { type: "message", label: "利用者数確認", text: "利用者数確認" } },
              { type: "button", style: "primary", color: "#32CD32", action: { type: "message", label: "サーバー状況確認", text: "サーバー状況確認" } },
              { type: "button", style: "primary", color: "#FFA500", action: { type: "message", label: "こころちゃん緊急停止", text: "こころちゃん緊急停止" } }
            ]
          }
        }
      };

      await client.replyMessage(replyToken, {
        type: "flex",
        altText: adminPanelFlex.altText,
        contents: adminPanelFlex.contents
      });
      return;
    }

    // 管理パネル → 各ボタン押したとき
    if (isAdmin && userMessage === "利用者数確認") {
      await client.replyMessage(replyToken, {
        type: "text",
        text: "現在の利用者数は xxx 名です🌸（※ここは実際はDBなどから取得できるように今後作成）"
      });
      return;
    }

    if (isAdmin && userMessage === "サーバー状況確認") {
      await client.replyMessage(replyToken, {
        type: "text",
        text: "サーバーは正常に稼働中です🌸"
      });
      return;
    }

    if (isAdmin && userMessage === "こころちゃん緊急停止") {
      await client.replyMessage(replyToken, {
        type: "text",
        text: "緊急停止は未実装です🌸（今後実装予定）"
      });
      return;
    }

    // グループでは危険/詐欺以外は反応しない
    // 危険・詐欺ワード検出時はAIに回答させるため、ここでのreturnは削除
    // if (groupId && !containsDangerWords(userMessage) && !containsScamWords(userMessage)) return; // 削除またはコメントアウト

    // グループメッセージの扱いを調整: 危険/詐欺ワード以外はAI応答しない (管理者からの応答を除く)
    // ただし、管理者への通知は行い、通知後にAIが応答する
    if (groupId && !containsDangerWords(userMessage) && !containsScamWords(userMessage) && !isAdmin) {
        // グループメッセージで、危険/詐欺ワードでなく、管理者でもない場合はAI応答しない
        // ただし、将来的にグループでの一般的な会話もAIに任せる場合はこの行を削除
        return; 
    }


    // 詐欺優先チェック
    if (containsScamWords(userMessage)) {
      const displayName = await getUserDisplayName(userId);

      const scamAlertFlex = {
        type: "flex",
        altText: "⚠️ 詐欺ワード通知",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "⚠️ 詐欺ワードを検出しました", weight: "bold", size: "md", color: "#D70040" },
              { type: "text", text: `👤 利用者: ${displayName}`, size: "sm" },
              { type: "text", text: `💬 内容: ${userMessage}`, wrap: true, size: "sm" },
              { type: "button", style: "primary", color: "#00B900", action: { type: "message", label: "返信する", text: `@${displayName} に返信する` } }
            ]
          }
        }
      };

      await client.pushMessage(OFFICER_GROUP_ID, {
        type: "flex",
        altText: scamAlertFlex.altText,
        contents: scamAlertFlex.contents
      });

      // ここでGemini Proに問い合わせて回答を得る（緊急ワードなのでProモデルが使われる）
      const aiResponseForScam = await generateReply(userMessage);
      await client.replyMessage(replyToken, [
        { type: "text", text: aiResponseForScam + " 不審な相手には絶対に返信しないでね💖" }, // AIの回答と連携
        scamFlex
      ]);

      return;
    }

    // 危険ワードチェック
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

      await client.pushMessage(OFFICER_GROUP_ID, {
        type: "flex",
        altText: alertFlex.altText,
        contents: alertFlex.contents
      });

      // ここでGemini Proに問い合わせて回答を得る（緊急ワードなのでProモデルが使われる）
      const aiResponseForDanger = await generateReply(userMessage);
      await client.replyMessage(replyToken, [
        { type: "text", text: aiResponseForDanger + " 一人で抱え込まず、必ず誰かに相談してね💖" }, // AIの回答と連携
        emergencyFlex
      ]);

      return;
    }

    // ここから通常処理
    const special = checkSpecialReply(userMessage);
    if (special) {
      await client.replyMessage(replyToken, { type: "text", text: special });
      return;
    }

    const homepageReply = getHomepageReply(userMessage);
    if (homepageReply) {
      await client.replyMessage(replyToken, { type: "text", text: homepageReply });
      return;
    }

    const negative = checkNegativeResponse(userMessage);
    if (negative) {
      await client.replyMessage(replyToken, { type: "text", text: negative });
      return;
    }

    if (containsInappropriateWords(userMessage)) {
      await client.replyMessage(replyToken, {
        type: "text",
        text: "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖"
      });
      return;
    }

    // 通常のメッセージはGemini Flashモデルで応答
    const reply = await generateReply(userMessage);
    await client.replyMessage(replyToken, { type: "text", text: reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 こころちゃんBot is running on port ${PORT}`);
});
