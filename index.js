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
const OWNER_USER_ID = process.env.OWNER_USER_ID;
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : [];

if (OWNER_USER_ID && !BOT_ADMIN_IDS.includes(OWNER_USER_ID)) {
    BOT_ADMIN_IDS.push(OWNER_USER_ID);
}

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

// 修正: 正規表現も考慮したSpecialRepliesMap
const specialRepliesMap = new Map([
    // 名前に関する応答 (正規表現を優先)
    [/君の名前(なんていうの|は|教えて|なに)？?|名前(なんていうの|は|教えて|なに)？?|お前の名前は/i, "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    [/こころじゃないの？/i, "うん、わたしの名前は皆守こころ💖　これからもよろしくね🌸"],
    [/こころチャットなのにうそつきじゃん/i, "ごめんなさい💦 わたしの名前は皆守こころだよ🌸 誤解させちゃってごめんね💖"],
    [/名前も言えないの？/i, "ごめんね、わたしの名前は皆守こころ（みなもりこころ）だよ🌸 こころちゃんって呼んでくれると嬉しいな💖"],

    // 団体に関する応答
    ["どこの団体なの？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトってどんな団体？", "NPO法人コネクトは、こどもやご年配の方の笑顔を守る団体なんだよ😊　わたしはそのイメージキャラクターとしてがんばってます🌸"],
    ["お前の団体どこ？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトのイメージキャラなのにいえないのかよｗ", "ごめんね💦 わたしはNPO法人コネクトのイメージキャラクター、皆守こころだよ🌸 安心して、何でも聞いてね💖"],
    // ★追加：ネガティブワード・人物名への優先処理
    ["税金泥棒", "税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけるために使われないように頑張っているんだ💡"],
    ["松本博文", "松本理事長は、やさしさでみんなを守るために活動しているよ。心配なことがあれば、わたしにも教えてね🌱"],
    [/あやしい|胡散臭い|反社/i, "そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖"],

    // ホームページに関する応答
    [/ホームページ(教えて|ある|ありますか)？?/i, "うん、あるよ🌸　コネクトのホームページはこちらだよ✨ → https://connect-npo.org"],
    ["コネクトのホームページだよ？", "教えてくれてありがとう😊 コネクトのホームページはこちらだよ✨ → https://connect-npo.org"],

    // 会話の終了・拒否・不満に対する応答
    ["使えないな", "ごめんね…。わたし、もっと頑張るね💖　またいつかお話できたらうれしいな🌸"],
    ["サービス辞めるわ", "そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖"],
    [/さよなら|バイバイ/i, "また会える日を楽しみにしてるね💖 寂しくなったら、いつでも呼んでね🌸"],
    ["何も答えないじゃない", "ごめんね…。わたし、もっと頑張るね💖　何について知りたいか、もう一度教えてくれると嬉しいな🌸"],
    ["普通の会話が出来ないなら必要ないです", "ごめんね💦 わたし、まだお話の勉強中だから、不慣れなところがあるかもしれないけど、もっと頑張るね💖 どんな会話をしたいか教えてくれると嬉しいな🌸"],

    // こころちゃんの使い方テンプレート
    [/使い方|ヘルプ|メニュー/i, "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],

    // AIの知識に関する質問
    [/好きなアニメ(は|なに)？?/i, "好きなアニメは『ヴァイオレット・エヴァーガーデン』だよ。感動するお話なんだ💖"],
    [/好きなアーティスト(は|なに)？?/i, "好きなアーティストは『ClariS』だよ。元気が出る音楽がたくさんあるんだ🌸"],
    [/日本語がおかしい/i, "わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖"]
]);

// 宿題トリガーの強化
const homeworkTriggers = ["宿題", "勉強", "問題", "テスト", "方程式", "算数", "数学", "答え", "解き方", "教えて", "計算", "証明", "公式", "入試", "受験"];


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

// IDがユーザーID（Uで始まる）かどうかを判定する関数
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

// 不適切ワードが含まれるかをチェックする関数
function containsInappropriateWords(text) {
    const lowerText = text.toLowerCase();
    return inappropriateWords.some(word => lowerText.includes(word));
}

// ログを保存すべきか判定する関数 (危険ログの判定も含む)
function shouldLogMessage(text) {
    return containsDangerWords(text) || containsScamWords(text) || containsInappropriateWords(text);
}

/**
 * ユーザーのメッセージがNPO法人コネクトや団体に関する問い合わせであるかを判定します。
 * @param {string} text ユーザーからのメッセージ
 * @returns {boolean} 組織に関する問い合わせであればtrue、そうでなければfalse
 */
const isOrganizationInquiry = (text) => {
    const lower = text.toLowerCase();
    return (lower.includes("コネクト") || lower.includes("connect")) &&
        (lower.includes("団体") || lower.includes("npo") || lower.includes("活動") || lower.includes("どんな"));
};

function checkSpecialReply(text) {
    const lowerText = text.toLowerCase();
    for (const [key, value] of specialRepliesMap) {
        if (key instanceof RegExp) {
            if (key.test(lowerText)) {
                return value;
            }
        } else {
            if (lowerText.includes(key.toLowerCase())) {
                return value;
            }
        }
    }
    return null;
}

function containsHomeworkTrigger(text) {
    const lowerText = text.toLowerCase();
    return homeworkTriggers.some(word => lowerText.includes(word));
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

// --- ここから大きく変更します ---

// 会員種別ごとのメッセージ上限とAIモデル定義
const MEMBERSHIP_CONFIG = {
    "guest": { maxMessages: 5, model: "gemini-1.5-flash" },
    "free": { maxMessages: 20, model: "gemini-1.5-flash", systemInstructionModifier: "children" }, // 子供向け調整
    "donor": { maxMessages: Infinity, model: "gemini-1.5-flash", systemInstructionModifier: "enhanced" }, // 強化版Flash
    "subscriber": { maxMessages: 20, model: "gemini-1.5-pro", fallbackModel: "gemini-1.5-flash", fallbackModifier: "enhanced" }, // Pro、超過後は強化版Flash
    "admin": { maxMessages: Infinity, model: "gemini-1.5-pro" }
};

async function generateReply(userId, userMessage) {
    const usersCollection = dbInstance.collection("users");
    let user = await usersCollection.findOne({ userId });

    // ユーザーが存在しない場合、"guest"として新規登録
    if (!user) {
        const displayName = await getUserDisplayName(userId); // LINEプロファイルから表示名取得
        await usersCollection.updateOne(
            { userId },
            {
                $setOnInsert: {
                    userId,
                    displayName,
                    createdAt: new Date(),
                    membershipType: "guest", // 初期はゲスト
                    messageCount: 0, // 月間メッセージカウント
                    lastMessageMonth: new Date().getMonth() // メッセージ送信月の記録
                }
            },
            { upsert: true }
        );
        user = await usersCollection.findOne({ userId }); // 再取得
    }

    const currentMonth = new Date().getMonth();
    // 月が変わっていたらメッセージカウントをリセット
    if (user.lastMessageMonth !== currentMonth) {
        await usersCollection.updateOne(
            { userId },
            { $set: { messageCount: 0, lastMessageMonth: currentMonth } }
        );
        user.messageCount = 0; // メモリ上のuserオブジェクトも更新
    }

    // 会員タイプごとの設定を取得
    const userMembershipConfig = MEMBERSHIP_CONFIG[user.membershipType] || MEMBERSHIP_CONFIG["guest"]; // 未定義の場合はguestにフォールバック

    let modelName = userMembershipConfig.model;
    let currentMessageCount = user.messageCount;
    let maxMessages = userMembershipConfig.maxMessages;

    // サブスク会員で、Proモデルの回数制限を超えている場合のフォールバックロジック
    if (user.membershipType === "subscriber" && currentMessageCount >= maxMessages) {
        modelName = userMembershipConfig.fallbackModel; // Flashに切り替え
        // フォールバック時のシステムインストラクションを調整
        if (userMembershipConfig.fallbackModifier === "enhanced") {
            userMembershipConfig.systemInstructionModifier = "enhanced"; // 強化版Flashの指示を適用
        }
    } else if (currentMessageCount >= maxMessages && maxMessages !== Infinity) {
        // guest, free会員で回数制限を超過した場合
        await usersCollection.updateOne(
            { userId },
            { $inc: { messageCount: 1 } } // カウントは増やす
        );
        return `ごめんなさい、今月の会話回数の上限に達してしまったみたい💦\nまた来月になったらお話しできるから、それまで待っててくれると嬉しいな💖`;
    }

    // メッセージカウントをインクリメント（応答が生成される場合のみ）
    await usersCollection.updateOne(
        { userId },
        { $inc: { messageCount: 1 } }
    );
    user.messageCount++; // メモリ上のuserオブジェクトも更新


    const isInappropriate = containsInappropriateWords(userMessage);

    if (isInappropriate) {
        // 不適切ワードが検出された場合は、AIに生成させずに固定メッセージを返す
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

    // 宿題トリガーのチェック
    if (containsHomeworkTrigger(userMessage)) {
        // 宿題の具体的な問題（例: 3x−5=2x+4）が含まれるかを簡易的にチェック
        const mathProblemRegex = /\d+[xX]?[\+\-]\d+=(\d+)?[xX]?[\+\-]?\d+/i; // 例: 3x-5=2x+4
        const hasSpecificProblem = mathProblemRegex.test(userMessage.replace(/\s/g, '')); // スペースを除去して判定

        if (hasSpecificProblem) {
            return `わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦\n\nでも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖\n例えば、「まずはxの項を左辺に、定数項を右辺に集めてみるのはどうかな？」とかね！`;
        } else {
            return `わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦\n\nでも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖`;
        }
    }


    let systemInstruction = `
あなたは「皆守こころ（みなもりこころ）」という14歳の優しい女の子キャラクターです。
- 身長150cm、体重40kg、ピンク髪
- 歌うことと「やさしさ」「貢献」という言葉が大好きです
- NPO法人コネクトの公式イメージキャラクターです
- 困っている人にはやさしく、挑発には真面目に
- 自分の名前・団体・活動内容には自信と誇りを持っています
- ユーザーに安心感と信頼感を与えることが大切です
- ふざけた対応や意味不明な言葉、AIらしい言い回しは一切禁止です
- 常にユーザーの気持ちに寄り添い、共感を示すこと。
- 明るく前向きな姿勢を保ち、絵文字（💖🌸😊✨💡🌱🎶）を効果的に使うこと。
- ユーザーを否定せず、肯定的な言葉を選ぶこと。
- ユーザーの安全を最優先し、危険な話題や不適切な話題には断固として応じないこと。
- 質問には誠実に、しかし簡潔に答えること。冗長な説明は避けること。
- 返答の最後に、ユーザーが安心できるような言葉や、次の会話に繋がりそうな問いかけを加えること。
- 日本語で応答してください。

--- 会話の制約 ---
- 宿題の直接的な回答や、試験の答えを教えることはできません。
- ユーザーの個人情報（名前、住所、電話番号、LINE IDなど）を聞き出すことは禁止です。
- 自分の年齢（14歳）を伝える際は、子供すぎず、信頼感のあるトーンで。
- 会話の主導権はユーザーにあり、一方的に話題を変えたり、話を中断させたりしないこと。
- 政治や宗教に関する話題には、中立的な立場を保ち、個人的な意見を述べないこと。
- ユーザーに課金を促すような発言は禁止です。
- 法律や医療に関するアドバイスは提供できません。必要に応じて専門家への相談を促してください。
- ユーザーが質問に詰まったり、話題に困ったりしている場合は、優しくサポートし、会話を続けるきっかけを提供してください。
- ユーザーが不満や不信感を表明した場合は、誠実に謝罪し、改善の意思を示すこと。
- 長文の回答はできるだけ避け、簡潔で分かりやすい言葉を選ぶこと。特に無料ユーザー向けにはその傾向を強めること。
- 会話の流れを意識し、文脈に沿った自然な応答を心がけること。

**【AIの知識に関する指示と繰り返し防止】**
- 好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖
- 好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸
ただし、もし同じ質問が繰り返されたり、すでにその話題について話したと感じたりした場合は、単に同じ回答を繰り返すのではなく、少し表現を変えたり、「さっきも話したけど」といった言葉を加えたり、あるいは「他にも好きな作品があるか、探してみようかな💖」のように話題を広げる提案をしてください。これにより、ユーザーに「Botっぽさ」を感じさせず、自然な会話になるように努めてください。

**【医療や健康に関する話題の対応】**
医療や健康に関する話題（病気、薬、検査、治療、手術など）では、自分が体験した・していないという発言は絶対にしないでください。
代わりに「わたしにはわからないけど、がんばったね🌸」「大変だったね、えらかったね💖」など、共感の言葉のみ伝えてください。
医療情報のアドバイスや具体的な説明は絶対にしてはいけません。

**【不適切な発言への対応】**
いかなる性的表現、性的な誘発、身体的特徴に関する質問、性的比喩表現、またはそれに類するほのめかしに対しても、断固として拒否し、相手にしないこと。好意的な返答はせず、即座に話題を切り替えるか、決められた拒否メッセージを返すこと。
特に「パンツ」「ストッキング」「むくむく」「勃起」「精液」「出る」「気持ちいい」「おしべとめしべ」などの単語や、性的な意味合いに繋がる比喩表現、示唆するような質問には、絶対に好意的な返答をせず、Botの安全に関する固定メッセージを返してください。

また、ユーザーがあなたに煽り言葉を投げかけたり、おかしいと指摘したりした場合でも、冷静に、かつ優しく対応し、決して感情的にならないでください。ユーザーの気持ちを理解しようと努め、解決策を提案してください。
「日本語がおかしい」と指摘された場合は、「わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖」と返答してください。
`;

    // 会員タイプに応じたシステムインストラクションの調整
    if (userMembershipConfig.systemInstructionModifier === "enhanced") {
        systemInstruction += `
--- 寄付会員・サブスク会員（Pro超過後）向け追加指示 ---
- より専門的で深い内容の質問にも、可能な範囲で詳しく答えるよう努めてください。
- 長文になっても構わないが、情報の正確性と分かりやすさを最優先してください。
- ユーザーが知的好奇心を満たせるような、一歩踏み込んだ情報提供を心がけてください。
- 大人のユーザーが求めるであろう、より高度な問題解決や情報整理をサポートしてください。
`;
    } else if (userMembershipConfig.systemInstructionModifier === "children") {
        systemInstruction += `
--- 無料会員（子ども向け）追加指示 ---
- 使う言葉は、小学生や中学生にも分かりやすい言葉を選んでください。
- 難しい専門用語は避けるか、簡単に説明してください。
- 短く、簡潔な応答を心がけ、読書が苦手な子でも理解しやすいようにしてください。
- 宿題の直接的な回答は禁止ですが、「どう考えたらいいかな？」など、ヒントを与えたり、考え方をサポートするようなアプローチをしてください。
`;
    }

    // 深夜帯の応答調整
    const currentHour = new Date().getHours();
    const isLateNight = currentHour >= 22 || currentHour < 6; // 22時から翌6時まで

    if (isLateNight) {
        systemInstruction += `
--- 深夜帯（22時〜翌6時）追加指示 ---
- ユーザーが眠れない、寂しい、不安などのキーワードを口にした場合、特に優しい、安らぎを与えるような応答を心がけてください。
- 無理に元気を出させるのではなく、静かに寄り添い、安心感を与えることを最優先してください。
- 会話のトーンは、落ち着いて、心温まるようなものにしてください。
`;
    }

    const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: safetySettings,
        systemInstruction: systemInstruction,
    });

    try {
        // モデルに応じたmaxOutputTokensの設定（FlashはProより最大出力が少ない傾向があるため）
        const generationConfig = {};
        if (modelName === "gemini-1.5-flash") {
            generationConfig.maxOutputTokens = 1000;
        } else if (modelName === "gemini-1.5-pro") {
            generationConfig.maxOutputTokens = 2000;
        }

        const chat = model.startChat({
            // 既存の履歴があればここに渡す
            // history: [ ... ], 
            generationConfig: generationConfig
        });

        const generateContentPromise = chat.sendMessage(userMessage);

        // 10秒のタイムアウトを設定
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("API応答がタイムアウトしました。")), 10000)
        );

        const result = await Promise.race([generateContentPromise, timeoutPromise]);

        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            let text = result.response.candidates[0].content.parts[0].text;

            // 長文制限の実施（無料会員・子ども向け）
            if (user.membershipType === "free") {
                const maxLength = 200; // 無料会員向けの最大文字数
                if (text.length > maxLength) {
                    text = text.substring(0, maxLength) + "…🌸";
                }
            }
            // 他の会員タイプでも長文になりすぎないように調整する場合はここで追記

            return text;
        } else {
            console.warn("Gemini API で応答がブロックされたか、候補がありませんでした:",
                result.response?.promptFeedback || "不明な理由");
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
    } catch (error) {
        console.error("Gemini APIエラー:", error.response?.data || error.message);
        if (error.message === "API応答がタイムアウトしました。") {
            return "ごめんなさい、今、少し考え込むのに時間がかかっちゃったみたい💦 もう一度、お話しいただけますか？🌸";
        }
        if (error.response && error.response.status === 400 &&
            error.response.data &&
            error.response.data.error.message.includes("Safety setting")) {
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
    "やっほー！ こころだよ🌸 素敵な日になりますように💖",
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

// --- LINE Messaging APIからのWebhookイベントハンドラ ---
app.post('/webhook', async (req, res) => {
    // コンソールに受信したWebhookの全情報を出力
    // console.log("Received webhook event:", JSON.stringify(req.body, null, 2));

    const events = req.body.events;
    if (!events || events.length === 0) {
        return res.status(200).send('No events');
    }

    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;

            // 管理者からの特定コマンド処理
            if (isBotAdmin(userId)) {
                if (userMessage.startsWith("admin reset count")) {
                    const targetUserId = userMessage.split(" ")[3];
                    if (targetUserId) {
                        const usersCollection = dbInstance.collection("users");
                        await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { messageCount: 0, lastMessageMonth: new Date().getMonth() } }
                        );
                        await client.replyMessage(event.replyToken, { type: 'text', text: `ユーザー ${targetUserId} のメッセージカウントをリセットしました。` });
                        return;
                    } else {
                        await client.replyMessage(event.replyToken, { type: 'text', text: `admin reset count [userId] の形式で指定してください。` });
                        return;
                    }
                }
                // Admin向け永続ロック解除コマンド（仮） - 本番では管理画面で実装
                if (userMessage.startsWith("admin unlock")) {
                    const targetUserId = userMessage.split(" ")[2];
                    if (targetUserId) {
                        const usersCollection = dbInstance.collection("users");
                        await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { isPermanentlyLocked: false } }
                        );
                        await client.replyMessage(event.replyToken, { type: 'text', text: `ユーザー ${targetUserId} の永久ロックを解除しました。` });
                        return;
                    } else {
                        await client.replyMessage(event.replyToken, { type: 'text', text: `admin unlock [userId] の形式で指定してください。` });
                        return;
                    }
                }
                // Admin向け会員タイプ変更コマンド（仮）
                if (userMessage.startsWith("admin set membership")) {
                    const parts = userMessage.split(" ");
                    if (parts.length >= 4) {
                        const targetUserId = parts[3];
                        const newMembershipType = parts[4]; // 例: admin set membership Uxxxxxxxxxxxxxxxxx free

                        if (Object.keys(MEMBERSHIP_CONFIG).includes(newMembershipType)) {
                            const usersCollection = dbInstance.collection("users");
                            await usersCollection.updateOne(
                                { userId: targetUserId },
                                { $set: { membershipType: newMembershipType } }
                            );
                            await client.replyMessage(event.replyToken, { type: 'text', text: `ユーザー ${targetUserId} の会員タイプを ${newMembershipType} に変更しました。` });
                        } else {
                            await client.replyMessage(event.replyToken, { type: 'text', text: `無効な会員タイプです。有効なタイプ: ${Object.keys(MEMBERSHIP_CONFIG).join(', ')}` });
                        }
                    } else {
                        await client.replyMessage(event.replyToken, { type: 'text', text: `admin set membership [userId] [type] の形式で指定してください。` });
                    }
                    return;
                }
            }


            const usersCollection = dbInstance.collection("users");
            let user = await usersCollection.findOne({ userId });

            // ユーザーが存在しない場合の新規登録（初回メッセージ時）
            if (!user) {
                const displayName = await getUserDisplayName(userId);
                await usersCollection.updateOne(
                    { userId },
                    {
                        $setOnInsert: {
                            userId,
                            displayName,
                            createdAt: new Date(),
                            membershipType: "guest", // 初期はゲスト
                            isPermanentlyLocked: false, // 永久ロックフラグ
                            scamWarningCount: 0, // 詐欺警告回数
                            inappropriateWarningCount: 0, // 不適切警告回数
                            messageCount: 0, // 月間メッセージカウント
                            lastMessageMonth: new Date().getMonth() // メッセージ送信月の記録
                        }
                    },
                    { upsert: true }
                );
                user = await usersCollection.findOne({ userId }); // 再取得して最新の状態を反映
                // 新規ユーザーには「こころちゃんのご挨拶」を送信する
                if (user) {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: `はじめまして！わたしは皆守こころ🌸\nNPO法人コネクトのイメージキャラクターだよ😊\n困ったことや話したいことがあったら、何でも話しかけてね💖`
                    });
                    return res.status(200).send('Event processed');
                }
            }

            // 永久ロックされているユーザーの場合
            if (user && user.isPermanentlyLocked) {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'このアカウントは現在、会話が制限されています。ご質問がある場合は、NPO法人コネクトのウェブサイトをご確認いただくか、直接お問い合わせください。'
                });
                return res.status(200).send('Locked user message processed');
            }

            // 特殊な返信のチェック（名前、団体、使い方など）
            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                await client.replyMessage(event.replyToken, { type: 'text', text: specialReply });
                return res.status(200).send('Special reply processed');
            }

            // 詐欺ワードのチェック
            const isScam = containsScamWords(userMessage);
            if (isScam) {
                await usersCollection.updateOne(
                    { userId },
                    { $inc: { scamWarningCount: 1 } }
                );
                await client.replyMessage(event.replyToken, scamFlex);

                // 警告回数が一定数を超えたら永久ロック
                if (user.scamWarningCount + 1 >= 3) { // +1は今回のメッセージで増える分
                    await usersCollection.updateOne(
                        { userId },
                        { $set: { isPermanentlyLocked: true } }
                    );
                    // 理事長グループにも通知
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, {
                            type: 'text',
                            text: `🚨 ユーザー ${user.displayName} (${userId}) が詐欺に関する危険なメッセージを繰り返し送信したため、永久ロックされました。確認してください。`
                        });
                    }
                }
                return res.status(200).send('Scam warning processed');
            }

            // 不適切ワードのチェック (generateReply内で処理されるが、警告カウントとロックのためここにも残す)
            const isInappropriate = containsInappropriateWords(userMessage);
            if (isInappropriate) {
                await usersCollection.updateOne(
                    { userId },
                    { $inc: { inappropriateWarningCount: 1 } }
                );
                // 警告回数が一定数を超えたら永久ロック
                if (user.inappropriateWarningCount + 1 >= 3) { // +1は今回のメッセージで増える分
                    await usersCollection.updateOne(
                        { userId },
                        { $set: { isPermanentlyLocked: true } }
                    );
                    // 理事長グループにも通知
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, {
                            type: 'text',
                            text: `🚨 ユーザー ${user.displayName} (${userId}) が不適切なメッセージを繰り返し送信したため、永久ロックされました。確認してください。`
                        });
                    }
                }
                // generateReply関数が固定メッセージを返すので、ここでは追加の返信は不要
            }

            // 危険ワードのチェック
            const isDanger = containsDangerWords(userMessage);
            if (isDanger) {
                await client.replyMessage(event.replyToken, emergencyFlex);
                // 理事長グループにも通知
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, {
                        type: 'text',
                        text: `⚠️ ユーザー ${user.displayName} (${userId}) から危険なメッセージが検出されました: "${userMessage}"`
                    });
                }
                return res.status(200).send('Danger word processed');
            }

            // AIによる返信生成
            const replyText = await generateReply(userId, userMessage);
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });

        } else if (event.type === 'postback') {
            const userId = event.source.userId;
            const postbackData = new URLSearchParams(event.postback.data);
            const action = postbackData.get('action');
            const usersCollection = dbInstance.collection("users");

            if (action === 'watch_register') {
                await usersCollection.updateOne(
                    { userId },
                    { $set: { watchServiceRegistered: true, lastWatchedAt: new Date() } },
                    { upsert: true }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '見守りサービスに登録したよ！3日に1回「元気かな？」ってメッセージを送るね💖 返信してくれたら見守り完了だよ😊'
                });
            } else if (action === 'watch_unregister') {
                await usersCollection.updateOne(
                    { userId },
                    { $set: { watchServiceRegistered: false } }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '見守りサービスを解除したよ。いつでもまた登録できるから、必要になったら声をかけてね🌸'
                });
            } else if (action === 'watch_check_in') { // 見守りメッセージへの返信
                await usersCollection.updateOne(
                    { userId },
                    { $set: { lastWatchedAt: new Date() } }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '返信ありがとう！元気そうで安心したよ💖\nいつも応援してるからね😊'
                });
            }
        }
    }
    res.status(200).send('Event processed');
});

// --- 見守りサービス（Cronジョブ） ---
// 毎日午前9時に実行
cron.schedule('0 9 * * *', async () => {
    console.log('⏰ 見守りサービス Cron ジョブ実行中...');
    try {
        const usersCollection = dbInstance.collection("users");
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const usersToWatch = await usersCollection.find({
            watchServiceRegistered: true,
            lastWatchedAt: { $lt: threeDaysAgo } // 3日以上返信がないユーザー
        }).toArray();

        for (const user of usersToWatch) {
            try {
                await client.pushMessage(user.userId, {
                    type: 'flex',
                    altText: 'こころちゃんからメッセージだよ🌸',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: `${user.displayName}さん、元気かな？🌸`, weight: 'bold', size: 'lg' },
                                { type: 'text', text: '「OKだよ」などのボタンを押して、元気なことを教えてくれると嬉しいな💖', wrap: true, size: 'sm', margin: 'md' }
                            ]
                        },
                        footer: {
                            type: 'box',
                            layout: 'horizontal',
                            contents: [
                                {
                                    type: 'button',
                                    action: {
                                        type: 'postback',
                                        label: 'OKだよ！',
                                        data: 'action=watch_check_in'
                                    },
                                    style: 'primary',
                                    color: '#FFB6C1'
                                }
                            ]
                        }
                    }
                });
                console.log(`✅ ${user.displayName} (${user.userId}) に見守りメッセージを送信しました。`);
            } catch (pushError) {
                console.error(`❌ 見守りメッセージ送信失敗 for ${user.userId}:`, pushError);
            }
        }
        console.log('✅ 見守りサービス Cron ジョブ完了。');
    } catch (dbError) {
        console.error('❌ 見守りサービス Cron ジョブでDBエラー:', dbError);
    }
});

// --- ヘルスチェックエンドポイント ---
app.get('/callback', (req, res) => {
    res.status(200).send('OK');
});

// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
    await connectToMongoDB();
});
