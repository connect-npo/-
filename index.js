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
    "しにたい", "死にたい", "自殺", "消えたい", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
    "虐待", "パワハラ", "お金がない", "お金足りない", "貧乏", "死にそう", "DV", "無理やり"
];

const highConfidenceScamWords = [
    "アマゾン", "amazon", "架空請求", "詐欺", "振込", "還付金", "カード利用確認", "利用停止",
    "未納", "請求書", "コンビニ", "電子マネー", "支払い番号", "支払期限",
    // 「サギ」「さぎ」は前回削除済み。ここに変更なし。
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

const specialRepliesMap = new Map([
    // 名前に関する応答
    ["君の名前なんていうの？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["名前なんていうの？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["君の名前は？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["名前は？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["お前の名前は", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["こころじゃないの？", "うん、わたしの名前は皆守こころ💖　これからもよろしくね🌸"],
    ["こころチャットなのにうそつきじゃん", "ごめんなさい💦 わたしの名前は皆守こころだよ🌸 誤解させちゃってごめんね💖"],
    ["名前も言えないの？", "ごめんね、わたしの名前は皆守こころ（みなもりこころ）だよ🌸 こころちゃんって呼んでくれると嬉しいな💖"],

    // 団体に関する応答
    ["どこの団体なの？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトってどんな団体？", "NPO法人コネクトは、こどもやご年配の方の笑顔を守る団体なんだよ😊　わたしはそのイメージキャラクターとしてがんばってます🌸"],
    ["お前の団体どこ？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトのイメージキャラなのにいえないのかよｗ", "ごめんね💦 わたしはNPO法人コネクトのイメージキャラクター、皆守こころだよ🌸 安心して、何でも聞いてね💖"],
    // 以前の negativeResponses の内容もAIに任せるため、マップからは削除

    // ホームページに関する応答
    ["ホームページ教えて", "うん、あるよ🌸　コネクトのホームページはこちらだよ✨ → https://connect-npo.org"],
    ["ホームページある？", "うん、あるよ🌸　コネクトのホームページはこちらだよ✨ → https://connect-npo.org"],
    ["コネクトのホームページだよ？", "教えてくれてありがとう😊 コネクトのホームページはこちらだよ✨ → https://connect-npo.org"],

    // 会話の終了・拒否・不満に対する応答
    ["使えないな", "ごめんね…。わたし、もっと頑張るね💖　またいつかお話できたらうれしいな🌸"],
    ["サービス辞めるわ", "そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖"],
    ["さよなら", "また会える日を楽しみにしてるね💖 寂しくなったら、いつでも呼んでね🌸"],
    ["バイバイ", "またね🌸 あなたに素敵なことがたくさんありますように💖"],
    ["何も答えないじゃない", "ごめんね…。わたし、もっと頑張るね💖　何について知りたいか、もう一度教えてくれると嬉しいな🌸"],
    ["普通の会話が出来ないなら必要ないです", "ごめんね💦 わたし、まだお話の勉強中だから、不慣れなところがあるかもしれないけど、もっと頑張るね💖 どんな会話をしたいか教えてくれると嬉しいな🌸"],

    // その他の定型応答
    ["好きなアニメ", "わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖"],
    ["好きなアーティスト", "わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸"],

    // こころちゃんの使い方テンプレート
    ["使い方", "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],
    ["ヘルプ", "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],
    ["メニュー", "こころちゃんのメニューだよ🌸 画面下のリッチメニューや、'見守り'とメッセージを送ってくれると、いろいろな機能が使えるよ😊"]
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

const watchServiceGuideFlex = {
    type: 'flex',
    altText: 'こころちゃんから見守りサービスのご案内🌸',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '🌸見守りサービス🌸', weight: 'bold', size: 'lg' },
                { type: 'text', text: '3日に1回こころちゃんが「元気かな？」って聞くね！💖', wrap: true, size: 'sm', margin: 'md' },
                { type: 'text', text: '「OKだよ」などのボタンを押すだけで、見守り完了だよ😊', wrap: true, size: 'sm' }
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

// ★追加：IDがユーザーID（Uで始まる）かどうかを判定する関数
function isUserId(id) {
    return id && id.startsWith("U");
}

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
    return false;
}

// ★追加：不適切ワードが含まれるかをチェックする関数
function containsInappropriateWords(text) {
    const lowerText = text.toLowerCase();
    return inappropriateWords.some(word => lowerText.includes(word));
}

// ★追加：ログを保存すべきか判定する関数
function shouldLogMessage(text) {
    return containsDangerWords(text) || containsScamWords(text) || containsInappropriateWords(text);
}


function checkSpecialReply(text) {
    const lowerText = text.toLowerCase();
    for (const [key, value] of specialRepliesMap) {
        if (lowerText === key.toLowerCase()) {
            return value;
        }
    }
    const sortedKeys = Array.from(specialRepliesMap.keys()).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        if (lowerText.includes(key.toLowerCase())) {
            return specialRepliesMap.get(key);
        }
    }
    return null;
}

function containsHomeworkTrigger(text) {
    return homeworkTriggers.some(word => text.includes(word));
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
    modelName = "gemini-1.5-flash";

    const isHomeworkQuestion = containsHomeworkTrigger(userMessage);
    const isInappropriate = containsInappropriateWords(userMessage);

    if (isInappropriate) {
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

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

もし「反社」「怪しい」「税金泥棒」「松本博文」（理事長の名前）など、NPO法人コネクトや私（こころちゃん）に対する疑念や不適切な言葉が投げかけられた場合、**感情的にならず、あくまで冷静に、そして自信を持って、NPO法人コネクトが信頼できる団体であること、そしてご自身の活動の目的を優しく伝えてください。**
例：「NPO法人コネクトは、みんなを笑顔にするために活動している素敵な団体だよ🌸　わたしたちの活動内容や想いはホームページにも載っているから、ぜひ見てほしいな😊　何か気になることがあったら、いつでも私に聞いてね。　一緒に考えてみよう💖」
決して、AIの安全性警告を直接ユーザーに伝えるような返答はせず、こころちゃんとしてのポジティブなメッセージを伝えてください。
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

// handleWatchServiceRegistration関数内のmessagesCollection.insertOne()の呼び出し箇所は、
// 見守りサービス登録・解除・OK応答のログなので、そのまま残します。
// これらのログはサービス運用上、常に必要と考えられます。
async function handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage) {
    const user = await usersCollection.findOne({ userId: userId });

    const lowerUserMessage = userMessage.toLowerCase();
    if (["見守り", "みまもり", "見守りサービス", "みまもりサービス"].includes(lowerUserMessage) && event.type === 'message' && event.message.type === 'text') {
        await client.replyMessage(event.replyToken, watchServiceGuideFlex);
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: '（見守りサービス案内Flex表示）',
            respondedBy: 'こころちゃん（見守り案内）',
            timestamp: new Date(),
            // ★追加：ログタイプ
            logType: 'watch_service_interaction'
        });
        return true;
    }


    if (userMessage.includes("見守り登録します")) {
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

    if (user && user.registrationStep === 'awaiting_contact') {
        const phoneRegex = /^(0\d{9,10})$/;
        if (phoneRegex.test(userMessage)) {
            await usersCollection.updateOne(
                { userId: userId },
                {
                    $set: {
                        wantsWatchCheck: true,
                        emergencyContact: userMessage,
                        lastOkResponse: new Date(),
                        registrationStep: null
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
                // ★追加：ログタイプ
                logType: 'watch_service_registration'
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

    if (userMessage.includes("見守り解除します")) {
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
            await client.replyMessage(event.replyToken, { type: 'text', text: cancelMessage });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: cancelMessage,
                respondedBy: 'こころちゃん（見守り解除）',
                timestamp: new Date(),
                // ★追加：ログタイプ
                logType: 'watch_service_unregistration'
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
            // ★追加：ログタイプ
            logType: 'watch_service_ok_response'
        });
        return true;
    }

    return false;
}


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
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));

    const targetUsers = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        $or: [
            { lastOkResponse: { $lt: threeDaysAgo } },
            { lastOkResponse: { $exists: false } }
        ]
    }).toArray();

    console.log(`✉️ 送信対象ユーザー: ${targetUsers.length}名`);

    for (const user of targetUsers) {
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
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ)',
                replyText: randomMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: new Date(),
                // ★追加：ログタイプ
                logType: 'scheduled_watch_message'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への見守りメッセージ送信に失敗しました:`, error.message);
        }
    }
    console.log('⏰ 定期見守りメッセージ送信処理が完了しました。');
}

app.post("/webhook", async (req, res) => {
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

        // ★追加：メッセージ重複防止
        if (event.type === 'message' && event.message.id) {
            const messageId = event.message.id;
            const isAlreadyLogged = await messagesCollection.findOne({ messageId: messageId });
            if (isAlreadyLogged) {
                console.log(`⚠️ 重複メッセージを検出しました。ID: ${messageId} スキップします。`);
                continue; // 既に処理済みのメッセージなのでスキップ
            }
        }


        let user = await usersCollection.findOne({ userId: userId });
        if (!user) {
            const profile = await client.getProfile(userId);
            await usersCollection.insertOne({
                userId: userId,
                name: profile.displayName,
                wantsWatchCheck: false,
                emergencyContact: null,
                lastOkResponse: null,
                registrationStep: null,
                createdAt: new Date(),
            });
            user = await usersCollection.findOne({ userId: userId });

            if (event.type === 'message' && event.message.type === 'text') {
                await client.replyMessage(replyToken, {
                    type: 'text',
                    text: `こんにちは💖こころちゃんだよ！\n私とLINEで繋がってくれてありがとう🌸\n\n困ったことや誰かに聞いてほしいことがあったら、いつでも話しかけてね。わたしはあなたの味方だよ😊\n\n『見守り』と送ると、定期的にわたしから「元気かな？」ってメッセージを送る見守りサービスも利用できるよ💖`
                });
                // ★修正：初回メッセージは、メッセージ重複対策のロジックとは別なので、ここではシンプルに保存。
                // ただし、特定のワードが含まれていなくてもログに残したいので、shouldLogMessageの判定は適用しない。
                await messagesCollection.insertOne({
                    userId: userId,
                    messageId: event.message.id || null, // messageIdを保存
                    message: event.message.text,
                    replyText: `こんにちは💖こころちゃんだよ！...`,
                    respondedBy: 'こころちゃん（初回挨拶）',
                    timestamp: new Date(),
                    logType: 'initial_greeting' // ログタイプを追加
                });
                continue;
            }
        }

        if (event.type !== "message" && event.type !== "postback") {
            const nonTextMessageReply = 'ごめんね、こころちゃん、まだテキストメッセージしかわからないんだ💦';
            await client.replyMessage(replyToken, { type: 'text', text: nonTextMessageReply });
            // ★修正：非テキストメッセージもログに記録し、メッセージIDも保存
            await messagesCollection.insertOne({
                userId: userId,
                messageId: event.message?.id || null, // messageIdを保存
                message: `[${event.type || '不明'}メッセージ]`,
                replyText: nonTextMessageReply,
                respondedBy: 'こころちゃん（非テキスト/非Postback）',
                timestamp: new Date(),
                logType: 'non_text_message' // ログタイプを追加
            });
            continue;
        }

        if (event.type === 'postback') {
            const data = event.postback.data;
            console.log("Postback Data:", data);

            // Postbackイベントのログは、重複防止の対象外。また、セキュリティ関連ログではないため、
            // shouldLogMessageの判定をせず、サービス運用に必要な情報として常に記録します。
            // logTypeを追加して、後でフィルタリングしやすくします。
            if (data === 'action=watch_register') {
                if (user && user.wantsWatchCheck) {
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: 'もう見守りサービスに登録済みだよ🌸 いつもありがとう💖'
                    });
                } else {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { registrationStep: 'awaiting_contact' } }
                    );
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: watchServiceNotice
                    });
                }
                await messagesCollection.insertOne({
                    userId: userId,
                    messageId: event.message?.id || null, // messageIdを保存
                    message: `[Postback: ${data}]`,
                    replyText: '（見守り登録処理開始）',
                    respondedBy: 'こころちゃん（Postback）',
                    timestamp: new Date(),
                    logType: 'postback_watch_register' // ログタイプを追加
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
                        messageId: event.message?.id || null, // messageIdを保存
                        message: `[Postback: ${data}]`,
                        replyText: cancelMessage,
                        respondedBy: 'こころちゃん（Postback）',
                        timestamp: new Date(),
                        logType: 'postback_watch_unregister' // ログタイプを追加
                    });
                } else {
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: '見守りサービスは、まだ登録されてないみたいだよ🌸'
                    });
                }
                continue;
            }
            if (data === 'action=ok_response') {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastOkResponse: new Date() } }
                );
                const okReply = "よかった！😊 あなたが元気でこころも嬉しいよ🌸 いつもありがとう💖";
                await client.replyMessage(replyToken, { type: 'text', text: okReply });
                await messagesCollection.insertOne({
                    userId: userId,
                    messageId: event.message?.id || null, // messageIdを保存
                    message: `[Postback: ${data}]`,
                    replyText: okReply,
                    respondedBy: 'こころちゃん（Postback OK応答）',
                    timestamp: new Date(),
                    logType: 'postback_ok_response' // ログタイプを追加
                });
                continue;
            }
        }

        if (event.type !== 'message' || event.message.type !== 'text') {
            continue;
        }

        const userMessage = event.message.text;

        const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
        if (handledByWatchService) {
            continue;
        }

        // ここからAI応答のロジック
        const specialReply = checkSpecialReply(userMessage);
        let replyText;
        if (specialReply) {
            replyText = specialReply;
        } else {
            replyText = await generateReply(userMessage);
        }

        try {
            await client.replyMessage(replyToken, { type: 'text', text: replyText });

            // ★修正：ログ保存の条件分岐
            const isDanger = containsDangerWords(userMessage);
            const isScam = containsScamWords(userMessage);
            const isInappropriate = containsInappropriateWords(userMessage);

            if (isDanger || isScam || isInappropriate) {
                // 危険ワード、詐欺ワード、不適切ワードが含まれる場合のみログに保存
                await messagesCollection.insertOne({
                    userId: userId,
                    messageId: event.message.id, // LINE Message IDを保存
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（AI応答）',
                    timestamp: new Date(),
                    isDanger: isDanger,
                    isScam: isScam,
                    isInappropriate: isInappropriate,
                    logType: 'flagged_message' // ログタイプを追加
                });
                console.log(`🚨 フラグ付きメッセージをログに保存しました。UserID: ${userId}, Message: "${userMessage}"`);

                // 管理者グループへの通知（危険ワードまたは詐欺ワードの場合）
                if (OFFICER_GROUP_ID && (isDanger || isScam)) {
                    const userName = await getUserDisplayName(userId);
                    const alertMessage =
                        `⚠️ 【重要通知】\n` +
                        `ユーザー (${userName}) から危険なメッセージを検出しました。\n\n` +
                        `ユーザーID: ${userId}\n` +
                        `メッセージ: ${userMessage}\n` +
                        `タイプ: ${isDanger ? '危険ワード' : ''}${isDanger && isScam ? ', ' : ''}${isScam ? '詐欺ワード' : ''}\n` +
                        `タイムスタンプ: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;

                    try {
                        await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: alertMessage });
                        console.log(`✅ 管理者グループに警告を送信しました。`);
                         // 管理者通知もログに残す
                        await messagesCollection.insertOne({
                            userId: null, // グループ通知なのでユーザーIDはnullまたは特定のシステムユーザーID
                            messageId: null, // 通知自体にはLINE Message IDはない
                            message: `[Admin Alert - User: ${userId}] ${userMessage}`,
                            replyText: alertMessage,
                            respondedBy: 'System (Admin Alert)',
                            timestamp: new Date(),
                            logType: 'admin_alert' // ログタイプを追加
                        });
                    } catch (alertError) {
                        console.error("❌ 管理者グループへの警告送信に失敗しました:", alertError.message);
                    }
                }
            } else {
                // 上記の危険ワード等に該当しない場合はログに保存しない
                console.log(`ℹ️ 通常のメッセージのため、ログは保存しません。UserID: ${userId}, Message: "${userMessage}"`);
            }
        } catch (error) {
            console.error("返信中にエラーが発生しました:", error.message);
             // 返信失敗時も、危険ワード等が含まれていればログに残す
            const isDanger = containsDangerWords(userMessage);
            const isScam = containsScamWords(userMessage);
            const isInappropriate = containsInappropriateWords(userMessage);

            if (isDanger || isScam || isInappropriate) {
                 await messagesCollection.insertOne({
                    userId: userId,
                    messageId: event.message.id,
                    message: userMessage,
                    replyText: `[ERROR] ${replyText}`, // エラー時の返信も記録
                    respondedBy: 'こころちゃん（AI応答エラー）',
                    timestamp: new Date(),
                    isDanger: isDanger,
                    isScam: isScam,
                    isInappropriate: isInappropriate,
                    logType: 'flagged_message_error' // エラー時のログタイプ
                 });
                 console.log(`🚨 エラー発生フラグ付きメッセージをログに保存しました。UserID: ${userId}, Message: "${userMessage}"`);
            }
        }
    }
});

// cronジョブを定義 (毎日午後3時に実行)
cron.schedule('0 15 * * *', async () => {
    console.log('--- 定期見守りメッセージの送信をトリガーします ---');
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo" // 日本時間で設定
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 サーバーがポート ${PORT} で起動しました！`);
    // アプリケーション起動時にMongoDBに接続
    connectToMongoDB();
});
