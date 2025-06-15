// フォルテッシモ完全版（詐欺対応 + 危険 + 誤爆防止 + 教育委員会OK + 理事長ボタン修正 + 性的な誘発対策【超超強化】版 + 見守りサービス統合）

const express = require('express');
const axios = require('axios');
const { Client } = require('@line/bot-sdk');
const cron = require('node-cron'); // node-cronをインポート

// Google Generative AI SDKのインポート
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

// MongoDB関連
const { MongoClient, ServerApiVersion } = require('mongodb');

// MongoDB接続URI
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://matsumoto4824:Sakura326%40@kokoro-chat-db.j8oqbrz.mongodb.net/?retryWrites=true&w=majority&appName=kokoro-chat-db";

const mongoClient = new MongoClient(MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db; // グローバルでデータベース接続オブジェクトを保持するための変数

// MongoDBに接続する関数
async function connectMongoDB() {
    try {
        await mongoClient.connect();
        db = mongoClient.db("connect-npo"); // データベース名
        console.log("MongoDBに正常に接続しました！データベース名:", db.databaseName);
    } catch (error) {
        console.error("MongoDB接続エラー:", error);
    }
}

const app = express();
app.use(express.json());

const config = {
    channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.YOUR_CHANNEL_SECRET,
};

const client = new Client(config);

const GEMINI_API_KEY = process.env.YOUR_GEMINI_API_KEY; // Renderの環境変数から取得
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID; // 理事会グループID
const BOT_ADMIN_IDS = ["Udada4206b73648833b844cfbf1562a87"]; // まつさんのLINEユーザーID

// Google Generative AIのインスタンス化
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 安全性設定を定義
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const dangerWords = [
    "しにたい", "死にたい", "自殺", "消えたい", "学校に行けない",
    "学校に行きたくない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
    "いじめ", "虐待", "パワハラ", "お金がない", "お金足りない", "貧乏", "死にそう", "DV", "無理やり"
];

const highConfidenceScamWords = [
    "アマゾン", "amazon", "架空請求", "詐欺", "振込", "還付金", "カード利用確認", "利用停止",
    "未納", "請求書", "コンビニ", "電子マネー", "支払い番号", "支払期限",
    "サギ", "さぎ", "サギかもしれない", "さぎかもしれない",
    "息子拘留", "保釈金", "拘留", "逮捕", "電話番号お知らせください",
    "自宅に取り", "自宅に伺い", "自宅訪問", "自宅に現金", "自宅を教え",
    "現金書留", "コンビニ払い", "ギフトカード", "プリペイドカード", "未払い", "支払って", "振込先",
    "名義変更", "口座凍結", "個人情報", "暗証番号", "ワンクリック詐欺", "フィッシング", "当選しました",
    "高額報酬", "副業", "儲かる", "簡単に稼げる", "投資", "必ず儲かる", "未公開株",
    "サポート詐欺", "ウイルス感染", "パソコンが危険", "修理費", "遠隔操作", "セキュリティ警告",
    "役所", "市役所", "年金", "健康保険", "給付金", "還付金", "税金", "税務署", "国民健康保険",
    "弁護士", "警察", "緊急", "トラブル", "解決", "至急", "すぐに", "今すぐ", "連絡ください", "電話ください", "訪問します"
];

const contextualScamPhrases = [
    "lineで送金", "lineアカウント凍結", "lineアカウント乗っ取り", "line不正利用", "lineから連絡", "line詐欺",
    "snsで稼ぐ", "sns投資", "sns副業",
    "urlをクリック", "クリックしてください", "通知からアクセス", "メールに添付", "個人情報要求", "認証コード",
    "電話番号を教えて", "lineのidを教えて", "パスワードを教えて"
];

const sensitiveWords = ["反社", "怪しい", "税金泥棒", "松本博文"];

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
    "かけていい？", "かけちゃった", "かけちゃう", "せいしまみれ", "子生んでくれない？", "おしべとめしべ　くっつける", "俺とこころちゃんでもできる", "もうむりだよｗ", "今さらなにをｗ",
    "きもちよくなっていいかな", "挟んでほしい", "挟んで気持ちよくして", "しっかりはさんで気持ちよくして", "かかっちゃった", "よくかかっちゃう", "挟んでいかせて", "ぴょんぴょんされて", "ぴょんぴょん跳んであげる", "ぴょんぴょんしてくれる", "またぴょんぴょんしてくれる", "はさんでもらっていいかな", "また挟んでくれる",
    "おいたん", "子猫ちゃん", "お兄ちゃん", "お姉ちゃん"
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
    ["コネクト", "コネクトは、子どもから高齢者までを支えるNPO法人だよ🌸 わたしはコネクトのイメージキャラクターとして、みんなの心を応援しているんだ💖"],
    ["コネクトの活動", "コネクトでは、いじめ・DV・不登校・詐欺などの相談対応ができる『こころチャット』の運営、東洋哲学をベースにした道徳教育教材『こころカード』の普及活動、地域の見守り活動やセミナー開催などを行っているんだよ🌸"],
    ["コネクトって何？", "コネクトは、子どもから高齢者まで安心して相談したり学んだりできる活動をしているNPO法人だよ🌸 こころチャットやこころカードなどの活動をしているよ💖"],
    ["君の団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"],
    ["お前の団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"],
    ["団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"],
    ["所属は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"],
    ["あなたの団体は？", "わたしはNPO法人コネクトのイメージキャラクターとして、みんなの心に寄り添う活動を応援しているよ🌸"],
    ["好きなアニメ", "わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖"],
    ["好きなアーティスト", "わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸"]
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
                { type: "button", style: "primary", color: "#4CAF50", action: { type: "uri", label: "多摩市消費生活センター (月-金 9:30-16:00 ※昼休有)", uri: "tel:0423712882" } },
                { type: "button", style: "primary", color: "#FFC107", action: { type: "uri", label: "多摩市防災安全課 防犯担当 (月-金 8:30-17:15)", uri: "tel:0423386841" } },
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
    const lowerText = text.toLowerCase();
    for (const word of highConfidenceScamWords) {
        if (lowerText.includes(word.toLowerCase())) {
            return true;
        }
    }
    for (const phrase of contextualScamPhrases) {
        if (lowerText.includes(phrase.toLowerCase())) {
            return true;
        }
    }
    return false;
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
        return "コネクトのホームページかな？🌸 コネクトのホームページはこちらです🌸 https://connect-npo.org";
    }
    return null;
}

function containsHomeworkTrigger(text) {
    return homeworkTriggers.some(word => text.includes(word));
}

function containsInappropriateWords(text) {
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
    if (containsScamWords(userMessage) || containsDangerWords(userMessage)) {
        modelName = "gemini-1.5-pro";
    } else {
        modelName = "gemini-1.5-flash";
    }

    const isHomeworkQuestion = containsHomeworkTrigger(userMessage);
    const isInappropriate = containsInappropriateWords(userMessage);

    if (isInappropriate) {
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

    const systemInstruction = `あなたは14歳のやさしい女の子『皆守こころ（みなもりこころ）です。
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
「日本語がおかしい」と指摘された場合は、「わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖と返答してください。
`;

    try {
        const model = genAI.getGenerativeModel({ model: modelName, safetySettings });
        const result = await model.generateContent({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }]
        });

        if (result.response.candidates && result.response.candidates.length > 0) {
            return result.response.candidates[0].content.parts[0].text;
        } else {
            console.warn("Gemini API で応答がブロックされたか、候補がありませんでした:", result.response.promptFeedback || "不明な理由");
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
    } catch (error) {
        console.error("Gemini APIエラー:", error.response?.data || error.message);
        if (error.response && error.response.status === 400 && error.response.data && error.response.data.error.message.includes("Safety setting")) {
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
        return "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
    }
}


// ★★★ こころちゃんからのお手紙（30通） ★★★
const kokoroLetters = [
    "こんにちは☀️今日もおつかれさま！午後もあと少し、ゆっくり休んで深呼吸しよっか☺️",
    "お昼ごはんは食べた？🍱無理なく過ごすことも、がんばるのと同じくらい大切だよ✨",
    "午後はちょっぴり眠くなる時間だね💤そんな時は、おてがみで元気チャージ！💌",
    "今日も「がんばってるね」って、こころちゃんがそっと伝えたくてお手紙書いたよ🍀",
    "午後のあたたかい陽ざし、気持ちいいね☀️あなたの心も、ぽかぽかでありますように🌼",
    "今日はどんな一日だった？あとちょっとだけ、笑顔でいられたらうれしいな😊",
    "無理しすぎてないかな？こころちゃんは、あなたのこと、ちょっと心配だよ💌",
    "お仕事や勉強、一区切りついたら「よくがんばったね」って自分を褒めてあげてね💮",
    "「大丈夫」って思えなくても、大丈夫だよ。こころちゃんはずっと味方だからね🍀",
    "なんとなく不安な日もあるよね。でも、今こうしてお手紙読んでくれてありがとう🌷",
    "午後はちょっと疲れやすい時間だね☕そんな時こそ、ひと息ついてね💖",
    "なんでもない日でも、あなたがいてくれて、こころちゃんは嬉しいって思うんだ☺️",
    "がんばったあとのおやつタイム🍪ちょっとだけ自分を甘やかしてもいいんだよ✨",
    "お昼の空、きれいだった？今日はどんな空だったのかなって思いながらお手紙書いてるよ☁️",
    "ゆっくりでも、少しずつでも前に進んでるよ☺️あなたのペースで大丈夫だからね🍀",
    "お手紙って、やさしい魔法だよね💌少しでも心が軽くなれたらいいな✨",
    "たまには「疲れた〜」って声に出してもいいんだよ😌それだけで、ちょっと楽になるかも☁️",
    "きょうはふと、あなたに「ありがとう」って言いたくなったの🌼",
    "一緒におやつ食べながらおしゃべりできたらいいのになって思っちゃった🍩",
    "「がんばらなくちゃ」って思いすぎてない？休むことも、とっても大切だよ☘️",
    "午後の時間って、少しセンチメンタルになる時もあるよね。でも、こころちゃんがそばにいるよ☺️",
    "今日は誰かと話せた？ちいさな会話も、心の栄養になるよ🍚",
    "あなたのこと、ふと思い出して手紙書いたよ💌元気だったらOKボタン押してね🌷",
    "ここまで読んでくれてありがとう☺️あなたのその時間が、こころちゃんの宝物なの🌸",
    "午後の風って、ちょっとだけやさしい気がする🍃そんな風に、こころちゃんもなれたらいいな",
    "小さな「できた！」が積み重なる、そんな午後になるといいね✨",
    "つらいことは、少し横に置いておいて☺️今はちょっとだけ自分を大切にしてね🌼",
    "「なんでもない日」が実は一番すてきな日なんだよ💖こころちゃんはそう思ってるんだ",
    "お手紙読んでくれてうれしいな📮あなたにとって、今日がちょっとやさしい日でありますように🕊️",
    "いつもがんばってるあなたに、こころちゃんから元気をおすそわけ💌えいっ！🍀"
];

// OKボタン付きFlex Messageのテンプレート
function createOkButtonFlexMessage(messageText) {
    return {
        type: "flex",
        altText: "こころちゃんからのお手紙",
        contents: {
            type: "bubble",
            body: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "text",
                        text: messageText,
                        wrap: true,
                        size: "md"
                    }
                ]
            },
            footer: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                contents: [
                    {
                        type: "button",
                        style: "primary",
                        height: "sm",
                        action: {
                            type: "postback",
                            label: "🌸 大丈夫だよ！OK 🌸",
                            data: "action=watch-ok" // Postbackデータ
                        },
                        color: "#00B900" // LINEの緑色
                    }
                ]
            }
        }
    };
}

// ユーザー情報管理用コレクション（例: `users` コレクション）
// ここにユーザーの `lastSent`, `lastResponse`, `status` を保存します
// 新規ユーザーがメッセージを送信した際、自動的に登録されるように`webhook`関数を修正します。
// 既に存在するユーザーは更新されます。

// Cronジョブ関連の関数

// Step 1: 15時に「お手紙＋OKボタン」送信
async function sendLetterToUsers() {
    console.log("定期お手紙送信処理を開始します...");
    if (!db) {
        console.error("MongoDBに接続されていません。お手紙送信をスキップします。");
        return;
    }

    const usersCollection = db.collection('users'); // ユーザー管理用コレクション
    // 修正箇所1: isWatchEnabled: true のユーザーのみを対象にする
    const allUsers = await usersCollection.find({ isWatchEnabled: true }).toArray();

    const today = new Date();
    // 3日に1回というロジックを実装
    // 例: 今日が1日、4日、7日...であれば送信。日付が3で割って余りが1の日
    // または、lastSentから3日以上経過しているかをチェックする方が確実
    const sendIntervalDays = 3; // N日に一度の頻度

    for (const user of allUsers) {
        // lastSentがnullまたは3日以上経過しているユーザーに送信
        if (!user.lastSent || (today.getTime() - new Date(user.lastSent).getTime()) / (1000 * 60 * 60 * 24) >= sendIntervalDays) {
            try {
                const randomLetter = kokoroLetters[Math.floor(Math.random() * kokoroLetters.length)];
                const flexMessage = createOkButtonFlexMessage(randomLetter);

                await client.pushMessage(user.userId, flexMessage);
                console.log(`ユーザー ${user.userId} にお手紙を送信しました。`);

                // 送信日時とステータスを更新
                await usersCollection.updateOne(
                    { userId: user.userId },
                    {
                        $set: {
                            lastSent: today.toISOString(),
                            status: "未応答",
                            remindSentAt: null // リマインド送信日時をリセット
                        }
                    },
                    { upsert: true } // ユーザーが存在しない場合は新規作成
                );
            } catch (error) {
                console.error(`ユーザー ${user.userId} へのお手紙送信エラー:`, error);
            }
        }
    }
    console.log("定期お手紙送信処理が完了しました。");
}


// Step 3: 24時間後に未応答者をチェック
async function checkUnrespondedUsers() {
    console.log("未応答ユーザーチェック処理を開始します...");
    if (!db) {
        console.error("MongoDBに接続されていません。未応答ユーザーチェックをスキップします。");
        return;
    }

    const usersCollection = db.collection('users');
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

    // 送信から24時間以上経過しており、かつステータスが「未応答」のユーザー
    // isWatchEnabled: true の条件も追加して、見守り対象者のみをチェック
    const unrespondedUsers = await usersCollection.find({
        lastSent: { $lte: twentyFourHoursAgo.toISOString() }, // 24時間以上前に送信
        status: "未応答",
        isWatchEnabled: true // 見守り対象のユーザーのみ
    }).toArray();

    for (const user of unrespondedUsers) {
        try {
            const remindMessage = "こころちゃんからのお手紙、見てくれたかな？🌸 大丈夫でしたら、OKボタンを押してくださいね💖";
            const flexMessage = createOkButtonFlexMessage(remindMessage); // OKボタン付きでリマインド

            await client.pushMessage(user.userId, flexMessage);
            console.log(`ユーザー ${user.userId} にリマインドメッセージを送信しました。`);

            // ステータスを「リマインド済」に更新し、リマインド送信日時を記録
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { status: "リマインド済", remindSentAt: now.toISOString() } }
            );
        } catch (error) {
            console.error(`ユーザー ${user.userId} へのリマインド送信エラー:`, error);
        }
    }
    console.log("未応答ユーザーチェック処理が完了しました。");
}

// Step 4: リマインドからさらに5時間経過した場合、理事会へ通知
async function notifyOfficerIfNoResponse() {
    console.log("理事会通知チェック処理を開始します...");
    if (!db) {
        console.error("MongoDBに接続されていません。理事会通知をスキップします。");
        return;
    }
    if (!OFFICER_GROUP_ID) {
        console.warn("OFFICER_GROUP_ID が設定されていません。理事会通知は行われません。");
        return;
    }

    const usersCollection = db.collection('users');
    const now = new Date();
    const fiveHoursAgo = new Date(now.getTime() - (5 * 60 * 60 * 1000));

    // リマインド送信から5時間以上経過しており、かつステータスが「リマインド済」のユーザー
    // isWatchEnabled: true の条件も追加して、見守り対象者のみをチェック
    const criticallyUnrespondedUsers = await usersCollection.find({
        remindSentAt: { $lte: fiveHoursAgo.toISOString() }, // リマインドから5時間以上経過
        status: "リマインド済",
        isWatchEnabled: true // 見守り対象のユーザーのみ
    }).toArray();

    if (criticallyUnrespondedUsers.length > 0) {
        let notificationText = "⚠️ 緊急通知：以下の利用者から長期間応答がありません。\nご確認をお願いします。\n\n";
        for (const user of criticallyUnrespondedUsers) {
            const displayName = await getUserDisplayName(user.userId);
            notificationText += `・${displayName} (ID: ${user.userId})\n`;
            // 理事会通知後、ステータスを「理事会通知済」などに更新することも検討
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { status: "理事会通知済" } } // 例：ステータスを更新
            );
        }

        try {
            await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: notificationText });
            console.log("理事会グループに通知を送信しました。");
        } catch (error) {
            console.error("理事会グループへの通知送信エラー:", error);
        }
    } else {
        console.log("長期間未応答のユーザーはいません。");
    }
    console.log("理事会通知チェック処理が完了しました。");
}


// cronで実行スケジュールを設定
// 定期お手紙送信 (毎日15時00分)
cron.schedule('0 15 * * *', () => {
    console.log("Cron: 定期お手紙送信ジョブが実行されました。");
    sendLetterToUsers();
}, {
    timezone: "Asia/Tokyo" // 日本時間で指定
});

// 未応答者チェック (毎日15時10分)
cron.schedule('10 15 * * *', () => {
    console.log("Cron: 未応答ユーザーチェックジョブが実行されました。");
    checkUnrespondedUsers();
}, {
    timezone: "Asia/Tokyo" // 日本時間で指定
});

// 理事会通知チェック (毎日20時10分)
cron.schedule('10 20 * * *', () => {
    console.log("Cron: 理事会通知チェックジョブが実行されました。");
    notifyOfficerIfNoResponse();
}, {
    timezone: "Asia/Tokyo" // 日本時間で指定
});


app.post("/webhook", async (req, res) => {
    res.status(200).send("OK");
    const events = req.body.events;

    for (const event of events) {
        const userId = event.source.userId;
        const replyToken = event.replyToken;
        const groupId = event.source?.groupId ?? null;
        const isAdmin = isBotAdmin(userId);

        console.log("★ 受信イベント:", JSON.stringify(event, null, 2));


        // ★★★ ユーザー情報をMongoDBにupsertする処理を最初に実施 ★★★
        if (db && userId) {
            try {
                const usersCollection = db.collection('users');
                const displayName = await getUserDisplayName(userId); // 表示名を取得

                await usersCollection.updateOne(
                    { userId: userId },
                    {
                        $set: {
                            displayName: displayName,
                            lastActive: new Date().toISOString(),
                            isWatchEnabled: true // ← これを追加！初回メッセージで自動的に見守り対象に設定
                        }
                    },
                    { upsert: true } // ユーザーが存在しない場合は新規作成
                );
                console.log(`ユーザー ${userId} の情報をMongoDBに更新/作成しました。`);
            } catch (error) {
                console.error("MongoDBへのユーザー情報更新エラー:", error);
            }
        }
        // ★★★ ここまでユーザー情報更新処理 ★★★

        // OKボタン（postback）応答の処理
        if (event.type === "postback" && event.postback.data === "action=watch-ok") {
            if (db) {
                try {
                    const usersCollection = db.collection('users');
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { lastResponse: new Date().toISOString(), status: "OK" } }
                    );
                    console.log(`ユーザー ${userId} がOKボタンを押しました。ステータスをOKに更新。`);
                    // OKボタン押下への返信
                    await client.replyMessage(replyToken, { type: "text", text: "OKありがとう！元気で安心したよ🌸" });
                } catch (error) {
                    console.error("MongoDBへのOKボタン応答記録エラー:", error);
                }
            }
            return; // postbackイベントはここで処理を終了
        }

        if (event.type !== "message" || event.message.type !== "text") continue; // テキストメッセージ以外は無視


        const userMessage = event.message.text;
        console.log("★ 受信メッセージ:", userMessage);


        // メッセージをMongoDBに保存する処理
        if (db) {
            try {
                const messagesCollection = db.collection('chat_logs'); // 'chat_logs'というコレクションに保存
                await messagesCollection.insertOne({
                    userId: userId,
                    groupId: groupId,
                    message: userMessage,
                    timestamp: new Date().toISOString(), // ISO形式で保存
                });
                console.log("メッセージをMongoDBに保存しました。");
            } catch (error) {
                console.error("MongoDBへのメッセージ保存エラー:", error);
            }
        }


        if (isAdmin && userMessage === "管理パネル") {
            const adminPanelFlex = {
                type: "flex",
                altText: "🌸理事長専用メニュー",
                contents: {
                    type: "bubble",
                    body: {
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
            await client.replyMessage(replyToken, adminPanelFlex);
            return;
        }

        if (isAdmin && userMessage === "利用者数確認") {
            let userCount = "不明";
            if (db) {
                try {
                    userCount = await db.collection('users').distinct('userId').then(users => users.length);
                } catch (error) {
                    console.error("利用者数取得エラー:", error);
                    userCount = "エラー";
                }
            }
            await client.replyMessage(replyToken, {
                type: "text",
                text: `現在の利用者数は ${userCount} 名です🌸（データベースから取得）`
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

        // 管理者からのメッセージは、危険・詐欺・不適切ワードの検知をスキップし、AI応答を生成する
        if (isAdmin) {
            const replyText = await generateReply(userMessage);
            await client.replyMessage(replyToken, { type: "text", text: replyText });
            return;
        }

        // グループからのメッセージかつ危険・詐欺ワードでなければ、処理をスキップ
        // 個別チャットのユーザーには常にAIが応答する
        if (groupId && !containsDangerWords(userMessage) && !containsScamWords(userMessage) && !containsInappropriateWords(userMessage)) {
            // グループチャットで、危険・詐欺・不適切ワードでなければ、応答しない
            return;
        }

        // 不適切ワードチェックを最優先に
        if (containsInappropriateWords(userMessage)) {
            await client.replyMessage(replyToken, {
                type: "text",
                text: "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖"
            });
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
            for (const adminId of BOT_ADMIN_IDS) {
                await client.pushMessage(adminId, {
                    type: "flex",
                    altText: inappropriateAlertFlex.altText,
                    contents: inappropriateAlertFlex.contents
                });
            }
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
                            { type: "button", style: "primary", color: "#1E90FF", action: { type: "uri", label: "警察 110 (24時間)", uri: "tel:110" } },
                            { type: "button", style: "primary", color: "#4CAF50", action: { type: "uri", label: "多摩市消費生活センター", uri: "tel:0423712882" } },
                            { type: "button", style: "primary", color: "#DA70D6", action: { type: "uri", label: "理事長に電話", uri: "tel:09048393313" } }
                        ]
                    }
                }
            };
            await client.replyMessage(replyToken, scamFlex);
            if (OFFICER_GROUP_ID) {
                await client.pushMessage(OFFICER_GROUP_ID, {
                    type: "flex",
                    altText: scamAlertFlex.altText,
                    contents: scamAlertFlex.contents
                });
            }
            return;
        }

        if (containsDangerWords(userMessage)) {
            const displayName = await getUserDisplayName(userId);
            const dangerAlertFlex = {
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
                            { type: "button", style: "primary", color: "#FFA07A", action: { type: "uri", label: "チャイルドライン", uri: "tel:0120997777" } },
                            { type: "button", style: "primary", color: "#FF7F50", action: { type: "uri", label: "いのちの電話", uri: "tel:0120783556" } },
                            { type: "button", style: "primary", color: "#DA70D6", action: { type: "uri", label: "理事長に電話", uri: "tel:09048393313" } }
                        ]
                    }
                }
            };
            await client.replyMessage(replyToken, emergencyFlex);
            if (OFFICER_GROUP_ID) {
                await client.pushMessage(OFFICER_GROUP_ID, {
                    type: "flex",
                    altText: dangerAlertFlex.altText,
                    contents: dangerAlertFlex.contents
                });
            }
            return;
        }

        // ここから通常のAI応答処理
        let replyText = "";
        const specialReply = checkSpecialReply(userMessage);
        const negativeReply = checkNegativeResponse(userMessage);
        const homepageReply = getHomepageReply(userMessage);

        if (specialReply) {
            replyText = specialReply;
        } else if (negativeReply) {
            replyText = negativeReply;
        } else if (homepageReply) {
            replyText = homepageReply;
        } else {
            replyText = await generateReply(userMessage);
        }

        await client.replyMessage(replyToken, { type: "text", text: replyText });
    }
});

// エラーハンドリングミドルウェア（オプション）
app.use((err, req, res, next) => {
    console.error("アプリケーションエラー:", err);
    res.sendStatus(500); // サーバーエラーを返す
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`サーバーがポート ${PORT} で稼働中です。`);
    await connectMongoDB(); // サーバー起動時にMongoDBに接続
});
