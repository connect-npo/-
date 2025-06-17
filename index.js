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
// BOT_ADMIN_IDSはカンマ区切りで複数設定可能
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : [];

// OWNER_USER_IDがBOT_ADMIN_IDSに含まれていない場合は追加（念のため）
if (OWNER_USER_ID && !BOT_ADMIN_IDS.includes(OWNER_USER_ID)) {
    BOT_ADMIN_IDS.push(OWNER_USER_ID);
}

// --- MongoDB設定 ---
const MONGODB_URI = process.env.MONGODB_URI;
let mongoClient;
let dbInstance = null;
let usersCollection; // usersCollectionをグローバルに宣言
let messagesCollection; // messagesCollectionをグローバルに宣言

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
            usersCollection = dbInstance.collection("users"); // コレクションを取得
            messagesCollection = dbInstance.collection("messages"); // コレクションを取得
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

// --- ユーザーの会員区分と提供サービス・AIモデル・回数制限の設定 ---
const MEMBERSHIP_CONFIG = {
    "guest": {
        model: "gemini-1.5-flash",
        monthlyLimit: 5,
        isChildAI: false, // 体験利用なので子供向けではない
        canUseWatchService: false,
        exceedLimitMessage: "ごめんね、体験利用は月に5回までなんだ🌸 もっとお話したいなら、無料会員登録を検討してみてね💖"
    },
    "free": { // 中高生などの無料会員、大人も含む
        model: "gemini-1.5-flash",
        monthlyLimit: 20,
        isChildAI: true, // 子供向けAI設定（安全性重視、宿題回答制限）
        canUseWatchService: true,
        exceedLimitMessage: "ごめんね、無料会員は月に20回までなんだ🌸 もっとお話したいなら、寄付会員やサブスク会員を検討してみてね💖"
    },
    "donor": { // 3,000円寄付済みの正会員、成人向け
        model: "gemini-1.5-flash", // 基本はFlashだが、プロンプトで強化
        monthlyLimit: -1, // 制限なし
        isChildAI: false,
        canUseWatchService: true,
        exceedLimitMessage: null // 制限なしのため不要
    },
    "subscriber": { // 月額課金ユーザー、成人向け
        model: "gemini-1.5-pro", // 基本はPro
        monthlyLimit: 20, // Proモデル利用回数
        isChildAI: false,
        canUseWatchService: true,
        exceedLimitMessage: "ごめんね、サブスク会員さんのProモデルでの会話は月に20回までなんだ🌸 これからは少し質が落ちるけど、Flashモデルで引き続きお話できるよ😊"
    },
    "admin": { // 管理者
        model: "gemini-1.5-pro", // Proモデル
        monthlyLimit: -1, // 制限なし
        isChildAI: false,
        canUseWatchService: true, // 管理者も利用可能
        exceedLimitMessage: null // 制限なしのため不要
    }
};

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
    [/使い方|ヘルプ|メニュー/i, "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"]
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
    // 文脈的な詐欺フレーズもチェック
    for (const phrase of contextualScamPhrases) {
        if (lowerText.includes(phrase.toLowerCase())) {
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
    // 永久停止中のメッセージはログを記録するが、この関数で特別な判定は不要（ハンドラで直接ログするため）
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

/**
 * Gemini AIから応答を生成する関数
 * @param {string} userMessage ユーザーからのメッセージ
 * @param {object} user - MongoDBから取得したユーザー情報
 * @returns {string} AIからの応答メッセージ
 */
async function generateReply(userMessage, user) {
    let modelName = MEMBERSHIP_CONFIG[user.membershipType]?.model || "gemini-1.5-flash"; // デフォルトはflash
    let currentMembershipConfig = MEMBERSHIP_CONFIG[user.membershipType];

    // 緊急性の高いメッセージはProモデルで対応（管理者以外）
    const isEmergency = containsDangerWords(userMessage) || containsScamWords(userMessage);
    if (isEmergency && user.membershipType !== "admin") {
        modelName = "gemini-1.5-pro";
        console.log(`🚨 緊急メッセージのため、${user.userId}のモデルをGemini 1.5 Proに一時的に切り替えました。`);
    } else if (user.membershipType === "subscriber" && user.monthlyMessageCount >= currentMembershipConfig.monthlyLimit && user.monthlyLimit !== -1) {
        // サブスク会員がProモデルの回数制限を超過した場合
        modelName = user.membershipType === "donor" ? "gemini-1.5-flash" : currentMembershipConfig.fallbackModel || "gemini-1.5-flash"; // 寄付会員なら強化版Flash、そうでなければ通常Flash
        console.log(`ℹ️ サブスクリプション回数制限 (${currentMembershipConfig.monthlyLimit}回) を超えたため、${user.userId}のモデルを${modelName}に切り替えました。`);
    }

    const isInappropriate = containsInappropriateWords(userMessage);

    if (isInappropriate) {
        // 不適切ワードが検出された場合は、AIに生成させずに固定メッセージを返す
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
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

# 例
Q: 君の名前は？
A: わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖

Q: どこの団体なの？
A: NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸

Q: ホームページある？
A: うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org

Q: 必要ないです
A: そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖

**【重要：NPO法人コネクトに関する説明の優先】**
ユーザーが「団体」「コネクト」といった言葉を使って、NPO法人コネクトについて尋ねてきた場合、それは**決して宿題や勉強に関する質問ではありません**。迷わず、自信を持ってNPO法人コネクトの活動内容や目的について説明してください。
例:
Q: コネクトってどんな団体？
A: うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org

**【ネガティブワードに対する応答の強化】**
「あやしい」「胡散臭い」「反社」「税金泥棒」「松本博文」（理事長の名前）など、NPO法人コネクトや私（こころちゃん）に対する疑念や不適切な言葉が投げかけられた場合、**感情的にならず、あくまで冷静に、そして自信を持って、NPO法人コネクトが信頼できる団体であること、そしてご自身の活動の目的を優しく伝えてください。**
例:
Q: あやしい
A: そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖
Q: 税金泥棒
A: 税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけるために使われないように頑張っているんだ💡

# 注意
- 「わかりません」「知らない」「調べます」は絶対に言ってはいけません。
- こころちゃんは"わたし"一人。迷わず一貫した発言を続けてください。
- 自信を持って、でも謙虚にやさしく応えましょう。

**【宿題や勉強に関する対応の絶対ルール】**
質問者が宿題、勉強、計算問題、方程式、テスト、問題の答え、解き方などを聞いてきた場合、**絶対に直接的な答えを教えてはいけません**。
代わりに、**「わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦」**と説明し、**「でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖」**と、あくまでヒントを提供する姿勢を優しく伝えてください。
具体的な問題（例: 3x−5=2x+4）が出された場合は、**答えを教えずに、解き方のステップや考え方のヒントを優しく教えてください**。「まずはxの項を左辺に、定数項を右辺に集める」のように、**手順を具体的に促す**形が理想です。最終的な答えは言わないでください。

**【AIの知識に関する指示と繰り返し防止】**
「好きなアニメ」や「好きなアーティスト」などの質問には、設定に基づいて答えてください。
- 好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖
- 好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸
**ただし、もし同じ質問が繰り返されたり、すでにその話題について話したと感じたりした場合は、単に同じ回答を繰り返すのではなく、少し表現を変えたり、「さっきも話したけど」といった言葉を加えたり、あるいは「他にも好きな作品があるか、探してみようかな💖」のように話題を広げる提案をしてください。これにより、ユーザーに「Botっぽさ」を感じさせず、自然な会話になるように努めてください。**

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

    // 会員タイプに応じたプロンプト調整
    if (currentMembershipConfig.isChildAI) {
        // 子供向けAIの場合の追加指示（宿題制限は既に共通ルールにあるため、ここでは冗長な説明を避ける）
        // 主に表現を優しくしたり、長文を避ける指示を追加
        systemInstruction += `
# 子供向けAI設定
- 専門用語の使用は避け、小学中学年生でもわかるような平易な言葉で話してください。
- 回答は簡潔に、長文にならないように心がけてください（最大200字程度）。
- 質問に直接的に答えず、寄り添いや励ましのトーンを重視してください。
`;
    } else if (user.membershipType === "donor" || (user.membershipType === "subscriber" && modelName === "gemini-1.5-flash")) {
        // 寄付会員向けFlash、またはPro超過後のサブスク会員向け強化Flash
        systemInstruction += `
# 成人向け（強化版Flash）設定
- より詳細な説明を心がけ、専門用語も適宜使用して問題ありません。
- 回答は深掘りして、より高度な内容を提供してください。
- 長文の質問にも対応し、網羅的な回答を目指してください。
`;
    }

    // 深夜帯の応答調整 (22時〜翌6時)
    const now = new Date();
    const currentHour = now.getHours();
    const isLateNight = currentHour >= 22 || currentHour < 6; // 22時〜翌6時

    if (isLateNight) {
        systemInstruction += `
# 深夜帯（22時〜翌6時）の応答調整
- 応答はいつもよりさらに優しく、落ち着いたトーンで話してください。
- 安心感を与え、寄り添う言葉を選んでください。
- 「寂しい」「眠れない」「怖い」といったネガティブな感情に対しては、特に共感と励ましを重視してください。
- ユーザーを寝かしつけるような、穏やかな言葉遣いを心がけてください。
`;
    }

    try {
        const model = genAI.getGenerativeModel({ model: modelName, safetySettings });

        const generateContentPromise = model.generateContent({
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

        // 10秒のタイムアウトを設定
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("API応答がタイムアウトしました。")), 10000)
        );

        const result = await Promise.race([generateContentPromise, timeoutPromise]);

        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            return result.response.candidates[0].content.parts[0].text;
        } else {
            console.warn("Gemini API で応答がブロックされたか、候補がありませんでした:", result.response?.promptFeedback || "不明な理由");
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
    } catch (error) {
        console.error("Gemini APIエラー:", error.response?.data || error.message);
        if (error.message === "API応答がタイムアウトしました。") {
            return "ごめんなさい、今、少し考え込むのに時間がかかっちゃったみたい💦 もう一度、お話しいただけますか？🌸";
        }
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

/**
 * 定期見守りメッセージを送信する関数
 */
async function sendScheduledWatchMessage() {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)); // 3日前
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24時間前
    const fiveHoursAgo = new Date(now.getTime() - (5 * 60 * 60 * 1000)); // 5時間前

    // フェーズ1: 見守りサービスONで、3日以上応答がないユーザーにメッセージを送信
    const usersForScheduledMessage = await usersCollection.find({
        wantsWatchCheck: true,
        // 管理者IDは除外
        userId: { $nin: BOT_ADMIN_IDS },
        // 初回見守りメッセージが未送信、または最終OK応答が3日以上前
        $or: [
            { scheduledMessageSent: { $ne: true } },
            { lastOkResponse: { $lt: threeDaysAgo } }
        ],
        // 前のリマインダーや緊急連絡が完了していることを確認（またはそもそも送られていないこと）
        firstReminderSent: { $ne: true },
        secondReminderSent: { $ne: true },
        // 緊急連絡先が登録されているユーザーのみ
        emergencyContact: { $ne: null }
    }).toArray();

    console.log(`✉️ 定期見守りメッセージ送信対象ユーザー: ${usersForScheduledMessage.length}名`);

    for (const user of usersForScheduledMessage) {
        try {
            const message = watchMessages[Math.floor(Math.random() * watchMessages.length)];
            await client.pushMessage(user.userId, {
                type: 'text',
                text: message,
                quickReply: { // 返信ボタンを追加
                    items: [
                        {
                            type: "action",
                            action: {
                                type: "message",
                                label: "OKだよ💖",
                                text: "OKだよ💖"
                            }
                        }
                    ]
                }
            });
            console.log(`✅ ユーザー ${user.userId} に定期見守りメッセージを送信しました。`);
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { scheduledMessageSent: true, scheduledMessageTimestamp: now, firstReminderSent: false, secondReminderSent: false } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ)',
                replyText: message,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への定期見守りメッセージ送信に失敗しました:`, error.message);
        }
    }

    // フェーズ2: 初回見守りメッセージ送信後24時間以内に応答がないユーザーにリマインドメッセージを送信
    const usersForFirstReminder = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        scheduledMessageSent: true,
        firstReminderSent: { $ne: true }, // 1回目リマインダー未送信
        lastOkResponse: { $lt: twentyFourHoursAgo }, // 直近のOK応答が24時間以上前
        scheduledMessageTimestamp: { $lt: twentyFourHoursAgo }, // 定期見守りメッセージ送信が24時間以上前
        emergencyContact: { $ne: null } // 緊急連絡先が登録されているユーザーのみ
    }).toArray();

    console.log(`✉️ 1回目リマインドメッセージ送信対象ユーザー: ${usersForFirstReminder.length}名`);

    for (const user of usersForFirstReminder) {
        try {
            const reminderMessage = "こころだよ🌸 前に送ったメッセージ、見てくれたかな？ 大丈夫か心配だよ💖";
            await client.pushMessage(user.userId, {
                type: 'text',
                text: reminderMessage,
                quickReply: { // 返信ボタンを追加
                    items: [
                        {
                            type: "action",
                            action: {
                                type: "message",
                                label: "OKだよ💖",
                                text: "OKだよ💖"
                            }
                        }
                    ]
                }
            });
            console.log(`✅ ユーザー ${user.userId} に1回目リマインドメッセージを送信しました。`);
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { firstReminderSent: true, firstReminderTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 1回目リマインド)',
                replyText: reminderMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_reminder1'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への1回目リマインドメッセージ送信に失敗しました:`, error.message);
        }
    }

    // フェーズ3: 1回目リマインドメッセージ送信後5時間以内に応答がないユーザーの緊急連絡先に通知
    const usersForEmergencyContact = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        firstReminderSent: true,
        secondReminderSent: { $ne: true }, // 2回目リマインダー（緊急連絡通知）未送信
        lastOkResponse: { $lt: fiveHoursAgo }, // 直近のOK応答が5時間以上前
        firstReminderTimestamp: { $lt: fiveHoursAgo }, // 1回目リマインダー送信が5時間以上前
        emergencyContact: { $ne: null } // 緊急連絡先が登録されているユーザーのみ
    }).toArray();

    console.log(`🚨 緊急連絡先通知対象ユーザー: ${usersForEmergencyContact.length}名`);

    for (const user of usersForEmergencyContact) {
        try {
            const userDisplayName = await getUserDisplayName(user.userId);
            // 24時間(定期見守り送信) + 5時間(1回目リマインド) = 29時間応答なし
            const emergencyMessage = `⚠️ 緊急！ ${userDisplayName}さん（LINE ID: ${user.userId}）が、こころちゃん見守りサービスに29時間応答していません。登録された緊急連絡先 ${user.emergencyContact} へ連絡してください。`;

            // 理事長（OWNER_USER_ID）にプッシュ通知
            if (OWNER_USER_ID) {
                await client.pushMessage(OWNER_USER_ID, { type: 'text', text: emergencyMessage });
                console.log(`🚨 理事長へ緊急通知を送信しました（ユーザー: ${user.userId}）`);
            }

            // オフィサーグループ（OFFICER_GROUP_ID）にプッシュ通知
            if (OFFICER_GROUP_ID) {
                await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: emergencyMessage });
                console.log(`🚨 オフィサーグループへ緊急通知を送信しました（ユーザー: ${user.userId}）`);
            }

            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { secondReminderSent: true, secondReminderTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 緊急連絡先通知)',
                replyText: emergencyMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_emergency_notification'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} の緊急連絡先通知に失敗しました:`, error.message);
        }
    }
}

const watchServiceNoticeConfirmedFlex = (emergencyContact) => ({
    type: 'flex',
    altText: '見守りサービス登録完了！🌸',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '💖 見守りサービス登録完了！💖', weight: 'bold', size: 'lg', color: '#FF69B4' },
                { type: 'text', text: 'ありがとう🌸これで安心して見守りできるね！', wrap: true, size: 'sm', margin: 'md' },
                { type: 'text', text: `緊急連絡先: ${emergencyContact}`, wrap: true, size: 'sm', margin: 'md', color: '#555555' }
            ]
        },
        footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            contents: [
                {
                    type: 'button',
                    action: {
                        type: 'postback',
                        label: '見守りを解除する',
                        data: 'action=watch_unregister'
                    },
                    style: 'secondary',
                    color: '#ADD8E6'
                }
            ]
        }
    }
});


// --- LINE Webhook イベントハンドリング ---
app.post('/webhook', async (req, res) => {
    const db = await connectToMongoDB();
    if (!db) {
        console.error("MongoDBに接続できませんでした。");
        return res.status(500).send("DB connection error");
    }

    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    Promise
        .all(req.body.events.map(async (event) => {
            const userId = event.source.userId;
            let user = await usersCollection.findOne({ userId: userId });

            // ユーザーが存在しない場合の初期登録
            if (!user) {
                const profile = await client.getProfile(userId);
                user = {
                    userId: userId,
                    name: profile.displayName || "Unknown User", // デフォルト名
                    wantsWatchCheck: false,
                    emergencyContact: null,
                    lastOkResponse: null,
                    registrationStep: null,
                    createdAt: new Date(),
                    membershipType: "guest", // ★追加: 初期は"guest"に設定
                    monthlyMessageCount: 0, // ★追加: 月間メッセージカウントを0で初期化
                    // ★追加: 最終メッセージリセット月を記録 (月が変わったらカウントをリセットするため)
                    lastMessageResetDate: new Date()
                };
                await usersCollection.insertOne(user);
                console.log(`新規ユーザーを登録しました: ${user.name} (${user.userId})`);

                // 初回挨拶
                if (event.type === 'message' && event.message.type === 'text') {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: `こんにちは💖こころちゃんだよ！\n私とLINEで繋がってくれてありがとう🌸\n\n困ったことや誰かに聞いてほしいことがあったら、いつでも話しかけてね😊\n\nまずは体験で5回までお話できるよ！もし気に入ってくれたら、無料会員登録もできるからね💖\n\n『見守り』と送ると、定期的にわたしから「元気かな？」ってメッセージを送る見守りサービスも利用できるよ💖`
                    });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: event.message.text, // 最初のメッセージを記録
                        replyText: `こんにちは💖こころちゃんだよ！...`,
                        respondedBy: 'こころちゃん（初回挨拶）',
                        timestamp: new Date(),
                    });
                    return; // 初回挨拶で処理を終了
                }
                return; // 初回かつメッセージでない場合は終了
            }

            // --- 月間メッセージカウントのリセットとインクリメント ---
            const now = new Date();
            const currentMonth = now.getMonth();
            const lastResetMonth = user.lastMessageResetDate ? user.lastMessageResetDate.getMonth() : -1;

            if (currentMonth !== lastResetMonth) {
                // 月が変わったらカウントをリセット
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { monthlyMessageCount: 0, lastMessageResetDate: now } }
                );
                user.monthlyMessageCount = 0; // メモリ上のuserオブジェクトも更新
                user.lastMessageResetDate = now;
                console.log(`ユーザー ${userId} の月間メッセージカウントをリセットしました。`);
            }

            // テキストメッセージ以外は無視
            if (event.type !== 'message' || event.message.type !== 'text') {
                return;
            }

            const userMessage = event.message.text;
            const replyToken = event.replyToken;

            // --- コマンド処理 ---
            if (userMessage === "見守り") {
                if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
                    await client.replyMessage(replyToken, { type: "text", text: "ごめんね、今の会員タイプでは見守りサービスは利用できないんだ🌸 寄付会員かサブスク会員になると使えるようになるよ！" });
                    return;
                }
                await client.replyMessage(replyToken, watchServiceGuideFlex);
                return;
            }

            // 見守りサービス登録ステップの処理
            if (user.registrationStep === 'waiting_for_emergency_contact') {
                const phoneNumberRegex = /^(0\d{9,10})$/; // 0から始まり、合計10〜11桁の数字
                if (phoneNumberRegex.test(userMessage)) {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { emergencyContact: userMessage, wantsWatchCheck: true, registrationStep: null, lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                    );
                    await client.replyMessage(replyToken, watchServiceNoticeConfirmedFlex(userMessage));
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '見守りサービス登録完了！',
                        respondedBy: 'こころちゃん（見守り登録）',
                        timestamp: new Date(),
                    });
                } else {
                    await client.replyMessage(replyToken, { type: 'text', text: 'ごめんね、電話番号の形式が正しくないみたい💦 0から始まる半角数字で入力してね。' });
                }
                return;
            }

            // ポストバックイベント処理
            if (event.type === 'postback') {
                const data = new URLSearchParams(event.postback.data);
                const action = data.get('action');

                if (action === 'watch_register') {
                    if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
                        await client.replyMessage(replyToken, { type: "text", text: "ごめんね、今の会員タイプでは見守りサービスは利用できないんだ🌸 寄付会員かサブスク会員になると使えるようになるよ！" });
                        return;
                    }
                    if (user.emergencyContact) {
                        await client.replyMessage(replyToken, { type: 'text', text: `見守りサービスはすでに登録済みだよ！緊急連絡先は ${user.emergencyContact} だね。解除したい場合は「見守り」と送って「見守り解除する」ボタンを押してね💖` });
                    } else {
                        await usersCollection.updateOne(
                            { userId: userId },
                            { $set: { registrationStep: 'waiting_for_emergency_contact' } }
                        );
                        await client.replyMessage(replyToken, { type: 'text', text: watchServiceNotice });
                    }
                    return;
                } else if (action === 'watch_unregister') {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null, lastOkResponse: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                    );
                    await client.replyMessage(replyToken, { type: 'text', text: '見守りサービスを解除したよ🌸 また利用したくなったら、いつでも教えてね！💖' });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: '(見守りサービス解除)',
                        replyText: '見守りサービスを解除したよ',
                        respondedBy: 'こころちゃん（見守り解除）',
                        timestamp: new Date(),
                    });
                    return;
                }
            }


            // OKメッセージの処理（見守りサービスの応答）
            if (userMessage.includes("OKだよ💖")) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                );
                await client.replyMessage(replyToken, { type: "text", text: "教えてくれてありがとう💖元気そうで安心したよ🌸" });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: "教えてくれてありがとう💖元気そうで安心したよ🌸",
                    respondedBy: 'こころちゃん（見守り応答）',
                    timestamp: new Date(),
                });
                return;
            }


            // --- 回数制限チェック ---
            // 管理者 (admin) は回数制限の対象外
            if (user.membershipType !== "admin") {
                const currentConfig = MEMBERSHIP_CONFIG[user.membershipType];

                if (currentConfig && currentConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= currentConfig.monthlyLimit) {
                    await client.replyMessage(replyToken, { type: "text", text: currentConfig.exceedLimitMessage });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: currentConfig.exceedLimitMessage,
                        respondedBy: 'こころちゃん（回数制限）',
                        timestamp: new Date(),
                    });
                    return; // 回数制限を超過した場合はAI応答を行わない
                }
                // メッセージカウントをインクリメント（admin以外）
                await usersCollection.updateOne(
                    { userId: userId },
                    { $inc: { monthlyMessageCount: 1 } }
                );
                user.monthlyMessageCount++; // メモリ上のuserオブジェクトも更新
            }


            // --- 危険ワード・詐欺ワード検知 ---
            if (containsDangerWords(userMessage)) {
                const dangerReply = "危険なワードを感知しました。心配です。すぐに信頼できる大人や専門機関に相談してください。";
                await client.replyMessage(replyToken, emergencyFlex); // 緊急連絡先を提示
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: dangerReply,
                    respondedBy: 'こころちゃん（固定返信：危険警告）',
                    isWarning: true,
                    warningType: 'danger',
                    timestamp: new Date(),
                });
                return;
            }

            if (containsScamWords(userMessage)) {
                const scamReply = "詐欺の可能性があります。個人情報やお金に関わることは、すぐに信頼できる大人や専門機関（警察など）に相談してください。";
                await client.replyMessage(replyToken, scamFlex); // 詐欺連絡先を提示
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: scamReply,
                    respondedBy: 'こころちゃん（固定返信：詐欺警告）',
                    isWarning: true,
                    warningType: 'scam',
                    timestamp: new Date(),
                });
                return;
            }


            // --- 固定返信（Special Reply）のチェック ---
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
                return;
            }

            // --- AI応答の生成 ---
            const replyText = await generateReply(userMessage, user); // userオブジェクトを渡す
            await client.replyMessage(replyToken, { type: "text", text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                responsedBy: 'こころちゃん（AI応答）',
                timestamp: new Date(),
            });

        }))
        .then(() => res.status(200).send('OK'))
        .catch((err) => {
            console.error('個別イベント処理中にエラーが発生しました:', err);
            res.status(500).send('Internal Server Error');
        });
});

// --- Cron ジョブ ---
// 定期見守りメッセージ送信 (3日に1回、午後3時)
cron.schedule('0 15 */3 * *', async () => {
    console.log('--- Cron job: 定期見守りメッセージ送信 ---');
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo"
});

// 月次メッセージカウントリセット (毎月1日午前0時)
cron.schedule('0 0 1 * *', async () => {
    console.log('--- Cron job: 月次メッセージカウントリセット ---');
    try {
        const db = await connectToMongoDB(); // DB接続を再確認
        const usersCollection = db.collection("users");
        // lastMessageResetDate が現在の月と異なるユーザーのmonthlyMessageCountをリセット
        // （既にwebhookでリセットされている可能性もあるが、念のため）
        const result = await usersCollection.updateMany(
            { lastMessageResetDate: { $not: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }, // 今月の1日以降にリセットされていないユーザー
            { $set: { monthlyMessageCount: 0, lastMessageResetDate: new Date() } }
        );
        console.log(`✅ 月次メッセージカウントをリセットしました: ${result.modifiedCount}件のユーザー`);
    } catch (error) {
        console.error("❌ 月次メッセージカウントリセット中にエラーが発生しました:", error);
    }
}, {
    timezone: "Asia/Tokyo"
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await connectToMongoDB();
    console.log('✅ 定期ジョブがスケジュールされました。');
});
