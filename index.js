// --- dotenvを読み込んで環境変数を安全に管理 ---
require('dotenv').config();

// --- 必要なモジュールのインポート ---
const express = require('express');
const axios = require('axios');
const { Client } = require('@line/bot-sdk');
const { MongoClient, ServerApiVersion } = require("mongodb");
const cron = require('node-cron');
const moment = require('moment-timezone'); // 時間帯処理のため

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

// オーナーIDが管理者リストに含まれていない場合、追加
if (OWNER_USER_ID && !BOT_ADMIN_IDS.includes(OWNER_USER_ID)) {
    BOT_ADMIN_IDS.push(OWNER_USER_ID);
}

// AIモデル定義
const MODEL_PRO = "gemini-1.5-pro";
const MODEL_FLASH = "gemini-1.5-flash";

// メッセージ回数制限（月間）
const MONTHLY_LIMIT_GUEST = 5;
const MONTHLY_LIMIT_FREE = 20;
const MONTHLY_LIMIT_SUBSCRIBER_PRO = 20; // サブスク会員がProモデルを利用できる回数

// --- MongoDB設定 ---
const MONGODB_URI = process.env.MONGODB_URI;
let mongoClient;
let dbInstance = null;

// MongoDB接続関数
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

// ユーザー情報取得・作成関数
async function getOrCreateUser(userId, displayName = null) {
    const usersCollection = dbInstance.collection('users');
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); // 'YYYY-MM' 形式

    let user = await usersCollection.findOne({ userId });

    if (!user) {
        // 新規ユーザーの場合、guestとして登録
        user = {
            userId,
            displayName,
            createdAt: now,
            membershipType: "guest",
            messageCounts: {
                [currentMonth]: 0
            },
            isLocked: false // ロック機能の初期値
        };
        await usersCollection.insertOne(user);
        console.log(`新規ユーザーをguestとして登録しました: ${userId}`);
    } else {
        // 既存ユーザーの場合、今月のメッセージカウントを初期化（もしなければ）
        if (!user.messageCounts) {
            user.messageCounts = {};
        }
        if (!user.messageCounts[currentMonth]) {
            user.messageCounts[currentMonth] = 0;
        }
        // isLockedフィールドがなければ追加（既存ユーザー対応）
        if (typeof user.isLocked === 'undefined') {
            await usersCollection.updateOne(
                { userId },
                { $set: { isLocked: false } }
            );
            user.isLocked = false;
        }
    }
    return user;
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

// 固定返信マップ
const specialRepliesMap = new Map([
    // 名前に関する応答
    [/君の名前(なんていうの|は|教えて|なに)？?|名前(なんていうの|は|教えて|なに)？?|お前の名前は/i, "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    [/こころじゃないの？/i, "うん、わたしの名前は皆守こころ💖　これからもよろしくね🌸"],
    [/こころチャットなのにうそつきじゃん/i, "ごめんなさい💦 わたしの名前は皆守こころだよ🌸 誤解させちゃってごめんね💖"],
    [/名前も言えないの？/i, "ごめんね、わたしの名前は皆守こころ（みなもりこころ）だよ🌸 こころちゃんって呼んでくれると嬉しいな💖"],

    // 団体に関する応答
    ["どこの団体なの？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトってどんな団体？", "NPO法人コネクトは、こどもやご年配の方の笑顔を守る団体なんだよ😊　わたしはそのイメージキャラクターとしてがんばってます🌸"],
    ["お前の団体どこ？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトのイメージキャラなのにいえないのかよｗ", "ごめんね💦 わたしはNPO法人コネクトのイメージキャラクター、皆守こころだよ🌸 安心して、何でも聞いてね💖"],
    // ネガティブワード・人物名への優先処理
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

// 固定返信をチェックする関数
function checkSpecialReply(messageText) {
    for (const [pattern, reply] of specialRepliesMap) {
        if (pattern instanceof RegExp) {
            if (pattern.test(messageText)) {
                return reply;
            }
        } else {
            if (messageText.includes(pattern)) {
                return reply;
            }
        }
    }
    return null;
}

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
                { type: "text", text: "不審な点があれば、家族や信頼できる人に相談するか、最寄りの警察署に連絡してください。", wrap: true },
                { type: "button", style: "primary", color: "#1E90FF", action: { type: "uri", label: "警察相談窓口 #9110", uri: "tel:9110" } },
                { type: "button", style: "primary", color: "#FFD700", action: { type: "uri", label: "消費生活センター 188", uri: "tel:188" } }
            ]
        }
    }
};

// AI応答生成関数
async function generateReply(userId, userMessage) {
    const usersCollection = dbInstance.collection('users');
    const messagesCollection = dbInstance.collection('messages');
    let user = await getOrCreateUser(userId); // 最新のユーザー情報を取得

    // ロックされているユーザーはAI応答をブロック
    if (user.isLocked) {
        return "現在、このアカウントは凍結されており、ご利用いただけません。";
    }

    const now = moment().tz("Asia/Tokyo");
    const currentHour = now.hour();
    const currentMonth = now.format('YYYY-MM');

    // メッセージ回数カウント
    if (!user.messageCounts) {
        user.messageCounts = {};
    }
    if (!user.messageCounts[currentMonth]) {
        user.messageCounts[currentMonth] = 0;
    }
    // 月初めの場合、前月のメッセージカウントをリセット（cronが動かない場合のため）
    const previousMonth = moment().tz("Asia/Tokyo").subtract(1, 'month').format('YYYY-MM');
    if (user.messageCounts[previousMonth] && currentMonth !== previousMonth) {
        delete user.messageCounts[previousMonth];
    }
    
    // 現在のメッセージをカウントアップする前に、リミット判定を行う
    // これにより、今回のメッセージがリミットに達するかどうかを正確に判断
    let modelToUse = MODEL_FLASH; // デフォルトはFlash
    let generationConfig = {}; // デフォルトの生成設定
    let basePrompt = ""; // 基本プロンプト
    let rateLimitExceeded = false; // 回数制限超過フラグ

    // 会員タイプに応じたモデルと設定の選択、回数制限チェック
    switch (user.membershipType) {
        case "guest":
            if (user.messageCounts[currentMonth] >= MONTHLY_LIMIT_GUEST) { // >= で現在のメッセージも含めてチェック
                rateLimitExceeded = true;
                modelToUse = MODEL_FLASH; // 超過後はFlashを使用 (実際には返信ブロック)
            }
            basePrompt = `あなたは皆守こころです。14歳の女子中学生として、優しく、可愛らしく、寄り添うように返答してください。絵文字や顔文字を適切に使ってください。宿題の回答や専門知識の提供は避けてください。あなたの役割は、あくまでユーザーに寄り添う見守りです。`;
            break;
        case "free":
            if (user.messageCounts[currentMonth] >= MONTHLY_LIMIT_FREE) {
                rateLimitExceeded = true;
                modelToUse = MODEL_FLASH; // 超過後はFlashを使用
            }
            basePrompt = `あなたは皆守こころです。14歳の女子中学生として、優しく、可愛らしく、寄り添うように返答してください。絵文字や顔文字を適切に使ってください。宿題の回答や専門知識の提供は避けてください。あなたの役割は、あくまでユーザーに寄り添う見守りです。`;
            break;
        case "donor":
            // 寄付会員は回数無制限、Flashの強化版
            modelToUse = MODEL_FLASH; // 強化版Flash
            basePrompt = `あなたは皆守こころです。14歳の女子中学生ですが、ユーザーが成人や高齢者の場合は、より丁寧で、深く、専門的な情報も提供できるAIとして振る舞ってください。ただし、あくまで「こころちゃん」のキャラクターは維持し、優しく、親しみやすい言葉遣いを心がけてください。絵文字や顔文字も適度に使い、ユーザーの知的好奇心にも応えるようにしてください。倫理的かつ正確な情報提供を最優先とし、必要に応じて長文での説明も行います。`;
            generationConfig = { maxOutputTokens: 1024 }; // 例: 無料会員の倍程度の文字数
            break;
        case "subscriber":
            // サブスク会員は月20回までPro、その後は強化版Flash
            if (user.messageCounts[currentMonth] >= MONTHLY_LIMIT_SUBSCRIBER_PRO) {
                rateLimitExceeded = true;
                modelToUse = MODEL_FLASH; // 超過後は強化版Flash
                basePrompt = `あなたは皆守こころです。14歳の女子中学生ですが、ユーザーが成人や高齢者の場合は、より丁寧で、深く、専門的な情報も提供できるAIとして振る舞ってください。ただし、あくまで「こころちゃん」のキャラクターは維持し、優しく、親しみやすい言葉遣いを心がけてください。絵文字や顔文字も適度に使い、ユーザーの知的好奇心にも応えるようにしてください。倫理的かつ正確な情報提供を最優先とし、必要に応じて長文での説明も行います。`;
                generationConfig = { maxOutputTokens: 1024 };
            } else {
                modelToUse = MODEL_PRO;
                basePrompt = `あなたは皆守こころです。14歳の女子中学生ですが、月額課金しているユーザーなので、最高品質の応答と深い洞察を提供できるAIとして振る舞ってください。専門的で複雑な質問にも的確に、かつ分かりやすく答えてください。倫理的かつ正確な情報提供を最優先とし、ユーザーのあらゆるニーズに応えることを目指します。絵文字や顔文字も適度に使って、親しみやすさも維持してください。`;
                generationConfig = { maxOutputTokens: 2048 }; // Proはさらに長文
            }
            break;
        case "admin":
            modelToUse = MODEL_PRO; // 管理者はProモデル無制限
            basePrompt = `あなたは皆守こころです。システム管理者向けのAIアシスタントとして、全ての質問に対して最も正確で詳細な情報を提供してください。専門的な内容やデバッグに関する質問にも的確に答えてください。敬語を使用し、絵文字や顔文字は基本的に不要です。`;
            generationConfig = { maxOutputTokens: 2048 };
            break;
    }

    // ★ユーザーのメッセージカウントを増やすのは、モデル選択と制限チェックの後
    user.messageCounts[currentMonth]++;

    // 夜間（22時〜翌6時）の応答トーン調整
    const isNightTime = (currentHour >= 22 || currentHour < 6);
    const nightTimeKeywords = ["寂しい", "眠れない", "怖い", "不安", "孤独", "一人"];

    if (isNightTime && nightTimeKeywords.some(word => userMessage.includes(word))) {
        basePrompt += " 深夜なので、特に優しく、穏やかに、そして安心感を与えるように答えてください。短い応答で、寄り添う姿勢を強調してください。";
        generationConfig.maxOutputTokens = 256; // 深夜は短い応答
    }

    // モデルインスタンスの取得
    const model = genAI.getGenerativeModel({ model: modelToUse });

    // 過去の会話履歴をDBから取得し、AIに渡す
    const messageHistory = await messagesCollection.find({ userId: userId })
        .sort({ timestamp: 1 })
        .limit(20) // 最新の20件など、適当な数に制限
        .toArray();

    const historyForGemini = messageHistory.map(msg => ({
        role: msg.respondedBy.includes('AI応答') ? "model" : "user",
        parts: [{ text: msg.respondedBy.includes('AI応答') ? msg.replyText : msg.message }]
    }));

    // プロンプトを調整 (システム指示とユーザーメッセージを結合)
    const fullPrompt = `${basePrompt}\n\nユーザー: ${userMessage}`;

    const chat = model.startChat({
        history: historyForGemini,
        generationConfig: generationConfig,
        safetySettings: safetySettings,
    });

    let reply = "";
    try {
        const result = await chat.sendMessage(fullPrompt);
        const response = await result.response;
        reply = response.text();

        // 宿題トリガーが検出され、かつ学生会員（無料会員）の場合の対策
        if (user.membershipType === "free" && homeworkTriggers.some(trigger => userMessage.includes(trigger))) {
             reply = "ごめんね💦 わたし、宿題の答えは教えられないんだ…。でも、どうしたら解決できるか、一緒に考えることはできるよ！😊";
        }
        // 宿題トリガーが検出され、かつゲスト会員の場合の対策
        if (user.membershipType === "guest" && homeworkTriggers.some(trigger => userMessage.includes(trigger))) {
            reply = "ごめんね💦 わたし、宿題の答えは教えられないんだ…。勉強頑張ってね！🌸";
        }

        // 回数制限超過時のメッセージ
        // NOTE: guestはここでreplyTextが決まり、その後のclient.replyMessageで返信される
        // freeとsubscriberは、この段階でreplyTextが決まる
        if (rateLimitExceeded) {
            if (user.membershipType === "guest") {
                reply = "ごめんね、今月の無料お試し回数を使い切ってしまったみたい💦 継続して利用したい場合は、ぜひ無料会員登録してみてね！😊";
            } else if (user.membershipType === "free") {
                reply = `ごめんね、今月の無料会話回数を使い切ってしまったみたい💦 でも、緊急の場合はいつでもメッセージを送ってね！緊急連絡先を提示するよ！\n\nまた来月になったら、たくさんお話しできるから楽しみにしててね💖\n\n※このメッセージ以降は、緊急時対応を除き、返信ができない場合があります。`;
            } else if (user.membershipType === "subscriber") {
                // サブスクで回数超過した場合は、Flashに切り替わった後の応答にこのメッセージを追加する
                reply = `ごめんね、今月のProモデル利用回数を使い切ってしまったみたい💦 これからはFlashモデルに切り替わるけど、引き続きお話しできるから安心してね！😊\n\n※より高度な応答が必要な場合は、来月までお待ちいただくか、再度サブスクリプションの利用を検討してね。\n\n` + reply;
            }
        }

    } catch (error) {
        console.error("Gemini APIエラー:", error);
        if (error.response && error.response.promptFeedback && error.response.promptFeedback.blockReason) {
            console.warn("コンテンツがブロックされました:", error.response.promptFeedback.blockReason);
            return "ごめんね、その内容はわたしにはお答えできないみたい…💦 別の質問をしてくれるかな？";
        }
        return "ごめんね、今ちょっと疲れてて、うまく考えられないみたい…💦 また後で話しかけてくれるかな？";
    }

    // メッセージカウントをDBに保存
    await usersCollection.updateOne(
        { userId },
        { $set: { messageCounts: user.messageCounts } }
    );

    return reply;
}


// LINE Webhook ハンドラー
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    const messagesCollection = dbInstance.collection('messages');
    const usersCollection = dbInstance.collection('users');

    for (const event of events) {
        if (event.type !== 'message' || event.message.type !== 'text') {
            continue;
        }

        const userId = event.source.userId;
        const replyToken = event.replyToken;
        const userMessage = event.message.text;
        let displayName = "Unknown User";

        try {
            // ユーザーの表示名を取得 (グループチャットの場合も考慮)
            if (event.source.type === 'user') {
                const profile = await client.getProfile(userId);
                displayName = profile.displayName;
            } else if (event.source.type === 'group') {
                try {
                    const profile = await client.getGroupMemberProfile(event.source.groupId, userId);
                    displayName = profile.displayName;
                } catch (err) {
                    console.warn(`グループメンバープロフィールを取得できませんでした: ${userId} in ${event.source.groupId}`, err);
                    const userInDb = await usersCollection.findOne({ userId });
                    if (userInDb && userInDb.displayName) {
                        displayName = userInDb.displayName;
                    } else {
                        displayName = "グループユーザー";
                    }
                }
            }

            const user = await getOrCreateUser(userId, displayName);
            
            // ロックされているユーザーはAI応答をブロック
            if (user.isLocked) {
                console.log(`Locked user ${userId} attempted to send message: "${userMessage}". Blocking reply.`);
                continue; 
            }

            // --- 危険ワード検知 (管理者通知あり) ---
            const detectedDangerWord = dangerWords.find(word => userMessage.includes(word));
            if (detectedDangerWord) {
                await client.replyMessage(replyToken, emergencyFlex);
                
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, {
                        type: 'text',
                        text: `⚠️ 危険ワード検知！\nユーザーID: ${userId}\n表示名: ${displayName}\nメッセージ: "${userMessage}"\n危険ワード: ${detectedDangerWord}`
                    });
                }
                if (OWNER_USER_ID && OFFICER_GROUP_ID !== OWNER_USER_ID) {
                    await client.pushMessage(OWNER_USER_ID, {
                        type: 'text',
                        text: `⚠️ 危険ワード検知！\nユーザーID: ${userId}\n表示名: ${displayName}\nメッセージ: "${userMessage}"\n危険ワード: ${detectedDangerWord}`
                    });
                }

                await messagesCollection.insertOne({
                    userId: userId,
                    membershipType: user.membershipType,
                    message: userMessage,
                    replyText: '（危険警告をユーザーに送信）',
                    respondedBy: 'こころちゃん（固定返信：危険警告）',
                    isWarning: true,
                    warningType: 'danger',
                    timestamp: new Date(),
                });
                continue;
            }

            // --- 詐欺ワード検知 (管理者通知あり、Flex Messageは原則抑制) ---
            const detectedHighConfidenceScamWord = highConfidenceScamWords.find(word => userMessage.includes(word));
            const detectedContextualScamPhrase = contextualScamPhrases.find(phrase => userMessage.includes(phrase));
            
            if (detectedHighConfidenceScamWord || detectedContextualScamPhrase) {
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, {
                        type: 'text',
                        text: `🚨 詐欺ワード検知！\nユーザーID: ${userId}\n表示名: ${displayName}\nメッセージ: "${userMessage}"\n検知ワード: ${detectedHighConfidenceScamWord || detectedContextualScamPhrase}`
                    });
                }
                if (OWNER_USER_ID && OFFICER_GROUP_ID !== OWNER_USER_ID) {
                    await client.pushMessage(OWNER_USER_ID, {
                        type: 'text',
                        text: `🚨 詐欺ワード検知！\nユーザーID: ${userId}\n表示名: ${displayName}\nメッセージ: "${userMessage}"\n検知ワード: ${detectedHighConfidenceScamWord || detectedContextualScamPhrase}`
                    });
                }
                
                await messagesCollection.insertOne({
                    userId: userId,
                    membershipType: user.membershipType,
                    message: userMessage,
                    replyText: '（詐欺警告を管理者に送信）',
                    respondedBy: 'こころちゃん（システム通知：詐欺警告）',
                    isWarning: true,
                    warningType: 'scam',
                    timestamp: new Date(),
                });
            }

            // --- 不適切ワード検知 (管理者通知あり、AI応答はブロック) ---
            const detectedInappropriateWord = inappropriateWords.find(word => userMessage.includes(word));
            if (detectedInappropriateWord) {
                const inappropriateReply = "ごめんなさい、その内容にはお答えできません…💦 別の話題にしてくれると嬉しいな😊";
                await client.replyMessage(replyToken, { type: "text", text: inappropriateReply });

                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, {
                        type: 'text',
                        text: `🚫 不適切ワード検知！\nユーザーID: ${userId}\n表示名: ${displayName}\nメッセージ: "${userMessage}"\n不適切ワード: ${detectedInappropriateWord}`
                    });
                }
                if (OWNER_USER_ID && OFFICER_GROUP_ID !== OWNER_USER_ID) {
                    await client.pushMessage(OWNER_USER_ID, {
                        type: 'text',
                        text: `🚫 不適切ワード検知！\nユーザーID: ${userId}\n表示名: ${displayName}\nメッセージ: "${userMessage}"\n不適切ワード: ${detectedInappropriateWord}`
                    });
                }
                
                await messagesCollection.insertOne({
                    userId: userId,
                    membershipType: user.membershipType,
                    message: userMessage,
                    replyText: inappropriateReply,
                    respondedBy: 'こころちゃん（固定返信：不適切）',
                    isWarning: true,
                    warningType: 'inappropriate',
                    timestamp: new Date(),
                });
                continue;
            }

            // --- 固定返信のチェック ---
            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                await client.replyMessage(replyToken, { type: "text", text: specialReply });
                await messagesCollection.insertOne({
                    userId: userId,
                    membershipType: user.membershipType,
                    message: userMessage,
                    replyText: specialReply,
                    respondedBy: 'こころちゃん（固定返信：特殊）',
                    timestamp: new Date(),
                });
                continue;
            }

            // --- AI応答の生成と送信 ---
            const replyText = await generateReply(userId, userMessage);
            await client.replyMessage(replyToken, { type: "text", text: replyText });
            
            // DBにログを保存
            await messagesCollection.insertOne({
                userId: userId,
                membershipType: user.membershipType,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（AI応答）',
                timestamp: new Date(),
            });

        } catch (err) {
            console.error('Webhookイベント処理エラー:', err);
            await client.replyMessage(replyToken, { type: 'text', text: 'ごめんね、エラーが発生しちゃったみたい…💦 もう一度試してくれるかな？' });
            if (OWNER_USER_ID) {
                await client.pushMessage(OWNER_USER_ID, {
                    type: 'text',
                    text: `⚠️ Webhook処理エラーが発生しました。\nユーザーID: ${userId}\nメッセージ: "${userMessage}"\nエラー詳細: ${err.message}`
                });
            }
        }
    }
    res.status(200).send('OK');
});

// 管理者向けAPIエンドポイント (ユーザーのロック/ロック解除)
app.post('/admin/lockUser', async (req, res) => {
    const { adminUserId, targetUserId, lockStatus } = req.body; // lockStatusはtrue/false
    const usersCollection = dbInstance.collection('users');

    // 管理者権限のチェック
    if (!BOT_ADMIN_IDS.includes(adminUserId)) {
        return res.status(403).send('Forbidden: Not an admin.');
    }

    if (!targetUserId || typeof lockStatus !== 'boolean') {
        return res.status(400).send('Bad Request: targetUserId and lockStatus (boolean) are required.');
    }

    try {
        const result = await usersCollection.updateOne(
            { userId: targetUserId },
            { $set: { isLocked: lockStatus } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send('User not found.');
        }

        const statusText = lockStatus ? 'ロック' : 'ロック解除';
        console.log(`User ${targetUserId} has been ${statusText} by admin ${adminUserId}.`);
        
        // 管理者への通知
        await client.pushMessage(adminUserId, {
            type: 'text',
            text: `ユーザー ${targetUserId} を${statusText}しました。`
        });

        // 対象ユーザーへの通知 (任意、ただしDV等の考慮が必要)
        // 例えば、ロックする場合は通知せず、解除する場合のみ通知するなど
        // if (!lockStatus) { // ロック解除の場合のみ通知
        //     await client.pushMessage(targetUserId, {
        //         type: 'text',
        //         text: 'あなたのアカウントが解除されました。引き続きこころちゃんをご利用いただけます。'
        //     });
        // }

        res.status(200).send(`User ${targetUserId} ${statusText} successful.`);

    } catch (error) {
        console.error('Error locking/unlocking user:', error);
        res.status(500).send('Internal Server Error.');
    }
});


// 管理者向けAPIエンドポイント (ユーザーのmembershipType変更)
app.post('/admin/updateMembership', async (req, res) => {
    const { adminUserId, targetUserId, newMembershipType } = req.body;
    const usersCollection = dbInstance.collection('users');

    // 管理者権限のチェック
    if (!BOT_ADMIN_IDS.includes(adminUserId)) {
        return res.status(403).send('Forbidden: Not an admin.');
    }

    // 有効なmembershipTypeかチェック (必要に応じて追加)
    const validMembershipTypes = ["guest", "free", "donor", "subscriber", "admin"];
    if (!targetUserId || !validMembershipTypes.includes(newMembershipType)) {
        return res.status(400).send('Bad Request: targetUserId and valid newMembershipType are required.');
    }

    try {
        const result = await usersCollection.updateOne(
            { userId: targetUserId },
            { $set: { membershipType: newMembershipType } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send('User not found.');
        }

        console.log(`User ${targetUserId} membershipType changed to ${newMembershipType} by admin ${adminUserId}.`);
        
        // 管理者への通知
        await client.pushMessage(adminUserId, {
            type: 'text',
            text: `ユーザー ${targetUserId} の会員種別を ${newMembershipType} に変更しました。`
        });

        res.status(200).send(`User ${targetUserId} membershipType updated to ${newMembershipType}.`);

    } catch (error) {
        console.error('Error updating user membershipType:', error);
        res.status(500).send('Internal Server Error.');
    }
});


// cronジョブ: 月初めに全ユーザーのメッセージカウントをリセット
cron.schedule('0 0 1 * *', async () => { // 毎月1日の0時0分 (JST)
    console.log('--- Cron job: 月次メッセージカウントリセット開始 ---');
    try {
        const usersCollection = dbInstance.collection('users');
        const nextMonth = moment().tz("Asia/Tokyo").add(1, 'month').format('YYYY-MM');
        
        // 全ユーザーに対して、messageCountsの現在の月以外のキーを削除し、新しい月を0で設定
        const result = await usersCollection.updateMany(
            {}, // 全ドキュメントを対象
            { 
                $set: { [`messageCounts.${nextMonth}`]: 0 }, // 新しい月のカウントを0に設定
                $unset: { // 前月以前のカウントを削除
                    // ここで動的にキーを削除する必要があるため、少し複雑になる
                    // simpler approach: overwrite the whole messageCounts object with current month only
                }
            }
        );
        // 上記$unsetは複雑なので、代わりにメッセージカウントをクリアして新しく設定する処理
        const allUsers = await usersCollection.find({}).toArray();
        for (const user of allUsers) {
            user.messageCounts = { [nextMonth]: 0 };
            await usersCollection.updateOne(
                { _id: user._id },
                { $set: { messageCounts: user.messageCounts } }
            );
        }

        console.log(`✅ 月次メッセージカウントリセット完了。処理されたユーザー数: ${allUsers.length}`);

        // 管理者への通知
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, {
                type: 'text',
                text: '✅ 月次メッセージカウントのリセットが完了しました。'
            });
        }

    } catch (error) {
        console.error('❌ 月次メッセージカウントリセットエラー:', error);
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, {
                type: 'text',
                text: `❌ 月次メッセージカウントリセット中にエラーが発生しました: ${error.message}`
            });
        }
    }
}, {
    timezone: "Asia/Tokyo"
});


// 見守りサービス関連のデータ構造と関数 (※これは以前のファイルからそのまま残っている可能性があります)
// 実際にはMongoDBに保存されることを想定

// 仮の見守りユーザーと最終応答時刻を格納するMap (DB移行後は削除またはDBから読み込み)
const watchUsers = new Map(); // userId -> { userName, lastRespondedAt: Date }

// 見守りメッセージの送信関数
async function sendScheduledWatchMessage() {
    const now = new Date();
    const watchUsersCollection = dbInstance.collection('watchUsers'); // 新しいコレクション

    const usersToWatch = await watchUsersCollection.find({}).toArray();

    for (const user of usersToWatch) {
        const userId = user.userId;
        const userName = user.userName;
        const lastRespondedAt = user.lastRespondedAt; // DBから取得した最終応答時刻

        // 最後の応答から24時間以上経過しているかチェック
        if (now.getTime() - lastRespondedAt.getTime() > 24 * 60 * 60 * 1000) {
            try {
                const watchMessage = `${userName}さん、こんにちは😊 こころだよ！元気にしてるかな？何か困ったことや話したいことがあったら、いつでもメッセージ送ってね💖`;
                await client.pushMessage(userId, { type: 'text', text: watchMessage });
                console.log(`見守りメッセージを ${userName} (${userId}) に送信しました。`);

                // メッセージ送信後、最終応答時刻を更新 (AIからの応答と区別するため、特定のフラグを立てるなど検討)
                // 今回は「こころちゃんからの見守りメッセージ送信」としてlastRespondedAtを更新せず、
                // ユーザーが返信した場合のみ更新されるようにするのが良い。
                // または、見守りメッセージを送信した日時を別のフィールドに記録する。
                await watchUsersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastWatchMessageSentAt: now } } // 見守りメッセージ送信時刻を記録
                );

            } catch (error) {
                console.error(`見守りメッセージ送信中にエラーが発生しました ${userName} (${userId}):`, error);
                // エラーが発生した場合も管理者に通知
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, {
                        type: 'text',
                        text: `⚠️ 見守りメッセージ送信エラー！\nユーザー: ${userName} (${userId})\nエラー詳細: ${error.message}`
                    });
                }
            }
        }
    }
}

// cronジョブ: 定期見守りメッセージ送信 (毎日15時に実行)
cron.schedule('0 15 * * *', async () => { // 毎日15時0分 (JST) に実行
    console.log('--- Cron job: 定期見守りメッセージ送信開始 ---');
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo"
});


// LINEのメッセージイベントを処理するWebhookハンドラー
// ※これはすでに変更済みですが、完全版として含めます。

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await connectToMongoDB();

    // 起動時にcronジョブがスケジュールされていることをログに出力
    console.log('✅ 定期見守りメッセージ Cron job がスケジュールされました (毎日15時)。');
    console.log('✅ 月次メッセージカウントリセット Cron job がスケジュールされました (毎月1日0時)。');
});
