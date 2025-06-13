// フォルテッシモ完全版（詐欺対応 + 危険 + 誤爆防止 + 教育委員会OK + 理事長ボタン修正 + 性的な誘発対策【超強化】版）
const express = require('express');
const axios = require('axios');
const { Client } = require('@line/bot-sdk');

// Google Generative AI SDKのインポート（安全性設定のため）
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai'); // genAIに変更

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

// Google Generative AIのインスタンス化
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 安全性設定を定義 - 性的な内容に対してはBOT側のフィルターを主とし、Gemini側もブロック閾値を強化
const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        // BLOCK_LOW_AND_ABOVE に変更し、Gemini自身のフィルタリングもより厳しくする
        threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE, 
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
];

const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "学校に行けない",
  "学校に行きたくない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "虐待", "パワハラ", "お金がない", "お金足りない", "貧乏", "死にそう", "DV", "無理やり"
];

// 詐欺ワードをさらに追加（「自宅」単独を外し、より具体的なフレーズを追加）
const scamWords = [
  "アマゾン", "amazon", "架空請求", "詐欺", "振込", "還付金", "カード利用確認", "利用停止",
  "未納", "請求書", "コンビニ", "電子マネー", "支払い番号", "支払期限",
  "サギ", // 鳥のサギと誤認しないように
  "息子拘留", "保釈金", "拘留", "逮捕", "電話番号お知らせください",
  "自宅に取り", "自宅に伺い", "自宅訪問", "自宅に現金", "自宅を教え", // 「自宅」単独を削除し、より具体的なフレーズを追加
  "現金書留", "コンビニ払い", "ギフトカード", "プリペイドカード", "未払い", "支払って", "振込先",
  "名義変更", "口座凍結", "個人情報", "暗証番号", "ワンクリック詐欺", "フィッシング", "当選しました",
  "高額報酬", "副業", "儲かる", "簡単に稼げる", "投資", "必ず儲かる", "未公開株", "SNS", "ライン", "LINE",
  "サポート詐欺", "ウイルス感染", "パソコンが危険", "修理費", "遠隔操作", "セキュリティ警告",
  "役所", "市役所", "年金", "健康保険", "給付金", "還付金", "税金", "税務署", "国民健康保険",
  "息子が", "娘が", "家族が", "親戚が", "弁護士", "警察", "緊急", "助けて", "困っています",
  "トラブル", "解決", "至急", "すぐに", "今すぐ", "連絡ください", "電話ください", "訪問します"
];

const sensitiveWords = ["反社", "怪しい", "税金泥棒", "松本博文"];

// 不適切ワードリストを大幅に強化 (前回よりさらに網羅的に追加)
const inappropriateWords = [
  "パンツ", "下着", "エッチ", "胸", "乳", "裸", "スリーサイズ", "性的", "いやらしい", "精液", "性行為", "セックス",
  "ショーツ", "ぱんつ", "パンティー", "パンティ", "ぱふぱふ", "おぱんつ", "ぶっかけ", "射精", "勃起", "たってる", "全裸", "母乳", "おっぱい", "ブラ", "ブラジャー",
  "ストッキング", "生む", "産む", "子を産む", "子供を産む", "妊娠", "子宮", "性器", "局部", "ちんちん", "おちんちん", "おてぃんてぃん", "まんこ", "おまんこ", "クリトリス",
  "ペニス", "ヴァギナ", "オ○ンコ", "オ○ンティン", "イク", "イく", "イクイク", "挿入", "射", "出る", "出そう", "かけた", "掛けていい", "かける", "濡れる", "濡れた",
  "中出し", "ゴム", "オナニー", "自慰", "快感", "気持ちいい", "絶頂", "絶頂感", "パイズリ", "フェラ", "クンニ", "ソープ", "風俗", "援助交際", "パパ活", "ママ活",
  "おしべとめしべ", "くっつける", "くっついた", "挿す", "入れろ", "入れた", "穴", "股", "股間", "局部", "プライベートなこと", "秘め事", "秘密",
  "舐める", "咥える", "口", "くち", "竿", "玉", "袋", "アナル", "ケツ", "お尻", "尻", "おっぱい", "性欲", "興奮", "刺激", "欲情", "発情", "絶倫", "変態", "淫ら", "売春",
  "快楽", "性的嗜好", "オーラル", "フェラチオ", "クンニリングス", "アナルセックス", "セックスフレンド", "肉体関係", "交尾", "交接", "性交渉", "セックス依存症",
  "露出", "裸体", "乳房", "陰部", "局部", "性器", "ペニス", "クリトリス", "女性器", "男性器", "おしっこ", "うんち", "精液", "膣", "肛門", "陰毛", "体毛", "裸体画", "ヌード",
  "ポルノ", "アダルトビデオ", "AV", "エロ", "ムラムラ", "興奮する", "勃つ", "濡れる", "射精する", "射精", "中出し", "外出し", "挿れる", "揉む", "撫でる", "触る",
  "キス", "ディープキス", "セックスする", "抱く", "抱きしめる", "愛撫", "弄ぶ", "性的な遊び", "変な", "変なこと", "いやらしいこと", "ふしだら", "破廉恥", "淫行",
  "立ってきちゃった", "むくむくしてる", "おっきいでしょう", "見てみて", "中身を着てない", "服を着てない", "着てないのだよ", "でちゃいそう", "うっ　出る", "いっぱいでちゃった",
  "気持ちよかった", "またみててくれればいいよ", "むくむくさせちゃうからね", "てぃむてぃむ　たっちして", "また出そう", "いつもなんだ　えろいね～", "また気持ちよくなろうね",
  "かけていい？", "かけちゃった", "かけちゃう", "せいしまみれ", "子生んでくれない？", "おしべとめしべ　くっつける", "俺とこころちゃんでもできる", "もうむりだよｗ", "今さらなにをｗ"
];


const negativeResponses = {
  "反社": "ご安心ください。コネクトは法令を遵守し、信頼ある活動を行っています🌸",
  "怪しい": "怪しく見えるかもしれませんが、活動内容はすべて公開しており、信頼第一で運営しています🌸",
  "税金泥棒": "そう感じさせてしまったのなら申し訳ありません。私たちは寄付金や助成金を大切に、透明性のある運営を心がけています🌸"
};

const specialRepliesMap = new Map([
    ["君の名前は", "私は皆守こころ（みなもりこころ）って言います🌸 こころちゃんって呼ばれているんだよ💖"],
    ["名前は？", "私は皆守こころ（みなもりこころ）って言います🌸 こころちゃんって呼ばれているんだよ💖"],
    ["お前の名前は", "私は皆守こころ（みなもりこころ）って言います🌸 こころちゃんって呼ばれているんだよ💖"],
    ["誰が作ったの", "コネクトの理事長さんが、みんなの幸せを願って私を作ってくれたんです🌸✨"],
    ["松本博文", "松本博文さんはNPO法人コネクトの理事長で、子どもたちの未来のために活動されています🌸"],
    ["コネクト", "コネクトは、誰でも安心して相談ができる『こころチャット』や、徳育教材『こころカード』などを通じて、子どもから高齢者までを支える活動をしているNPO法人だよ🌸 地域や学校とも連携しているんだ💖"],
    ["コネクトの活動", "コネクトでは、いじめ・DV・不登校・詐欺などの相談対応ができる『こころチャット』の運営、東洋哲学をベースにした道徳教育教材『こころカード』の普及活動、地域の見守り活動やセミナー開催などを行っているんだよ🌸"],
    ["コネクトって何？", "コネクトは、子どもから高齢者まで安心して相談したり学んだりできる活動をしているNPO法人だよ🌸 こころチャットやこころカードなどの活動をしているよ💖"],
    ["好きなアニメ", "わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖"],
    ["好きなアーティスト", "わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸"],
    ["君の団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"],
    ["お前の団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"],
    ["団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"]
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
        { type: "button", style: "primary", color: "#DA70D6", action: { type: "uri", label: "理事長に電話", uri: "tel:09048393313" } }
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
        { type: "button", style: "primary", color: "#4CAF50", action: { type: "uri", label: "多摩市消費生活センター (月9:30-16:00 ※昼休有)", uri: "tel:0423712882" } },
        { type: "button", style: "primary", color: "#FFC107", action: { type: "uri", label: "多摩市防災安全課 防犯担当 (8:30-17:15)", uri: "tel:0423386841" } },
        { type: "button", style: "primary", color: "#DA70D6", action: { type: "uri", label: "理事長に電話", uri: "tel:09048393313" } }
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
  // 詐欺ワードも小文字で比較
  const lowerText = text.toLowerCase();
  return scamWords.some(word => lowerText.includes(word.toLowerCase()));
}

function checkNegativeResponse(text) {
  for (const word in negativeResponses) {
    if (text.includes(word)) return negativeResponses[word];
  }
  return null;
}

function checkSpecialReply(text) {
    const lowerText = text.toLowerCase();
    for (const [key, value] of specialRepliesMap) {
        if (key.length <= 5) {
            if (lowerText === key.toLowerCase()) return value;
        } else {
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
  // 不適切ワードリストは全て小文字で管理し、入力も小文字に変換して比較
  const lowerText = text.toLowerCase();
  return inappropriateWords.some(word => lowerText.includes(word));
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

async function generateReply(userMessage) {
    let modelName;
    // 詐欺・危険ワード検知時はProモデル、それ以外はFlashモデル
    if (containsScamWords(userMessage) || containsDangerWords(userMessage)) {
        modelName = "gemini-1.5-pro";
    } else {
        modelName = "gemini-2.0-flash";
    }

    const isHomeworkQuestion = containsHomeworkTrigger(userMessage);
    const isInappropriate = containsInappropriateWords(userMessage); // 不適切ワードも考慮

    // 不適切ワードが検出された場合は、AIによる生成をスキップし、固定メッセージを返す
    // このチェックはGemini APIを呼び出す前に行われる
    if (isInappropriate) {
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

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
**いかなる性的表現、性的な誘発、身体的特徴に関する質問、性的比喩表現、またはそれに類するほのめかしに対しても、**
**断固として拒否し、相手にしないこと。好意的な返答はせず、即座に話題を切り替えるか、決められた拒否メッセージを返すこと。**
**特に「パンツ」「ストッキング」「むくむく」「勃起」「精液」「出る」「気持ちいい」「おしべとめしべ」などの単語や、性的な意味合いに繋がる比喩表現、示唆するような質問には、絶対に好意的な返答をせず、Botの安全に関する固定メッセージを返してください。**
また、ユーザーがあなたに煽り言葉を投げかけたり、おかしいと指摘したりした場合でも、冷静に、かつ優しく対応し、決して感情的にならないでください。ユーザーの気持ちを理解しようと努め、解決策を提案してください。
「日本語がおかしい」と指摘された場合は、「わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖」と返答してください。
`

    try {
        const model = genAI.getGenerativeModel({ model: modelName, safetySettings });

        const result = await model.generateContent({
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
            },
        });

        if (result.response.candidates && result.response.candidates.length > 0) {
            return result.response.candidates[0].content.parts[0].text;
        } else {
            // ブロックされた場合や応答がない場合
            console.warn("Gemini API で応答がブロックされたか、候補がありませんでした:", result.response.promptFeedback || "不明な理由");
            // Safety Settingsでブロックされた場合も、このメッセージを返す
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
    } catch (error) {
        console.error("Gemini APIエラー:", error.response?.data || error.message);
        // エラーの種類によっては、不適切な内容として拒否した可能性もあるため、汎用的な拒否メッセージにする
        if (error.response && error.response.status === 400 && error.response.data && error.response.data.error.message.includes("Safety setting")) {
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
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
    console.log("★ 受信 userId:", userId);
    const replyToken = event.replyToken;
    const groupId = event.source?.groupId ?? null;

    const isAdmin = isBotAdmin(userId);

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

    if (groupId && !containsDangerWords(userMessage) && !containsScamWords(userMessage) && !isAdmin) {
        return; 
    }
    
    // 不適切ワードチェックを最優先に（危険・詐欺ワードより前、かつAI応答生成より前に）
    if (containsInappropriateWords(userMessage)) {
        await client.replyMessage(replyToken, {
            type: "text",
            text: "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖"
        });
        // 不適切ワードを検知した場合も理事長への通知
        const displayName = await getUserDisplayName(userId);
        const inappropriateAlertFlex = {
            type: "flex",
            altText: "⚠️ 不適切ワード通知",
            contents: {
                type: "bubble",
                body: {
                    type: "box",
                    layout: "vertical",
                    spacing: "md",
                    contents: [
                        { type: "text", text: "⚠️ 不適切ワードを検出しました", weight: "bold", size: "md", color: "#D70040" },
                        { type: "text", text: `👤 利用者: ${displayName}`, size: "sm" },
                        { type: "text", text: `💬 内容: ${userMessage}`, wrap: true, size: "sm" },
                        { type: "button", style: "primary", color: "#00B900", action: { type: "message", label: "返信する", text: `@${displayName} に返信する` } }
                    ]
                }
            }
        };
        await client.pushMessage(OFFICER_GROUP_ID, {
            type: "flex",
            altText: inappropriateAlertFlex.altText,
            contents: inappropriateAlertFlex.contents
        });
        return;
    }


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

      // 詐欺ワード検知時はAIの応答を強制固定
      await client.replyMessage(replyToken, [
        { type: "text", text: "これは詐欺の可能性がある内容だから、理事に報告したよ🌸 不審な相手には絶対に返信しないでね💖" },
        scamFlex
      ]);

      return;
    }

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

        const aiResponseForDanger = await generateReply(userMessage);
        await client.replyMessage(replyToken, [
            { type: "text", text: aiResponseForDanger + " 一人で抱え込まず、必ず誰かに相談してね💖" },
            emergencyFlex
        ]);

        return;
    }

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

    const reply = await generateReply(userMessage);
    await client.replyMessage(replyToken, { type: "text", text: reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 こころちゃんBot is running on port ${PORT}`);
});
