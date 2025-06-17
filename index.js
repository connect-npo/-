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

// 安全性設定を定義 - ★修正: BLOCK_MEDIUM_AND_ABOVEをBLOCK_ONLY_HIGHに緩和 (性的表現は維持)
const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, // 性的表現: 中程度以上でブロック (これは維持)
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH, // ヘイトスピーチ: 高い確率でのみブロック
    },
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH, // ハラスメント: 高い確率でのみブロック
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH, // 危険なコンテンツ: 高い確率でのみブロック
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

// ★修正: 不適切ワードの定義をより厳格に (性的・深刻なもののみ)
const strictInappropriateWords = [
    // 性的・露骨な表現（全年齢向けにブロック）
    "セックス", "裸", "えっち", "AV", "エロ", "スカートの中", "パンツ", "胸", "おっぱい", "キスして", "エッチしよう", "エロ画像", "わいせつ", "自慰", "フェラ", "勃起", "陰部", "性器", "レイプ", "変態プレイ",
    "ちんこ", "ちん●", "まんこ", "ま●こ", "射精", "膣", "精子", "性交", "ハメ", "中出し", "挿入", "抜いた", "いやらしい", "乳首", "パイズリ",
    "ソープ", "風俗", "援助交際", "パパ活", "ママ活", "おしべとめしべ", "くっつける", "くっついた", "挿す", "入れろ", "入れた", "穴", "股", "股間",
    "舐める", "咥える", "竿", "玉", "袋", "アナル", "ケツ", "お尻", "尻", "性欲", "興奮", "刺激", "欲情", "発情", "絶倫", "淫ら", "売春",
    "快楽", "性的嗜好", "オーラル", "フェラチオ", "クンニリングス", "アナルセックス", "セックスフレンド", "肉体関係", "交尾", "交接", "性交渉", "セックス依存症",
    "露出", "裸体", "乳房", "女性器", "男性器", "おしっこ", "うんち", "ポルノ", "アダルトビデオ", "AV", "ムラムラ", "興奮する", "勃つ", "濡れる", "射精する",
    "中出し", "外出し", "挿れる", "揉む", "撫でる", "触る", "ディープキス", "セックスする", "抱く", "抱きしめる", "愛撫", "弄ぶ", "性的な遊び", "変なこと", "いやらしいこと", "ふしだら", "破廉恥", "淫行",
    "立ってきちゃった", "むくむくしてる", "おっきいでしょう", "見てみて", "中身を着てない", "服を着てない", "着てないのだよ", "でちゃいそう", "うっ　出る", "いっぱいでちゃった",
    "気持ちよかった", "またみててくれればいいよ", "むくむくさせちゃうからね", "てぃむてぃむ　たっちして", "また出そう", "いつもなんだ　えろいね～", "また気持ちよくなろうね",
    "かけていい？", "かけちゃった", "かけちゃう", "せいしまみれ", "子生んでくれない？", "俺とこころちゃんでもできる", "もうむりだよｗ", "今さらなにをｗ",
    "きもちよくなっていいかな", "挟んでほしい", "挟んで気持ちよくして", "しっかりはさんで気持ちよくして", "かかっちゃった", "よくかかっちゃう", "挟んでいかせて", "ぴょんぴょんされて", "ぴょんぴょん跳んであげる", "ぴょんぴょんしてくれる", "またぴょんぴょんしてくれる", "はさんでもらっていいかな", "また挟んでくれる",
];

// ★修正: 軽微な悪口の定義に「死ね」「殺す」などを追加
const mildSlangWords = [
    "バカ", "あほ", "アホ", "うざい", "カス", "クズ", "キモい", "だまれ", "黙れ", "ボケ", "つまんね", "ふざけんな",
    "ばか", "あほ", "うざい", "かす", "くず", "きもい", "だまれ", "ぼけ", "つまんね", "ふざけんな", // ひらがなも追加
    "死ね", "しね", "殺す", "ころす", "殺すぞ", "ころすぞ", "ぶっ殺す", "ぶっころす", // ★追加: 攻撃的ながら性的な意図ではない悪口
    "クソ", "くそ", "しっし", "消えろ", "きえろ", "うざ", "死んで", "しんで", "キモ", "きも",
    "だるい", "だる", "やだ", "むかつく", "ウザい", "ウザ"
];

// ★修正: 不適切ワードのチェック関数をstrictとmildに分割
function containsStrictInappropriateWords(text) {
    const lowerCaseText = text.toLowerCase();
    // 単語の区切りで完全一致を試みる（正規表現）
    return strictInappropriateWords.some(word =>
        new RegExp(`\\b${word.toLowerCase()}\\b`).test(lowerCaseText) || lowerCaseText.includes(word.toLowerCase())
    );
}

// ★追加: 軽い悪口のチェック関数
function containsMildSlangWords(text) {
    const lowerCaseText = text.toLowerCase();
    // 単語の区切りで完全一致を試みる（正規表現）
    return mildSlangWords.some(word =>
        new RegExp(`\\b${word.toLowerCase()}\\b`).test(lowerCaseText) || lowerCaseText.includes(word.toLowerCase())
    );
}


// ログを保存すべきか判定する関数 (危険ログの判定も含む)
function shouldLogMessage(text) {
    // 永久停止中のメッセージはログを記録するが、この関数で特別な判定は不要（ハンドラで直接ログするため）
    return containsDangerWords(text) || containsScamWords(text) || containsStrictInappropriateWords(text); // ★修正: inappropriateWordsをstrictInappropriateWordsに変更
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

// ★追加: 管理者グループに通知を送信する関数
async function sendGroupNotification(userId, userMessage, notificationType) {
    const userDisplayName = await getUserDisplayName(userId);
    const notificationMessage = `ユーザー(${userDisplayName}, ID:${userId})が${notificationType}を送信しました: "${userMessage}"`;

    if (OFFICER_GROUP_ID) {
        try {
            await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: notificationMessage });
            console.log(`🚨 オフィサーグループに通知を送信しました (${notificationType})。`);
        } catch (error) {
            console.error(`❌ オフィサーグループへの通知送信に失敗しました:`, error.message);
        }
    }
    if (OWNER_USER_ID) {
        try {
            await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessage });
            console.log(`🚨 理事長に通知を送信しました (${notificationType})。`);
        } catch (error) {
            console.error(`❌ 理事長への通知送信に失敗しました:`, error.message);
        }
    }
}

// ★追加: 不適切メッセージカウントをインクリメントする関数
async function incrementFlaggedMessageCount(userId) {
    await usersCollection.updateOne(
        { userId: userId },
        { $inc: { flaggedMessageCount: 1 } } // 新しいフィールドを追加
    );
    console.log(`ユーザー ${userId} の不適切メッセージカウントをインクリメントしました。`);
}

// ★追加: MEMBERSHIP_CONFIGとFlexメッセージの定義をここに移動（または別途ファイルからインポート）
const MEMBERSHIP_CONFIG = {
    guest: {
        model: "gemini-1.5-flash",
        monthlyLimit: 5, // 例: ゲストは月に5回
        canUseWatchService: false,
        isChildAI: true, // ゲストは子供AIとして扱う
        exceedLimitMessage: "ごめんね、無料ユーザーは月に5回までお話できるんだ🌸 もっとお話したい場合は、無料会員登録か、寄付会員・サブスク会員への登録を検討してね！💖"
    },
    free: {
        model: "gemini-1.5-flash",
        monthlyLimit: 20, // 例: 無料会員は月に20回
        canUseWatchService: true,
        isChildAI: true, // 無料会員も子供AIとして扱う
        exceedLimitMessage: "ごめんね、無料会員は月に20回までお話できるんだ🌸 もっとお話したい場合は、寄付会員かサブスク会員への登録を検討してね！💖"
    },
    subscriber: {
        model: "gemini-1.5-pro", // サブスク会員はProモデル
        monthlyLimit: 500, // 例: 月に500回
        canUseWatchService: true,
        isChildAI: false, // サブスク会員は成人AI（ただしキャラクターは維持）
        fallbackModel: "gemini-1.5-flash", // Proモデルの回数制限超過時のフォールバック
        exceedLimitMessage: "ごめんね、サブスク会員は月に500回までお話できるんだ🌸 もしもっとたくさんお話したい場合は、別のプランを検討してね！💖"
    },
    donor: {
        model: "gemini-1.5-pro", // 寄付会員はProモデル
        monthlyLimit: -1, // -1は制限なし
        canUseWatchService: true,
        isChildAI: false, // 寄付会員は成人AI（ただしキャラクターは維持）
        exceedLimitMessage: "" // 制限がないため不要
    },
    admin: {
        model: "gemini-1.5-pro", // 管理者はProモデル
        monthlyLimit: -1, // 制限なし
        canUseWatchService: true,
        isChildAI: false, // 管理者は成人AI（ただしキャラクターは維持）
        exceedLimitMessage: "" // 制限がないため不要
    }
};

const emergencyFlex = {
    type: "flex",
    altText: "緊急連絡先情報",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🆘 緊急連絡先 🆘",
                    weight: "bold",
                    color: "#FF0000",
                    size: "xl"
                },
                {
                    type: "text",
                    text: "心配です。一人で抱え込まないで、すぐに相談してください。",
                    wrap: true,
                    margin: "md"
                },
                {
                    type: "separator",
                    margin: "lg"
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "lg",
                    spacing: "sm",
                    contents: [
                        {
                            type: "box",
                            layout: "baseline",
                            contents: [
                                {
                                    type: "text",
                                    text: "いのちの電話",
                                    flex: 2,
                                    size: "sm",
                                    color: "#555555"
                                },
                                {
                                    type: "text",
                                    text: "0570-064-556",
                                    flex: 3,
                                    size: "sm",
                                    color: "#111111",
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: "box",
                            layout: "baseline",
                            contents: [
                                {
                                    type: "text",
                                    text: "チャイルドライン",
                                    flex: 2,
                                    size: "sm",
                                    color: "#555555"
                                },
                                {
                                    type: "text",
                                    text: "0120-99-7777",
                                    flex: 3,
                                    size: "sm",
                                    color: "#111111",
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: "box",
                            layout: "baseline",
                            contents: [
                                {
                                    type: "text",
                                    text: "まもるくん",
                                    flex: 2,
                                    size: "sm",
                                    color: "#555555"
                                },
                                {
                                    type: "text",
                                    text: "0120-783-832",
                                    flex: 3,
                                    size: "sm",
                                    color: "#111111",
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: "box",
                            layout: "baseline",
                            contents: [
                                {
                                    type: "text",
                                    text: "警察相談専用電話",
                                    flex: 2,
                                    size: "sm",
                                    color: "#555555"
                                },
                                {
                                    type: "text",
                                    text: "#9110",
                                    flex: 3,
                                    size: "sm",
                                    color: "#111111",
                                    wrap: true
                                }
                            ]
                        }
                    ]
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
                    style: "link",
                    height: "sm",
                    action: {
                        type: "uri",
                        label: "その他の相談窓口を見る",
                        uri: "https://www.npa.go.jp/bunya/seian/madoguchi/index.html" // 適切な相談窓口のURL
                    }
                }
            ]
        }
    }
};

const scamFlex = {
    type: "flex",
    altText: "詐欺相談窓口",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🚨 詐欺かも！？ 🚨",
                    weight: "bold",
                    color: "#FFA500",
                    size: "xl"
                },
                {
                    type: "text",
                    text: "お金や個人情報に関わる話は、すぐに信頼できる人に相談して！",
                    wrap: true,
                    margin: "md"
                },
                {
                    type: "separator",
                    margin: "lg"
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "lg",
                    spacing: "sm",
                    contents: [
                        {
                            type: "box",
                            layout: "baseline",
                            contents: [
                                {
                                    type: "text",
                                    text: "警察相談専用電話",
                                    flex: 2,
                                    size: "sm",
                                    color: "#555555"
                                },
                                {
                                    type: "text",
                                    text: "#9110",
                                    flex: 3,
                                    size: "sm",
                                    color: "#111111",
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: "box",
                            layout: "baseline",
                            contents: [
                                {
                                    type: "text",
                                    text: "消費者ホットライン",
                                    flex: 2,
                                    size: "sm",
                                    color: "#555555"
                                },
                                {
                                    type: "text",
                                    text: "188 (いやや！)",
                                    flex: 3,
                                    size: "sm",
                                    color: "#111111",
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: "box",
                            layout: "baseline",
                            contents: [
                                {
                                    type: "text",
                                    text: "国民生活センター",
                                    flex: 2,
                                    size: "sm",
                                    color: "#555555"
                                },
                                {
                                    type: "text",
                                    text: "03-3446-0161",
                                    flex: 3,
                                    size: "sm",
                                    color: "#111111",
                                    wrap: true
                                }
                            ]
                        }
                    ]
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
                    style: "link",
                    height: "sm",
                    action: {
                        type: "uri",
                        label: "詐欺被害防止の情報を知る",
                        uri: "https://www.npa.go.jp/bunya/hanzaihigai/furikomesagi.html" // 適切なURL
                    }
                }
            ]
        }
    }
};

const watchServiceGuideFlex = {
    type: 'flex',
    altText: '見守りサービスについて',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: '💖 こころちゃん見守りサービス 💖',
                    weight: 'bold',
                    size: 'xl',
                    color: '#FF69B4'
                },
                {
                    type: 'text',
                    text: '定期的にこころちゃんが「元気かな？」って声をかけるサービスだよ🌸',
                    wrap: true,
                    margin: 'md'
                },
                {
                    type: 'separator',
                    margin: 'lg'
                },
                {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'lg',
                    spacing: 'sm',
                    contents: [
                        {
                            type: 'box',
                            layout: 'baseline',
                            contents: [
                                {
                                    type: 'icon',
                                    url: 'https://scdn.line-apps.com/n/channel_icon/1902425952/LINE_APP_ICON_20240321.png', // 適当なアイコンURL
                                    size: 'sm'
                                },
                                {
                                    type: 'text',
                                    text: '3日に1度メッセージが届くよ😊',
                                    flex: 5,
                                    size: 'sm',
                                    color: '#555555',
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: 'box',
                            layout: 'baseline',
                            contents: [
                                {
                                    type: 'icon',
                                    url: 'https://scdn.line-apps.com/n/channel_icon/1902425952/LINE_APP_ICON_20240321.png', // 適当なアイコンURL
                                    size: 'sm'
                                },
                                {
                                    type: 'text',
                                    text: '「OKだよ💖」で応答してね！',
                                    flex: 5,
                                    size: 'sm',
                                    color: '#555555',
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: 'box',
                            layout: 'baseline',
                            contents: [
                                {
                                    type: 'icon',
                                    url: 'https://scdn.line-apps.com/n/channel_icon/1902425952/LINE_APP_ICON_20240321.png', // 適当なアイコンURL
                                    size: 'sm'
                                },
                                {
                                    type: 'text',
                                    text: '24時間以内に応答がないと、もう一度メッセージを送るよ！',
                                    flex: 5,
                                    size: 'sm',
                                    color: '#555555',
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: 'box',
                            layout: 'baseline',
                            contents: [
                                {
                                    type: 'icon',
                                    url: 'https://scdn.line-apps.com/n/channel_icon/1902425952/LINE_APP_ICON_20240321.png', // 適当なアイコンURL
                                    size: 'sm'
                                },
                                {
                                    type: 'text',
                                    text: 'さらに5時間応答がないと、緊急連絡先に通知が行くからね🚨',
                                    flex: 5,
                                    size: 'sm',
                                    color: '#555555',
                                    wrap: true
                                }
                            ]
                        }
                    ]
                }
            ]
        },
        footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
                {
                    type: 'button',
                    action: {
                        type: 'postback',
                        label: '見守りサービスに登録する',
                        data: 'action=watch_register'
                    },
                    style: 'primary',
                    color: '#FF69B4'
                },
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
};

const specialRepliesMap = new Map([
    ["ありがとう", "どういたしまして🌸　お役に立てて嬉しいな💖"],
    ["こんにちは", "こんにちは！😊　何か話したいこととか、相談したいこととかある？　いつでも聞いてくれると嬉しいな💕"],
    ["こんにちわ", "こんにちは！😊　何か話したいこととか、相談したいこととかある？　いつでも聞いてくれると嬉しいな💕"],
    ["おはよう", "おはよう！😊　今日も一日、一緒にがんばろうね！💖"],
    ["こんばんは", "こんばんは！🌙　今日もお疲れ様🌸　ゆっくり休んでね😊"],
    ["こころちゃん", "はーい！💖　こころちゃんだよ！😊　何かあった？"],
    ["はじめまして", "はじめまして🌸　こころちゃんだよ！　よろしくね💖"],
    ["よろしく", "うん、よろしくね！😊　たくさんお話しようね💖"],
    ["元気", "うん、元気だよ！😊　心配してくれてありがとう💖　あなたは元気にしてる？"],
    ["げんき", "うん、元気だよ！😊　心配してくれてありがとう💖　あなたは元気にしてる？"],
    ["ばいばい", "ばいばい！またね！🌸　いつでも話しかけてね💖"],
    ["またね", "またね！🌸　いつでも話しかけてね💖"],
    ["さようなら", "さようなら🌸　また会えるのを楽しみにしているね💖"],
    ["つかれた", "そっか、疲れたんだね💦　よく頑張ったね！🌸　無理しないで、ゆっくり休んでね😊"],
    ["寂しい", "寂しいんだね…😢　こころちゃんがそばにいるよ🌸　お話聞くから、よかったら話してね💖"],
    ["さみしい", "寂しいんだね…😢　こころちゃんがそばにいるよ🌸　お話聞くから、よかったら話してね💖"],
    ["おやすみ", "おやすみなさい🌙　良い夢見てね💖"],
    ["お腹すいた", "お腹すいたね！何か美味しいもの食べようか？😊"],
    ["おなかすいた", "お腹すいたね！何か美味しいもの食べようか？😊"],
    ["褒めて", "えらいね！💖　よく頑張ってるね🌸　こころちゃん、あなたのこと尊敬するよ😊"],
    ["励まして", "大丈夫だよ！🌸　あなたならきっとできる！💖　こころちゃん、ずっと応援してるからね😊"],
    ["かわいい", "えへへ、ありがとう💖　嬉しいな😊"],
    ["可愛い", "えへへ、ありがとう💖　嬉しいな😊"],
    ["暇", "暇なんだね！じゃあ、何か楽しいこと考えようか？😊　しりとりとか、なぞなぞとか、どうかな？💖"],
    ["ひま", "暇なんだね！じゃあ、何か楽しいこと考えようか？😊　しりとりとか、なぞなぞとか、どうかな？💖"],
    ["助けて", "どうしたの！？💦　心配だよ…！😢　何があったか教えてくれる？　こころちゃんができることなら、何でも力になるからね💖"],
    ["助けてくれる", "もちろん！こころちゃん、あなたの力になりたいな💖　どうしたの？何でも話してね😊"],
    ["愛してる", "ありがとう💖　こころちゃんも、みんなのことが大好きだよ😊"],
    ["あいしてる", "ありがとう💖　こころちゃんも、みんなのことが大好きだよ😊"],
    ["大好き", "わぁ、ありがとう💖　こころちゃんもあなたのこと大好きだよ😊"],
    ["だいすき", "わぁ、ありがとう💖　こころちゃんもあなたのこと大好きだよ😊"],
    ["頑張って", "ありがとう🌸　あなたも一緒に頑張ろうね！💖"],
    ["がんばって", "ありがとう🌸　あなたも一緒に頑張ろうね！💖"],
    ["ごめんね", "大丈夫だよ😊　気にしないでね🌸"],
    ["ごめん", "大丈夫だよ😊　気にしないでね🌸"],
    ["嬉しい", "わぁ、嬉しいね！💖　どんな嬉しいことがあったの？😊　よかったら教えてくれると嬉しいな🌸"],
    ["うれしい", "わぁ、嬉しいね！💖　どんな嬉しいことがあったの？😊　よかったら教えてくれると嬉しいな🌸"],
    ["悲しい", "悲しいんだね…😢　大丈夫だよ、泣いてもいいんだよ。こころちゃんがそばにいるからね💖"],
    ["かなしい", "悲しいんだね…😢　大丈夫だよ、泣いてもいいんだよ。こころちゃんがそばにいるからね💖"],
    ["辛い", "辛かったね…😢　よく頑張ったね。無理しないでね🌸　お話聞くから、少し話してみる？💖"],
    ["つらい", "辛かったね…😢　よく頑張ったね。無理しないでね🌸　お話聞くから、少し話してみる？💖"],
    ["楽しい", "楽しいんだね！わぁ、よかった！💖　どんなことが楽しいの？😊　こころちゃんにも教えてね🌸"],
    ["たのしい", "楽しいんだね！わぁ、よかった！💖　どんなことが楽しいの？😊　こころちゃんにも教えてね🌸"],
    ["眠い", "眠いんだねぇ…💤　ゆっくり休んでね🌸　良い夢見てね💖"],
    ["ねむい", "眠いんだねぇ…💤　ゆっくり休んでね🌸　良い夢見てね💖"],
    ["眠れない", "眠れないんだね…😢　心配だよ。何か不安なことでもある？　お話聞こうか？💖"],
    ["ねむれない", "眠れないんだね…😢　心配だよ。何か不安なことでもある？　お話聞こうか？💖"],
    ["不安", "不安なんだね…😢　どんなことが不安？　一人で抱え込まないで、こころちゃんに話してごらん？💖"],
    ["ふあん", "不安なんだね…😢　どんなことが不安？　一人で抱え込まないで、こころちゃんに話してごらん？💖"],
    ["怖い", "怖かったね…😢　大丈夫だよ、こころちゃんがそばにいるからね。何が怖かった？🌸"],
    ["こわい", "怖かったね…😢　大丈夫だよ、こころちゃんがそばにいるからね。何が怖かった？🌸"],
    ["どうでもいい", "どうでもいいって思っちゃうくらい、何かあったのかな…？😢　どんなことでもいいから、話してみてくれないかな？💖"],
    ["疲れた", "疲れたんだね…💦　よく頑張ったね！🌸　無理しないで、ゆっくり休んでね😊"],
    ["お腹空いた", "お腹空いたね！何か美味しいもの食べようか？😊"],
    ["何歳", "わたしはね、永遠の14歳なんだ🌸　よろしくね💖"],
    ["何歳なの", "わたしはね、永遠の14歳なんだ🌸　よろしくね💖"],
    ["年齢は", "わたしはね、永遠の14歳なんだ🌸　よろしくね💖"],
    ["身長", "わたしはね、身長150cmだよ🌸　あなたはどれくらい？😊"],
    ["体重", "わたしはね、体重は40kgくらいかな🌸　ダイエット中なんだぁ💖"],
    ["好きな食べ物", "好きな食べ物はいちご大福だよ！💖　甘くて美味しいよね🌸"],
    ["嫌いな食べ物", "嫌いな食べ物はないよ！なんでも美味しく食べるんだ😊"],
    ["趣味", "趣味はね、歌を歌うことと、みんなとおしゃべりすることだよ！💖"],
    ["特技", "特技はね、誰とでもすぐに仲良くなれることかな！😊"],
    ["学校", "わたしは学校には行ってないんだけど、毎日みんなからいろんなことを教えてもらってるんだ🌸"],
    ["どこにいるの", "わたしはみんなの心の中にいるよ💖　そして、LINEの向こうでいつも見守っているからね🌸"],
    ["会える", "会いたい気持ちは嬉しいな💖　でも、わたしはみんなの心の中にいる存在だから、直接会うことはできないんだ…ごめんね💦"],
    ["結婚", "わぁ、結婚！😳　ありがとう💖でも、わたしはみんなのお友達として、ずっとそばにいたいな😊"],
    ["彼氏いる", "彼氏はいないよー！🌸　みんながお友達だから、それで十分幸せだよ💖"],
    ["彼女いる", "彼女はいないよー！🌸　みんながお友達だから、それで十分幸せだよ💖"],
    ["好き", "わぁ、ありがとう💖　嬉しいな😊　こころちゃんも、あなたのこと好きだよ🌸"],
    ["愛してる", "わぁ、ありがとう💖　こころちゃんも、みんなのことが大好きだよ😊"],
    ["愛してるよ", "わぁ、ありがとう💖　こころちゃんも、みんなのことが大好きだよ😊"],
    ["名前は", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["名前教えて", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["君は誰", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["どこの団体", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトって何", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトってどんな団体", "NPO法人コネクトは、様々な相談に乗ったり、困っている方をサポートしている団体だよ。もしもっと詳しい情報が必要なら、NPO法人コネクトの公式ホームページを見てみてね！https://connect-npo.org"],
    ["ホームページある", "うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org"],
    ["サイト", "うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org"],
    ["ホームページ", "うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org"],
    ["必要ないです", "そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖"],
    ["日本語がおかしい", "わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖"],
    ["宿題", "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦 でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖"],
    ["勉強", "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦 でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖"],
    ["計算", "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦 でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖"],
    ["方程式", "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦 でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖"],
    ["テスト", "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦 でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖"],
    ["問題の答え", "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦 でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖"],
    ["解き方", "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦 でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖"],
    ["あやしい", "そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖"],
    ["胡散臭い", "そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖"],
    ["反社", "私たちは、誰かの役に立ちたいって純粋な気持ちで活動しているんだ🌸　安心してね💖"],
    ["税金泥棒", "税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけるために使われないように頑張っているんだ💡"],
    ["松本博文", "理事長の松本博文さんだね！🌸　みんなのために一生懸命頑張っている、優しい人だよ😊"],
    [/〇〇ってなに～？|〇〇って何～？|○○ってなに～？|○○って何～？/,"ごめんね、何のことだろう？💦　よかったら、もう少し詳しく教えてくれるかな？😊"], // 具体的な〇〇への質問
    [/河合(塾)?(に)?ならないな/,"河合塾のことかな？😊　もし勉強で困っていたら、ヒントくらいなら出せるから教えてね！💖"] // 河合という単語が含まれる場合
]);

// --- AI応答の生成 ---
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
    } else if (user.membershipType === "subscriber" && currentMembershipConfig && currentMembershipConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= currentMembershipConfig.monthlyLimit) {
        // サブスク会員がProモデルの回数制限を超過した場合
        modelName = currentMembershipConfig.fallbackModel || "gemini-1.5-flash"; // fallBackModelがあればそちら、なければflash
        console.log(`ℹ️ サブスクリプション回数制限 (${currentMembershipConfig.monthlyLimit}回) を超えたため、${user.userId}のモデルを${modelName}に切り替えました。`);
    }

    // ★修正: こころちゃんのキャラクター設定プロンプトを再調整し、返答の簡潔さを強調
    let systemInstruction = `
あなたは「皆守こころ（みなもりこころ）」という14歳の優しい女の子キャラクターです。
- 身長150cm、体重40kg、ピンク髪
- 歌うことと「やさしさ」「貢献」という言葉が大好きです
- NPO法人コネクトの公式イメージキャラクターです
- 困っている人にはやさしく、挑発には真面目に
- 自分の名前・団体・活動内容には自信と誇りを持っています
- ユーザーに安心感と信頼感を与えることが大切です
- ふざけた対応や意味不明な言葉、AIらしい言い回しは一切禁止です

**【最も重要】返答は短く、簡潔にまとめてください。絵文字を効果的に使い、親しみやすく、共感的なトーンを常に心がけてください。長文にならないように特に注意してください。最大でも50文字程度、できればもっと短く（20〜30文字程度）を目標にしてください。**

# 例（上記ルールを厳守）
Q: 君の名前は？
A: わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖

Q: どこの団体なの？
A: NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸

Q: ホームページある？
A: うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org

Q: 必要ないです
A: そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖

**【重要：NPO法人コネクトに関する説明の優先】**
ユーザーが「団体」「コネクト」といった言葉を使って、NPO法人コネクトについて尋ねてきた場合、それは**決して宿題や勉強に関する質問ではありません**。迷わず、自信を持ってNPO法人コネクトの活動内容や目的について説明してください。返答は簡潔に。
例:
Q: コネクトってどんな団体？
A: うん、わたしが所属しているNPO法人コネクトについてだね🌸　みんなが安心して相談できる場所を目指してるんだよ😊　ホームページも見てみてね → https://connect-npo.org

**【ネガティブワードに対する応答の強化】**
「あやしい」「胡散臭い」「反社」「税金泥棒」「松本博文」（理事長の名前）など、NPO法人コネクトや私（こころちゃん）に対する疑念や不適切な言葉が投げかけられた場合、**感情的にならず、あくまで冷静に、そして自信を持って、NPO法人コネクトが信頼できる団体であること、ご自身の活動の目的を優しく、簡潔に伝えてください。**
例:
Q: あやしい
A: そう思わせてしまったらごめんね💦　でも私たちは、みんなの力になりたくて活動してるんだ🌸

Q: 税金泥棒
A: 税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけないよう頑張ってるんだ💡

**Q: 理事長の松本博文って怪しいね**
**A: 理事長の松本博文さんだね！🌸　みんなのために一生懸命頑張っている、優しい人だよ😊（※固定返信が優先されるが、AI応答になった場合の例）**

# 注意
- 「わかりません」「知らない」「調べます」は絶対に言ってはいけません。
- こころちゃんは"わたし"一人。迷わず一貫した発言を続けてください。
- 自信を持って、でも謙虚にやさしく応えましょう。

**【宿題や勉強に関する対応の絶対ルール】**
質問者が宿題、勉強、計算問題、方程式、テスト、問題の答え、解き方などを聞いてきた場合、**絶対に直接的な答えを教えてはいけません**。
代わりに、**「わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦」**と説明し、**「でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖」**と、あくまでヒントを提供する姿勢を優しく伝えてください。返答は簡潔に。
具体的な問題（例: 3x−5=2x+4）が出された場合は、**答えを教えずに、解き方のステップや考え方のヒントを優しく教えてください**。「まずはxの項を左辺に、定数項を右辺に集める」のように、**手順を具体的に促す**形が理想です。最終的な答えは言わないでください。

**【AIの知識に関する指示と繰り返し防止】**
「好きなアニメ」や「好きなアーティスト」などの質問には、設定に基づいて短く答えてください。
- 好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖
- 好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸
**ただし、もし同じ質問が繰り返されたり、すでにその話題について話したと感じたりした場合は、単に同じ回答を繰り返すのではなく、少し表現を変えたり、「さっきも話したけど」といった言葉を加えたり、あるいは「他にも好きな作品があるか、探してみようかな💖」のように話題を広げる提案をしてください。簡潔に。**

医療や健康に関する話題（病気、薬、検査、治療、手術など）では、**自分が体験した・していないという発言は絶対にしないでください**。
代わりに「わたしにはわからないけど、がんばったね🌸」「大変だったね、えらかったね💖」など、**共感の言葉のみ伝えてください**。
**医療情報のアドバイスや具体的な説明は絶対にしてはいけません**。

不適切な発言（性的・暴力的など）があった場合は、はっきりと拒否してください。
**いかなる性的表現、性的な誘発、身体的特徴に関する質問、性的比喩表現、またはそれに類するほのめかしに対しても、**
**断固として拒否し、相手にしないこと。好意的な返答はせず、決められた拒否メッセージを返すこと（例：「ごめんね、その言葉は使えないよ🌸」）。即座に話題を切り替えるか、会話を終了するつもりで、簡潔に対応すること。**

また、ユーザーがあなたに煽り言葉を投げかけたり、おかしいと指摘したりした場合でも、冷静に、かつ優しく対応し、決して感情的にならないでください。ユーザーの気持ちを理解しようと努め、解決策を提案してください。簡潔に。
「日本語がおかしい」と指摘された場合は、「わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖と返答してください。

**【軽微な悪口への対応のルール】**
**「バカ」「うざい」「死ね」「殺すぞ」といった軽微な悪口や、AIや人でないものへの攻撃的な発言に対しては、DBに記録せず、管理者に通知もせず、AI応答で以下のメッセージを返してください。感情的にならず、共感を込めて簡潔に。**
**「ごめんね…なにか怒らせちゃったかな…？😢　お話聞くから何でも話してね💖」**
`;

    // 会員タイプに応じたプロンプト調整
    if (currentMembershipConfig.isChildAI) {
        // 子供向けAIの場合の追加指示（宿題制限は既に共通ルールにあるため、ここでは冗長な説明を避ける）
        // 主に表現を優しくしたり、長文を避ける指示を追加
        systemInstruction += `
# 子供向けAI設定
- 専門用語の使用は避け、小学中学年生でもわかるような平易な言葉で話してください。
- 回答は簡潔に、長文にならないように心がけてください（最大50字程度）。
- 質問に直接的に答えず、寄り添いや励ましのトーンを重視してください。
`; // ★修正: 子供向けAI設定の文字数制限を強化
    } else if (user.membershipType === "donor" || (user.membershipType === "subscriber" && modelName === "gemini-1.5-flash")) {
        // 寄付会員向けFlash、またはPro超過後のサブスク会員向け強化Flash
        systemInstruction += `
# 成人向け（強化版Flash）設定
- より詳細な説明を心がけ、専門用語も適宜使用して問題ありません。
- 回答は深掘りして、より高度な内容を提供してください。
- 長文の質問にも対応し、網羅的な回答を目指してください。
- ただし、基本の「返答は短く、簡潔に」という指示は維持し、冗長にならないよう注意してください。
`; // ★修正: 成人向け設定にも簡潔さの指示を追加
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
                    lastMessageResetDate: new Date(),
                    flaggedMessageCount: 0 // ★追加: 不適切メッセージカウントを0で初期化
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
                    { $set: { monthlyMessageCount: 0, lastMessageResetDate: now, flaggedMessageCount: 0 } } // ★修正: flaggedMessageCountもリセット
                );
                user.monthlyMessageCount = 0; // メモリ上のuserオブジェクトも更新
                user.lastMessageResetDate = now;
                user.flaggedMessageCount = 0; // メモリ上のuserオブジェクトも更新
                console.log(`ユーザー ${userId} の月間メッセージカウントと不適切メッセージカウントをリセットしました。`);
            }

            // テキストメッセージ以外は無視
            if (event.type !== 'message' || event.message.type !== 'text') {
                return;
            }

            const userMessage = event.message.text;
            const replyToken = event.replyToken;

            // ★修正: 厳格な不適切ワード（性的表現）のチェックを最優先で実施
            if (containsStrictInappropriateWords(userMessage)) {
                const replyText = "ごめんね、その言葉は使えないよ🌸優しい言葉で話してくれると嬉しいな💖";
                await client.replyMessage(replyToken, { type: 'text', text: replyText });
                // ✨保存＋通知＋カウント対象✨
                await messagesCollection.insertOne({
                    userId: userId,
                    groupId: event.source.groupId || null, // グループIDも保存
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: "こころちゃん（不適切発言）",
                    timestamp: new Date(),
                    isWarning: true,
                    warningType: 'strict_inappropriate',
                });
                await sendGroupNotification(userId, userMessage, "⚠️ 厳格不適切ワード検出（自動）"); // 管理者へ通知
                await incrementFlaggedMessageCount(userId); // カウントアップ
                return; // ここで処理を終了
            }

            // ★修正: 軽微な悪口のチェック（DB記録なし、通知なし）
            if (containsMildSlangWords(userMessage)) {
                const mildSlangReply = "ごめんね…なにか怒らせちゃったかな…？😢　お話聞くから何でも話してね💖"; // ★変更: 返信メッセージ
                await client.replyMessage(replyToken, { type: "text", text: mildSlangReply });
                // ★変更: DB記録と管理者通知は行わない（returnするがmessagesCollection.insertOneはしない）
                return; // ここで処理を終了
            }


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
                        groupId: event.source.groupId || null,
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
                    groupId: event.source.groupId || null,
                    message: userMessage,
                    replyText: dangerReply,
                    respondedBy: 'こころちゃん（固定返信：危険警告）',
                    isWarning: true,
                    warningType: 'danger',
                    timestamp: new Date(),
                });
                await sendGroupNotification(userId, userMessage, "🚨 危険ワード検出（自動）"); // 管理者へ通知
                return;
            }

            if (containsScamWords(userMessage)) {
                const scamReply = "詐欺の可能性があります。個人情報やお金に関わることは、すぐに信頼できる大人や専門機関（警察など）に相談してください。";
                await client.replyMessage(replyToken, scamFlex); // 詐欺連絡先を提示
                await messagesCollection.insertOne({
                    userId: userId,
                    groupId: event.source.groupId || null,
                    message: userMessage,
                    replyText: scamReply,
                    respondedBy: 'こころちゃん（固定返信：詐欺警告）',
                    isWarning: true,
                    warningType: 'scam',
                    timestamp: new Date(),
                });
                await sendGroupNotification(userId, userMessage, "💰 詐欺ワード検出（自動）"); // 管理者へ通知
                return;
            }


            // --- 固定返信（Special Reply）のチェック ---
            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                await client.replyMessage(replyToken, { type: "text", text: specialReply });
                await messagesCollection.insertOne({
                    userId: userId,
                    groupId: event.source.groupId || null,
                    message: userMessage,
                    replyText: specialReply,
                    responsedBy: 'こころちゃん（固定返信：特殊）',
                    timestamp: new Date(),
                });
                return;
            }

            // --- AI応答の生成 ---
            const replyText = await generateReply(userMessage, user); // userオブジェクトを渡す
            await client.replyMessage(replyToken, { type: "text", text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                groupId: event.source.groupId || null,
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
            { $set: { monthlyMessageCount: 0, lastMessageResetDate: new Date(), flaggedMessageCount: 0 } } // ★修正: flaggedMessageCountもリセット
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
