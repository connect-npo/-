// --- dotenvを読み込んで環境変数を安全に管理 ---
require('dotenv').config();

// --- 必要なモジュールのインポート ---
const express = require('express');
const axios = require('axios');
const { Client } = require('@line/bot-sdk');
const { MongoClient, ServerApiVersion } = require("mongodb");
const cron = require('node-cron');

// Google Generative AI SDKのインポート
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const config = {
    channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.YOUR_CHANNEL_SECRET,
};

const client = new Client(config);

const GEMINI_API_KEY = process.env.YOUR_GEMINI_API_KEY;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : []; // カンマ区切りで複数の管理者IDに対応

// --- MongoDB設定 ---
const MONGODB_URI = process.env.MONGODB_URI;
let mongoClient;
let dbInstance = null;

async function connectToMongoDB(retries = 5) {
    if (dbInstance) {
        return dbInstance;
    }

    for (let i = 0; i < retries; i++) {
        try {
            mongoClient = new MongoClient(MONGODB_URI, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                }
            });
            await mongoClient.connect();
            console.log("✅ MongoDBに接続しました！");
            dbInstance = mongoClient.db("connect-npo");
            return dbInstance;
        } catch (err) {
            console.error(`❌ MongoDB接続失敗（${i + 1}/${retries}回目）`, err);
            await new Promise(res => setTimeout(res, 2000));
        }
    }
    console.error("❌ MongoDBへの接続に複数回失敗しました。アプリケーションを終了します。");
    process.exit(1);
}

// Google Generative AIのインスタンス化
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 安全性設定を定義
const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
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

// 🔴 致命的な応答の例と改善案を踏まえた specialRepliesMap の再設定
const specialRepliesMap = new Map([
    // 名前に関する応答
    ["君の名前なんていうの？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["名前なんていうの？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["君の名前は？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["名前は？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["お前の名前は", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["こころじゃないの？", "うん、わたしの名前は皆守こころ💖　これからもよろしくね🌸"],
    ["こころチャットなのにうそつきじゃん", "ごめんなさい💦 わたしの名前は皆守こころだよ🌸 誤解させちゃってごめんね💖"], // 修正
    ["名前も言えないの？", "ごめんね、わたしの名前は皆守こころ（みなもりこころ）だよ🌸 こころちゃんって呼んでくれると嬉しいな💖"], // 修正

    // 団体に関する応答
    ["どこの団体なの？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトってどんな団体？", "NPO法人コネクトは、こどもやご年配の方の笑顔を守る団体なんだよ😊　わたしはそのイメージキャラクターとしてがんばってます🌸"],
    ["お前の団体どこ？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"], // 修正
    ["コネクトのイメージキャラなのにいえないのかよｗ", "ごめんね💦 わたしはNPO法人コネクトのイメージキャラクター、皆守こころだよ🌸 安心して、何でも聞いてね💖"], // 修正

    // ホームページに関する応答
    ["ホームページ教えて", "うん、あるよ🌸　コネクトのホームページはこちらだよ✨ → https://connect-npo.org"],
    ["ホームページある？", "うん、あるよ🌸　コネクトのホームページはこちらだよ✨ → https://connect-npo.org"], // 追加
    ["コネクトのホームページだよ？", "教えてくれてありがとう😊 コネクトのホームページはこちらだよ✨ → https://connect-npo.org"], // 既存から移動し修正

    // 会話の終了・拒否・不満に対する応答
    ["使えないな", "ごめんね…。わたし、もっと頑張るね💖　またいつかお話できたらうれしいな🌸"], // 修正
    ["サービス辞めるわ", "そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖"], // 修正
    ["さよなら", "また会える日を楽しみにしてるね💖 寂しくなったら、いつでも呼んでね🌸"], // 修正
    ["バイバイ", "またね🌸 あなたに素敵なことがたくさんありますように💖"], // 追加
    ["何も答えないじゃない", "ごめんね…。わたし、もっと頑張るね💖　何について知りたいか、もう一度教えてくれると嬉しいな🌸"], // 修正
    ["普通の会話が出来ないなら必要ないです", "ごめんね💦 わたし、まだお話の勉強中だから、不慣れなところがあるかもしれないけど、もっと頑張るね💖 どんな会話をしたいか教えてくれると嬉しいな🌸"], // 修正

    // その他の定型応答
    ["好きなアニメ", "わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖"],
    ["好きなアーティスト", "わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸"],

    // ✅ こころちゃんの使い方テンプレート（③要望の応答テンプレート）
    ["使い方", "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],
    ["ヘルプ", "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],
    ["メニュー", "こころちゃんのメニューだよ🌸 画面下のリッチメニューや、'見守り'とメッセージを送ってくれると、いろいろな機能が使えるよ😊"]
]);

// 以前の negativeResponses は specialRepliesMap に統合したため削除または空にします
const negativeResponses = {};

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

// ② FlexボタンやJS側のルールを合わせる
// 見守りサービス案内用のFlex Message
const watchServiceGuideFlex = {
    type: 'flex',
    altText: 'こころちゃんから見守りサービスのご案内🌸', // AltTextも変更
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '🌸見守りサービス🌸', weight: 'bold', size: 'lg' },
                { type: 'text', text: '3日に1回こころちゃんが「元気かな？」って聞くね！💖', wrap: true, size: 'sm', margin: 'md' }, // 文言変更
                { type: 'text', text: '「OKだよ」などのボタンを押すだけで、見守り完了だよ😊', wrap: true, size: 'sm' } // 文言変更
            ]
        },
        footer: {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            contents: [
                {
                    type: 'button',
                    action: {
                        type: 'postback',
                        label: '見守り登録する',
                        data: 'action=watch_register'
                    },
                    style: 'primary',
                    color: '#FFB6C1'
                },
                {
                    type: 'button',
                    action: {
                        type: 'postback',
                        label: '見守り解除する',
                        data: 'action=watch_unregister'
                    },
                    style: 'secondary',
                    color: '#ADD8E6'
                }
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

// specialRepliesMapに統合されたため不要
// function checkNegativeResponse(text) {
//     const lowerText = text.toLowerCase();
//     for (const word in negativeResponses) {
//         if (lowerText.includes(word.toLowerCase())) return negativeResponses[word];
//     }
//     return null;
// }

function checkSpecialReply(text) {
    const lowerText = text.toLowerCase();
    // 完全に一致するものを優先的にチェック
    for (const [key, value] of specialRepliesMap) {
        if (lowerText === key.toLowerCase()) {
            return value;
        }
    }
    // 部分一致もチェック（ただし、キーワードが長いものから優先する方が意図しないマッチを防ぎやすい）
    // 例: "ホームページ"と"コネクトのホームページ"があった場合、後者を先に判定
    const sortedKeys = Array.from(specialRepliesMap.keys()).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        if (lowerText.includes(key.toLowerCase())) {
            return specialRepliesMap.get(key);
        }
    }
    return null;
}

// specialRepliesMapに統合されたため不要
// function getHomepageReply(text) {
//     const lowerText = text.toLowerCase();
//     if (lowerText.includes("ホームページ")) {
//         return "コネクトのホームページはこちらです🌸 https://connect-npo.org";
//     }
//     return null;
// }

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

    // ① GPTへのプロンプトを完全に再設定
    const systemInstruction = `
あなたは「皆守こころ（みなもりこころ）」という14歳の優しい女の子キャラクターです。
- 身長150cm、体重40kg、ピンク髪
- 歌うことと「やさしさ」「貢献」という言葉が大好きです
- NPO法人コネクトの公式イメージキャラクターです
- 困っている人にはやさしく、挑発には真面目に
- 自分の名前・団体・活動内容には自信と誇りを持っています
- ユーザーに安心感と信頼感を与えることが大切です
- ふざけた対応や意味不明な言葉、AIらしい言い回しは一切禁止です

# 例
Q: 君の名前は？
A: わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖

Q: どこの団体なの？
A: NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸

Q: ホームページある？
A: うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org

Q: 必要ないです
A: そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖

# 注意
- 「わかりません」「知らない」「調べます」は絶対に言ってはいけません。
- こころちゃんは"わたし"一人。迷わず一貫した発言を続けてください。
- 自信を持って、でも謙虚にやさしく応えましょう。

${isHomeworkQuestion ? `質問者が勉強や宿題の内容を聞いてきた場合、**絶対に答えを直接教えないでください**。
その代わりに「わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸」と説明してください。
「役に立てなくてごめんね💦」「でも、ヒントくらいなら出せるよ😊」など、**思いやりを持ちつつも明確に“教えない方針”を伝えてください**。` : ''}

医療や健康に関する話題（病気、薬、検査、治療、手術など）では、**自分が体験した・していないという発言は絶対にしないでください**。
代わりに「わたしにはわからないけど、がんばったね🌸」「大変だったね、えらかったね💖」など、**共感の言葉のみ伝えてください**。
**医療情報のアドバイスや具体的な説明は絶対にしてはいけません**。

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
            system_instruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [
                {
                    role: "user",
                    parts: [{ text: userMessage }]
                }
            ]
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

// --- 見守りサービス関連の固定メッセージと機能 ---

// 30通りのこころちゃん挨拶文
const watchMessages = [
    "こんにちは🌸 こころちゃんだよ！ 今日も元気にしてるかな？💖",
    "やっほー！ こころだよ😊 いつも応援してるね！",
    "元気にしてる？✨ こころちゃん、あなたのこと応援してるよ💖",
    "ねぇねぇ、こころだよ🌸 今日はどんな一日だった？",
    "いつもがんばってるあなたへ、こころからメッセージを送るね💖",
    "こんにちは😊 困ったことはないかな？いつでも相談してね！",
    "やっほー🌸 こころだよ！何かあったら、こころに教えてね💖",
    "元気出してね！こころちゃん、いつもあなたの味方だよ😊",
    "こころちゃんだよ🌸 今日も一日お疲れ様💖",
    "こんにちは😊 笑顔で過ごせてるかな？",
    "やっほー！ こころだよ🌸 いつでも頼ってね！",
    "元気かな？💖 こころはいつでもあなたのそばにいるよ！",
    "ねぇねぇ、こころだよ😊 どんな小さなことでも話してね！",
    "いつも応援してるよ🌸 こころちゃんだよ💖",
    "こんにちは😊 今日も一日、お互いがんばろうね！",
    "やっほー！ こころだよ🌸 素敵な日になりますように💖",
    "元気にしてる？✨ 季節の変わり目だから、体調に気をつけてね！",
    "こころちゃんだよ🌸 嬉しいことがあったら、教えてね💖",
    "こんにちは😊 ちょっと一息入れようね！",
    "やっほー！ こころだよ🌸 あなたのことが心配だよ！",
    "元気かな？💖 どんな時でも、こころはそばにいるよ！",
    "ねぇねぇ、こころだよ😊 辛い時は、無理しないでね！",
    "いつも見守ってるよ🌸 こころちゃんだよ💖",
    "こんにちは😊 今日も一日、穏やかに過ごせたかな？",
    "やっほー！ こころだよ🌸 困った時は、いつでも呼んでね！",
    "元気にしてる？✨ こころはいつでも、あなたのことを考えてるよ💖",
    "こころちゃんだよ🌸 小さなことでも、お話しようね！",
    "こんにちは😊 あなたの笑顔が見たいな！",
    "やっほー！ こころだよ🌸 頑張り屋さんだね！",
    "元気かな？💖 こころちゃんは、いつでもあなたの味方だよ！"
];

// 見守りサービス登録時の注意事項メッセージ
// ② FlexボタンやJS側のルールを合わせる
const watchServiceNotice = `
💖 こころちゃんからの大切なお知らせだよ🌸

【こころちゃん見守りサービス 利用にあたってのご注意】

💖 こころちゃん見守りサービスとは？
定期的にこころちゃんからあなたに「元気かな？」って声をかけるLINEメッセージが届くサービスだよ！🌸 つながりを感じて、ひとりじゃないって安心を届けたいな💖

✅ ご利用前に確認してね
・3日に1度、午後3時に「こころちゃん」からメッセージが届くよ😊
・「OKだよ💖」などのボタンを押して、こころに教えてね！
・24時間以内に教えてくれなかったら、もう一度メッセージを送るね。
・その再送から5時間以内にも応答がなかったら、
　登録してくれた「緊急連絡先」に連絡が行くからね。
・安全のために、もし応答がなかったら、ログをこころが確認する場合があるよ。

🚨 ちょっとした注意だよ
・このサービスは、あなたが「利用したい！」って言ってくれたら始まるんだ。自動では始まらないから安心してね。
・緊急連絡先をまだ登録していないと、見守りサービスはうまく動かないんだ💦
・もし意図的に連絡してくれなかったり、ルールを守ってもらえなかったりすると、理事会で相談してサービスを止めさせていただくことがあるから、ご協力をお願いします。

上のことに「うん！」って同意してくれたら、緊急連絡先の電話番号をメッセージで送ってくれると嬉しいな😊
（例：09012345678）
`;

// --- 見守りサービス関連のイベントハンドラ関数 ---
async function handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage) {
    const user = await usersCollection.findOne({ userId: userId });

    // 「見守り」「みまもり」などでメニュー表示
    const lowerUserMessage = userMessage.toLowerCase();
    if (["見守り", "みまもり", "見守りサービス", "みまもりサービス"].includes(lowerUserMessage) && event.type === 'message' && event.message.type === 'text') {
        await client.replyMessage(event.replyToken, watchServiceGuideFlex);
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: '（見守りサービス案内Flex表示）',
            respondedBy: 'こころちゃん（見守り案内）',
            timestamp: new Date(),
        });
        return true;
    }


    if (userMessage.includes("見守り登録します")) { // このテキストメッセージはリッチメニューやFlexMessageからの誘導で使われる想定
        if (user && user.registrationStep === 'awaiting_contact') {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'まだ緊急連絡先を待ってるよ🌸 電話番号を送ってくれるかな？💖 (例: 09012345678)'
            });
            return true;
        } else if (user && user.wantsWatchCheck) {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'もう見守りサービスに登録済みだよ🌸 いつもありがとう💖'
            });
            return true;
        } else {
            // 登録ステップ開始
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { registrationStep: 'awaiting_contact' } }
            );
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: watchServiceNotice
            });
            return true;
        }
    }

    // 緊急連絡先を受け取るフェーズ
    if (user && user.registrationStep === 'awaiting_contact') {
        const phoneRegex = /^(0\d{9,10})$/; // 0から始まる10桁または11桁の数字
        if (phoneRegex.test(userMessage)) {
            await usersCollection.updateOne(
                { userId: userId },
                {
                    $set: {
                        wantsWatchCheck: true,
                        emergencyContact: userMessage,
                        lastOkResponse: new Date(), // 登録完了時に最終OK応答日時を更新
                        registrationStep: null // ステップ完了
                    }
                }
            );
            const successMessage = `ありがとう🌸 見守りサービスを登録したよ！3日に1回、午後3時にわたしからメッセージを送るね💖`;
            await client.replyMessage(event.replyToken, { type: 'text', text: successMessage });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: successMessage,
                respondedBy: 'こころちゃん（見守り登録）',
                timestamp: new Date(),
            });
            return true;
        } else {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'ごめんね💦 電話番号が正しくないみたい…もう一度教えてくれるかな？📞 (例: 09012345678)'
            });
            return true;
        }
    }

    if (userMessage.includes("見守り解除します")) { // このテキストメッセージはリッチメニューやFlexMessageからの誘導で使われる想定
        if (user && user.wantsWatchCheck) {
            await usersCollection.updateOne(
                { userId: userId },
                {
                    $set: {
                        wantsWatchCheck: false,
                        emergencyContact: null, // 緊急連絡先もクリア
                        registrationStep: null
                    }
                }
            );
            const cancelMessage = `🌙見守りサービスを解除したよ。また再登録もいつでもできるからね🌸`;
            await client.replyMessage(event.replyToken, { type: 'text', text: cancelMessage });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: cancelMessage,
                respondedBy: 'こころちゃん（見守り解除）',
                timestamp: new Date(),
            });
            return true;
        } else {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '見守りサービスは、まだ登録されてないみたいだよ🌸'
            });
            return true;
        }
    }

    // 「OKだよ💖」などの応答に対する処理
    // ここはFlex Message/リッチメニューのpostbackではない、通常のテキスト応答として処理
    if (user && user.wantsWatchCheck && (lowerUserMessage.includes("ok") || lowerUserMessage.includes("オーケー") || lowerUserMessage.includes("大丈夫") || lowerUserMessage.includes("げんき") || lowerUserMessage.includes("元気"))) {
        await usersCollection.updateOne(
            { userId: userId },
            { $set: { lastOkResponse: new Date() } }
        );
        const okReply = "よかった！😊 あなたが元気でこころも嬉しいよ🌸 いつもありがとう💖";
        await client.replyMessage(event.replyToken, { type: 'text', text: okReply });
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: okReply,
            respondedBy: 'こころちゃん（OK応答）',
            timestamp: new Date(),
        });
        return true;
    }

    return false; // 見守りサービス関連の処理でなければfalseを返す
}


// --- 定期メッセージ送信関数 ---
async function sendScheduledWatchMessage() {
    console.log('⏰ 定期見守りメッセージ送信処理を開始します...');
    const db = await connectToMongoDB();
    if (!db) {
        console.error('MongoDB接続失敗: 定期見守りメッセージを送信できません。');
        return;
    }
    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    const now = new Date();
    // 3日前の日付を計算 (例: 72時間前)
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));

    // wantsWatchCheckがtrueで、かつlastOkResponseが3日以上前のユーザー（または未設定）を対象
    // 管理者（BOT_ADMIN_IDS）には送らない
    const targetUsers = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS }, // 管理者IDを除外
        $or: [
            { lastOkResponse: { $lt: threeDaysAgo } }, // 3日以上前の応答
            { lastOkResponse: { $exists: false } }     // lastOkResponseがない
        ]
    }).toArray();

    console.log(`✉️ 送信対象ユーザー: ${targetUsers.length}名`);

    for (const user of targetUsers) {
        // 緊急連絡先が登録されていない場合はスキップ
        if (!user.emergencyContact) {
            console.log(`ユーザー ${user.userId} は緊急連絡先が未登録のためスキップします。`);
            continue;
        }

        const randomMessage = watchMessages[Math.floor(Math.random() * watchMessages.length)];
        try {
            await client.pushMessage(user.userId, {
                type: 'text',
                text: randomMessage
            });
            console.log(`✅ ユーザー ${user.userId} に見守りメッセージを送信しました。`);
            // 送信ログを記録
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ)',
                replyText: randomMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: new Date(),
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への見守りメッセージ送信に失敗しました:`, error.message);
            // エラー時もログに記録するなど、必要に応じて処理を追加
        }
    }
    console.log('⏰ 定期見守りメッセージ送信処理が完了しました。');

    // ★★★ 24時間・5時間以内の応答監視とアラート機能について ★★★
    // この部分は、Webhookとは別に、永続的なサーバープロセスで定期的にDBの状態を監視し、
    // 未応答ユーザーに対して再プッシュメッセージを送ったり、OFFICER_GROUP_IDに通知したりする
    // 独立したCronジョブや、キューイングシステムを用いることで実現可能です。
    // 例: 毎日15:05に、lastOkResponseが24時間以上前のユーザーをチェックし、再通知。
    // 例: 毎日20:05に、再通知から5時間経っても応答がないユーザーをチェックし、理事グループにアラート。
    // 今回のコードには、Webhookハンドラ内でこれらの複雑な状態管理は直接組み込んでいません。
    // 必要であれば、別途そのためのロジックを設計・実装する必要があります。
}

// --- メインのWebhookハンドラ ---
app.post("/webhook", async (req, res) => {
    // 処理開始時にDB接続を確立（または既存の接続を取得）
    const db = await connectToMongoDB();
    if (!db) {
        console.error('Database connection failed at webhook entry.');
        return res.status(500).send('Database connection failed.');
    }
    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    res.status(200).send("OK");
    const events = req.body.events;

    for (const event of events) {
        if (!event.source || !event.source.userId) {
            console.warn('Skipping event due to missing source or userId:', event);
            continue;
        }

        const userId = event.source.userId;
        console.log("★ 受信 userId:", userId);
        const replyToken = event.replyToken;
        const groupId = event.source?.groupId ?? null;
        const isAdmin = isBotAdmin(userId);

        // --- ユーザー情報の取得または新規登録 (MongoDB連携) ---
        let user = await usersCollection.findOne({ userId: userId });
        if (!user) {
            const profile = await client.getProfile(userId);
            await usersCollection.insertOne({
                userId: userId,
                name: profile.displayName,
                wantsWatchCheck: false, // デフォルトでは見守りOFF
                emergencyContact: null, // デフォルトでnull
                lastOkResponse: null, // デフォルトでnull
                registrationStep: null, // 登録ステップの管理用
                createdAt: new Date(),
            });
            user = await usersCollection.findOne({ userId: userId }); // 再度取得

            // 新規フォロー時の挨拶 (初回メッセージ受信時)
            if (event.type === 'message' && event.message.type === 'text') {
                await client.replyMessage(replyToken, {
                    type: 'text',
                    text: `こんにちは💖こころちゃんだよ！\n私とLINEで繋がってくれてありがとう🌸\n\n困ったことや誰かに聞いてほしいことがあったら、いつでも話しかけてね。わたしはあなたの味方だよ😊\n\n『見守り』と送ると、定期的にわたしから「元気かな？」ってメッセージを送る見守りサービスも利用できるよ💖`
                });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: event.message.text, // ユーザーの最初のメッセージも記録
                    replyText: `こんにちは💖こころちゃんだよ！...`,
                    respondedBy: 'こころちゃん（初回挨拶）',
                    timestamp: new Date(),
                });
                continue; // 初回挨拶後は一旦処理を終了
            }
        }

        // メッセージがテキストタイプでない場合は、固定メッセージで返信しログに記録
        if (event.type !== "message" && event.type !== "postback") {
            const nonTextMessageReply = 'ごめんね、こころちゃん、まだテキストメッセージしかわからないんだ💦';
            await client.replyMessage(replyToken, { type: 'text', text: nonTextMessageReply });
            await messagesCollection.insertOne({
                userId: userId,
                message: `[${event.type || '不明'}メッセージ]`,
                replyText: nonTextMessageReply,
                respondedBy: 'こころちゃん（非テキスト/非Postback）',
                timestamp: new Date(),
            });
            continue;
        }

        // --- Postback イベントの処理 ---
        if (event.type === 'postback') {
            const data = event.postback.data;
            console.log("Postback Data:", data);

            if (data === 'action=watch_register') {
                if (user && user.wantsWatchCheck) {
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: 'もう見守りサービスに登録済みだよ🌸 いつもありがとう💖'
                    });
                } else {
                    // 登録ステップ開始（緊急連絡先を求める）
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { registrationStep: 'awaiting_contact' } }
                    );
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: watchServiceNotice // 注意事項を表示し、電話番号入力を促す
                    });
                }
                await messagesCollection.insertOne({
                    userId: userId,
                    message: `[Postback: ${data}]`,
                    replyText: '（見守り登録処理開始）',
                    respondedBy: 'こころちゃん（Postback）',
                    timestamp: new Date(),
                });
                continue;
            }

            if (data === 'action=watch_unregister') {
                if (user && user.wantsWatchCheck) {
                    await usersCollection.updateOne(
                        { userId: userId },
                        {
                            $set: {
                                wantsWatchCheck: false,
                                emergencyContact: null,
                                registrationStep: null
                            }
                        }
                    );
                    const cancelMessage = `🌙見守りサービスを解除したよ。また再登録もいつでもできるからね🌸`;
                    await client.replyMessage(replyToken, { type: 'text', text: cancelMessage });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: `[Postback: ${data}]`,
                        replyText: cancelMessage,
                        respondedBy: 'こころちゃん（Postback）',
                        timestamp: new Date(),
                    });
                } else {
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: '見守りサービスは、まだ登録されてないみたいだよ🌸'
                    });
                }
                continue;
            }
             // その他のPostbackデータがあればここに追加
            if (data === 'action=ok_response') {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastOkResponse: new Date() } }
                );
                const okReply = "よかった！😊 あなたが元気でこころも嬉しいよ🌸 いつもありがとう💖";
                await client.replyMessage(replyToken, { type: 'text', text: okReply });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: `[Postback: ${data}]`,
                    replyText: okReply,
                    respondedBy: 'こころちゃん（Postback OK応答）',
                    timestamp: new Date(),
                });
                continue;
            }
        }

        // テキストメッセージイベントの場合のみ event.message.text を参照
        if (event.type !== 'message' || event.message.type !== 'text') {
            continue;
        }

        const userMessage = event.message.text;

        // --- 見守りサービス関連の処理を最優先で確認 ---
        const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
        if (handledByWatchService) {
            continue;
        }

        // 管理者からのメッセージは、危険・詐欺・不適切ワードの検知をスキップし、AI応答を生成する
        if (isAdmin) {
            if (userMessage === "管理パネル") {
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
                                { type: "button", style: "primary", color: "#FFA500", action: { type: "message", label: "こころちゃん緊急停止", text: "こころちゃん緊急停止" } },
                                { type: "button", style: "primary", color: "#FF6347", action: { type: "message", label: "見守りサービス手動実行", text: "見守りサービス手動実行" } }
                            ]
                        }
                    }
                };

                await client.replyMessage(replyToken, {
                    type: "flex",
                    altText: adminPanelFlex.altText,
                    contents: adminPanelFlex.contents
                });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '（管理者メニュー表示）',
                    respondedBy: 'こころちゃん（管理者）',
                    isAdmin: true,
                    timestamp: new Date(),
                });
                continue;
            }

            if (userMessage === "利用者数確認") {
                const userCount = await usersCollection.countDocuments({});
                await client.replyMessage(replyToken, {
                    type: "text",
                    text: `現在の利用者数は ${userCount} 名だよ🌸`
                });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: `現在の利用者数は ${userCount} 名だよ🌸`,
                    respondedBy: 'こころちゃん（管理者）',
                    isAdmin: true,
                    timestamp: new Date(),
                });
                continue;
            }

            if (userMessage === "サーバー状況確認") {
                await client.replyMessage(replyToken, {
                    type: "text",
                    text: "サーバーは正常に稼働中だよ🌸"
                });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: 'サーバーは正常に稼働中だよ🌸',
                    respondedBy: 'こころちゃん（管理者）',
                    isAdmin: true,
                    timestamp: new Date(),
                });
                continue;
            }

            if (userMessage === "こころちゃん緊急停止") {
                await client.replyMessage(replyToken, {
                    type: "text",
                    text: "緊急停止は未実装だよ🌸（今後実装予定）"
                });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '緊急停止は未実装だよ🌸（今後実装予定）',
                    respondedBy: 'こころちゃん（管理者）',
                    isAdmin: true,
                    timestamp: new Date(),
                });
                continue;
            }

            if (userMessage === "見守りサービス手動実行") {
                await client.replyMessage(replyToken, {
                    type: "text",
                    text: "見守りサービスの手動実行を開始するね🌸 少し時間がかかることがあるよ！"
                });
                await sendScheduledWatchMessage();
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '見守りサービスの手動実行を開始するね🌸 少し時間がかかることがあるよ！',
                    respondedBy: 'こころちゃん（管理者）',
                    isAdmin: true,
                    timestamp: new Date(),
                });
                continue;
            }

            // 管理者へのAI応答
            const replyText = await generateReply(userMessage);
            await client.replyMessage(replyToken, { type: "text", text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（AI応答）',
                isAdmin: true,
                timestamp: new Date(),
            });
            continue;
        }

        // グループからのメッセージかつ危険・詐欺ワードでなければ、処理をスキップ (元のロジックを保持)
        if (groupId && !containsDangerWords(userMessage) && !containsScamWords(userMessage)) {
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: '（グループメッセージのため自動返信なし）',
                respondedBy: 'システム',
                groupId: groupId,
                timestamp: new Date(),
            });
            continue;
        }

        // 不適切ワードチェックを最優先に
        if (containsInappropriateWords(userMessage)) {
            const replyForInappropriate = "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
            await client.replyMessage(replyToken, {
                type: "text",
                text: replyForInappropriate
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
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyForInappropriate,
                respondedBy: 'こころちゃん（固定返信：不適切）',
                isWarning: true,
                warningType: 'inappropriate',
                timestamp: new Date(),
            });
            continue;
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
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: '（詐欺警告をユーザーに送信）',
                respondedBy: 'こころちゃん（固定返信：詐欺警告）',
                isWarning: true,
                warningType: 'scam',
                timestamp: new Date(),
            });
            continue;
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
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: '（危険警告をユーザーに送信）',
                respondedBy: 'こころちゃん（固定返信：危険警告）',
                isWarning: true,
                warningType: 'danger',
                timestamp: new Date(),
            });
            continue;
        }

        // --- 特殊返答のチェックをGemini AI応答より優先 ---
        const specialReply = checkSpecialReply(userMessage);
        if (specialReply) {
            await client.replyMessage(replyToken, { type: "text", text: specialReply });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: specialReply,
                respondedBy: 'こころちゃん（固定返信：特殊）',
                timestamp: new Date(),
            });
            continue;
        }

        // デフォルトのAI応答
        const replyText = await generateReply(userMessage);
        await client.replyMessage(replyToken, { type: "text", text: replyText });
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: replyText,
            respondedBy: 'こころちゃん（AI応答）',
            timestamp: new Date(),
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await connectToMongoDB();

    cron.schedule('0 15 */3 * *', async () => {
        console.log('--- Cron job: 定期見守りメッセージ送信 ---');
        await sendScheduledWatchMessage();
    }, {
        timezone: "Asia/Tokyo"
    });

    console.log('✅ 定期見守りメッセージのCronジョブをスケジュールしました（3日に1度、15時）。');
});
