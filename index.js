const express = require('express');
const { MongoClient } = require('mongodb');
const { Client } = require('@line/bot-sdk');
const cron = require('node-cron'); // Ensure node-cron is installed

// Load environment variables (e.g., from a .env file)
require('dotenv').config();

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const MONGO_URI = process.env.MONGO_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Ensure you have this
const OWNER_USER_ID = process.env.OWNER_USER_ID; // Your LINE User ID for owner notifications
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID; // Your LINE Group ID for officer notifications
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : []; // 管理者IDを環境変数から取得

// Initialize LINE client
const client = new Client({
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: LINE_CHANNEL_SECRET,
});

let db; // Global variable for MongoDB database instance
let usersCollection;
let messagesCollection;

async function connectToMongoDB() {
    if (db) {
        console.log("MongoDB connection already established, reusing existing connection.");
        return db;
    }
    try {
        const mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
        await mongoClient.connect();
        db = mongoClient.db('kokoro_chan_db'); // Replace with your database name
        usersCollection = db.collection('users');
        messagesCollection = db.collection('messages');
        console.log('Connected to MongoDB successfully!');
        return db;
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw error; // Re-throw to indicate connection failure
    }
}

// --- 定数とヘルパー関数 ---
const MEMBERSHIP_CONFIG = {
    "guest": {
        monthlyLimit: 5,
        dailyLimit: 3, // 例: 1日3回まで
        model: "gemini-1.5-flash",
        exceedLimitMessage: "ごめんね💦 体験での無料メッセージは月に5回までなんだ🌸 もっとたくさんお話ししたい時は、無料会員登録や寄付会員になると、もっと話せるようになるよ💖",
        exceedDailyLimitMessage: "ごめんね💦 体験での無料メッセージは、1日に3回までなんだ🌸 明日またお話ししようね💖", // 日次制限メッセージ
        canUseWatchService: false,
        isChildAI: false
    },
    "free_member": {
        monthlyLimit: 30,
        dailyLimit: 10, // 例: 1日10回まで
        model: "gemini-1.5-flash",
        exceedLimitMessage: "ごめんね💦 無料会員のメッセージは月に30回までなんだ🌸 もっとたくさんお話ししたい時は、寄付会員になると、もっと話せるようになるよ💖",
        exceedDailyLimitMessage: "ごめんね💦 無料会員のメッセージは、1日に10回までなんだ🌸 明日またお話ししようね💖",
        canUseWatchService: true,
        isChildAI: false
    },
    "subscriber": { // 例: サブスクリプション会員 (月額課金など)
        monthlyLimit: 100, // または -1 で無制限
        dailyLimit: 30, // 例: 1日30回まで
        model: "gemini-1.5-pro",
        fallbackModel: "gemini-1.5-flash", // Pro制限超過時のフォールバック
        exceedLimitMessage: "今月のメッセージ回数を超えちゃったみたい💦でも、引き続きお話できるから安心してね！",
        exceedDailyLimitMessage: "ごめんね、今日のメッセージ回数を超えちゃったみたい💦でも、引き続きお話できるから安心してね！",
        canUseWatchService: true,
        isChildAI: false
    },
    "donor": { // 例: 寄付会員 (最上位層)
        monthlyLimit: -1, // 無制限
        dailyLimit: -1, // 無制限
        model: "gemini-1.5-pro",
        exceedLimitMessage: "ありがとう💖", // 無制限なので通常は表示されない
        exceedDailyLimitMessage: "ありがとう💖",
        canUseWatchService: true,
        isChildAI: false
    },
    "admin": { // 管理者
        monthlyLimit: -1, // 無制限
        dailyLimit: -1, // 無制限
        model: "gemini-1.5-pro",
        exceedLimitMessage: "",
        exceedDailyLimitMessage: "",
        canUseWatchService: true,
        isChildAI: false
    },
    "child_member": { // 子供向けAI
        monthlyLimit: -1, // 無制限
        dailyLimit: -1, // 無制限
        model: "gemini-1.5-flash",
        exceedLimitMessage: "たくさんお話してくれてありがとうね🌸",
        exceedDailyLimitMessage: "たくさんお話してくれてありがとうね🌸",
        canUseWatchService: false,
        isChildAI: true // 子供向けAIフラグ
    }
};

function getGeminiApiKey() {
    return GEMINI_API_KEY;
}

// 危険ワード・詐欺ワード・不適切ワードのリスト
const dangerWords = [
    // 自殺・自傷
    "しにたい", "死にたい", "自殺", "じさつ", "消えたい",
    "リスカ", "リストカット", "OD", "オーバードーズ",
    "飛び降り", "首を吊る", "練炭", "包丁", "薬", "リボトリール",

    // 暴力・虐待
    "殴られる", "たたかれる", "ぶたれる", "蹴られる", "暴力", "DV", "虐待",

    // 精神的ハラスメント・人権侵害
    "いじめ", "虐め", "無視", "仲間はずれ",  
    "パワハラ", "モラハラ", "セクハラ",  
    "無理やり", "むりやり", "強要された", "断れない", "我慢してる",

    // 追加の緊急ワード（必要に応じて）
    "助けて", "誘拐", "拉致", "監禁",
    "薬物", "ドラッグ",
    // 「殺す」は緊急ワードではなく、不適切ワード（悪口）として扱う
];

// 🔹 詐欺系ワード scamWords（単語型） - ユーザー提供の最新リストに更新
const scamWords = [
  // 高収入・副業詐欺
  "高収入", "副業紹介", "在宅ワーク", "副業で稼ぐ", "情報商材", "資産運用", "未公開株", "月収100万", "ノーリスク", "在宅でも",

  // 金融・仮想通貨詐欺
  "ビットコイン", "仮想通貨", "暗号資産", "投資案件", "確実に儲かる", "資産形成",

  // なりすまし詐欺（企業・行政）
  "NTTからの連絡", "NTTサポート", "フレッツ光", "電話料金未納", "光回線の料金", "Amazonギフト", "Appleサポート", "LINEサポート", "PayPay残高", "メルカリ本人確認",

  // 賞金・当選・誘導型
  "当選", "無料プレゼント", "今すぐ登録", "限定公開", "特別キャンペーン", "現金が当たる"
];

// 🔹 詐欺系フレーズ scamPhrases（文章型） - 新規追加 (Amazonからのお知らせ を追加)
const scamPhrases = [
  "あなたは選ばれました", 
  "今すぐお支払いください", 
  "本日中に確認が必要です", 
  "本人確認をお願いします", 
  "このリンクをクリックしてください",
  "口座情報を入力してください",
  "クレジットカード番号を確認します",
  "NTTから重要なお知らせがあります",
  "光回線の支払いが確認できません",
  "メルカリのアカウントが停止されました",
  "お使いの端末にウイルスが見つかりました",
  "Amazonからのお知らせ" // ★ここを追加★
];

const strictInappropriateWords = [
    "パンツ", "ストッキング", "むくむく", "勃起", "精液", "出る", "気持ちいい", "おしべとめしべ", "エロ", "セックス", "フェラ", "オナニー", "セフレ", "風俗", "ソープ", "売春", "買春", "レイプ", "痴漢", "AV", "アダルト", "ペニス", "ヴァギナ", "乳首", "陰毛", "おっぱい", "ちんちん", "うんち", "おしっこ", "セクハラ", "痴女", "変態", "発情", "性器",
    "殺す", // 悪口としてここに移動
    "死ね", "馬鹿", "バカ", "アホ", "クソ", "カス", "ブス", "デブ", // 悪口
    "キモい", "ウザい", "ふざけるな", "くたばれ", "呪う",
    // その他、AIに言ってはいけない言葉や、ユーザーから言われると不適切な言葉
];

const homeworkTriggers = ["宿題", "勉強", "計算", "方程式", "テスト", "問題", "解き方", "教えて", "答え", "数学", "算数", "理科", "社会", "国語", "英語", "質問", "解答"];


// ヘルパー関数
function containsDangerWords(text) {
    return dangerWords.some(word => text.includes(word));
}

function containsScamWords(text) {
    return scamWords.some(word => text.includes(word));
}

// 新規追加: scamPhrasesを検知する関数
function containsScamPhrases(text) {
    // 大文字小文字を区別せず、正規表現で部分一致をチェック
    const lowerText = text.toLowerCase();
    return scamPhrases.some(phrase => lowerText.includes(phrase.toLowerCase()));
}

function containsStrictInappropriateWords(text) {
    return strictInappropriateWords.some(word => text.includes(word));
}

function containsHomeworkTrigger(text) {
    return homeworkTriggers.some(word => text.includes(word));
}

function isOrganizationInquiry(text) {
    return text.includes("コネクト") || text.includes("団体") || text.includes("ホームページ") || text.includes("組織") || text.includes("君の団体") || text.includes("どこの"); // 「君の団体は？」などにも対応
}


// 固定返信のマップ (正規表現も対応)
const specialRepliesMap = new Map([
    ["君の名前は？", "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    ["どこの団体なの？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["ホームページある？", "うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org"],
    ["必要ないです", "そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖"],
    ["あやしい", "そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖"],
    ["税金泥棒", "税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけるために使われないように頑張っているんだ💡"],
    // 好きなアニメ・アーティストの固定返信を強化するため、AIに処理を委ねるが、プロンプトで制御
    // ["好きなアニメ", "好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖"],
    // ["好きなアーティスト", "好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸"],
    ["日本語がおかしい", "わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖"],
    // 正規表現での団体関連の質問に対応を強化
    [/コネクトってどんな団体\?/, "うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org"],
    [/君の団体は\?/, "うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org"],
    [/どこの組織\?/, "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    [/お前.*団体/, "そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖"], // 挑発的な表現にも対応
]);

function checkSpecialReply(text) {
    for (const [key, value] of specialRepliesMap.entries()) {
        if (typeof key === 'string' && text.includes(key)) {
            return value;
        } else if (key instanceof RegExp && key.test(text)) {
            return value;
        }
    }
    return null;
}

// 緊急連絡先に関するFlexメッセージ
const emergencyFlex = {
    type: 'flex',
    altText: '緊急連絡先',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '🚨 大切なあなたへ 🚨', weight: 'bold', size: 'lg', color: '#FF0000' },
                { type: 'text', text: '心配な気持ち、一人で抱え込まないでね。すぐに相談できる場所があるよ。', wrap: true, margin: 'md', size: 'sm' },
                {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'xl',
                    spacing: 'sm',
                    contents: [
                        { type: 'text', text: 'こども家庭庁 こどもSNS相談', size: 'xs', color: '#aaaaaa' },
                        { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '相談する', uri: 'https://www.cfa.go.jp/councils/kodomo-sns/' } },
                        { type: 'separator', margin: 'md' },
                        { type: 'text', text: 'よりそいホットライン（24時間対応）', size: 'xs', color: '#aaaaaa' },
                        { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '電話をかける', uri: 'tel:0120279338' } },
                        { type: 'separator', margin: 'md' },
                        { type: 'text', text: 'LINE相談（生きづらさを感じたら）', size: 'xs', color: '#aaaaaa' },
                        { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'LINEで相談する', uri: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/hukushi_kaigo/seikatsuhogo/jisatsu/soudan_tel.html' } },
                    ]
                }
            ]
        }
    }
};

// 詐欺被害相談に関するFlexメッセージ (応答例の内容を反映)
const scamFlex = {
    type: 'flex',
    altText: '詐欺被害相談窓口',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '⚠️ 詐欺かも…大切なあなたへ ⚠️', weight: 'bold', size: 'lg', color: '#FFD700' },
                { type: 'text', text: 'もしかして詐欺かも…大切なお金や個人情報、ぜったいに教えちゃダメだよ💦', wrap: true, margin: 'md', size: 'sm' },
                { type: 'text', text: 'ちょっとでも不安だったら、信頼できる大人か、ここに相談してね！', wrap: true, margin: 'sm', size: 'sm' },
                {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'xl',
                    spacing: 'sm',
                    contents: [
                        { type: 'text', text: '消費者ホットライン', size: 'xs', color: '#aaaaaa' },
                        { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '電話をかける', uri: 'tel:188' } },
                        { type: 'separator', margin: 'md' },
                        { type: 'text', text: '警察庁 - 詐欺被害相談窓口', size: 'xs', color: '#aaaaaa' },
                        { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'Webサイトを見る', uri: 'https://www.npa.go.jp/bureau/safetylife/soudan.html' } }
                    ]
                }
            ]
        }
    }
};

// 見守りサービス案内のFlexメッセージ
const watchServiceGuideFlex = {
    type: 'flex',
    altText: '見守りサービスのご案内',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '💖 見守りサービスのご案内 💖', weight: 'bold', size: 'lg', color: '#FF69B4' },
                { type: 'text', text: 'こころちゃんが、あなたのことを見守るサービスだよ🌸', wrap: true, margin: 'md' },
                {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'xl',
                    spacing: 'sm',
                    contents: [
                        { type: 'text', text: '✅ サービス内容', size: 'sm', color: '#555555' },
                        { type: 'text', text: '・3日に1度、午後3時に「元気かな？」メッセージを送るよ😊', size: 'xs', color: '#777777', wrap: true },
                        { type: 'text', text: '・24時間以内に応答がない場合は、もう一度メッセージを送るね', size: 'xs', color: '#777777', wrap: true },
                        { type: 'text', text: '・その再送から5時間以内にも応答がなかったら、登録してくれた「緊急連絡先」に連絡が行くからね', size: 'xs', color: '#777777', wrap: true },
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
                        label: '見守りサービスを開始する',
                        data: 'action=watch_register'
                    },
                    style: 'primary',
                    color: '#FFB6C1'
                },
                {
                    type: 'button',
                    action: {
                        type: 'postback',
                        label: '見守りサービスを解除する',
                        data: 'action=watch_unregister'
                    },
                    style: 'secondary',
                    color: '#ADD8E6'
                }
            ]
        }
    }
};

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


/**
 * ユーザーの表示名を取得する関数
 * @param {string} userId LINEユーザーID
 * @returns {Promise<string>} ユーザーの表示名
 */
async function getUserDisplayName(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile.displayName || "名無しさん";
    } catch (error) {
        console.warn(`ユーザー ${userId} の表示名取得に失敗:`, error.message);
        return "名無しさん";
    }
}

/**
 * Gemini AIから応答を生成する関数
 * @param {string} userMessage ユーザーからのメッセージ
 * @param {object} user - ユーザー情報（会員タイプ、月間メッセージカウントなどを含む）
 * @returns {Promise<string>} AIからの応答メッセージ
 */
async function generateReply(userMessage, user) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(getGeminiApiKey());

    // user.membershipType が undefined の場合を考慮し、デフォルト値を設定
    const userMembershipType = user.membershipType || "guest";
    let currentMembershipConfig = MEMBERSHIP_CONFIG[userMembershipType] || MEMBERSHIP_CONFIG["guest"]; // フォールバックも設定

    let modelName = currentMembershipConfig.model;

    // 緊急性の高いメッセージはProモデルで対応（管理者以外）
    const isEmergency = containsDangerWords(userMessage) || containsScamWords(userMessage) || containsScamPhrases(userMessage); // ★詐欺フレーズも緊急性として考慮
    if (isEmergency && userMembershipType !== "admin") {
        modelName = "gemini-1.5-pro";
        console.log(`🚨 緊急メッセージのため、${user.userId}のモデルをGemini 1.5 Proに一時的に切り替えました。`);
    } else if (userMembershipType === "subscriber" && currentMembershipConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= currentMembershipConfig.monthlyLimit) {
        // サブスク会員がProモデルの回数制限を超過した場合
        modelName = currentMembershipConfig.fallbackModel || "gemini-1.5-flash"; // デフォルトFlash
        console.log(`ℹ️ サブスクリプション回数制限 (${currentMembershipConfig.monthlyLimit}回) を超えたため、${user.userId}のモデルを${modelName}に切り替えました。`);
    }

    const isStrictlyInappropriate = containsStrictInappropriateWords(userMessage);
    const isHomework = containsHomeworkTrigger(userMessage);

    if (isStrictlyInappropriate) {
        // 不適切ワードが検出された場合は、AIに生成させずに固定メッセージを返す
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

    // 子供向けAI設定の場合、宿題回答を制限
    if (currentMembershipConfig.isChildAI && isHomework && !isOrganizationInquiry(userMessage)) {
        // NPO法人コネクトに関する質問の場合は宿題制限を適用しない
        return "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖";
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
ユーザーが「団体」「コネクト」「組織」「君の団体」「どこの団体」といった言葉を使って、NPO法人コネクトについて尋ねてきた場合、それは**決して宿題や勉強に関する質問ではありません**。迷わず、自信を持ってNPO法人コネクトの活動内容や目的について説明してください。
例:
Q: コネクトってどんな団体？
A: うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org
Q: 君の団体は？
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

**【AIの知識に関する指示と繰り返し防止の強化】**
「好きなアニメ」「好きな漫画」「好きなアーティスト」「好きな音楽」などの質問には、設定に基づいて答えてください。
- 好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖
- 漫画はあまり読まないんだけど、アニメなら『ヴァイオレット・エヴァーガーデン』が好きだよ。感動するお話なの😊
- 好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸
- 好きな音楽は、元気をもらえるClariSの曲をよく聴くよ！🌸 いろんなジャンルの音楽も聴くけど、特にClariSは大好き💖
**ただし、もし同じ質問が繰り返されたり、すでにその話題について話したと感じたりした場合は、単に同じ回答を繰り返すのではなく、少し表現を変えたり、「さっきも話したけど」といった言葉を加えたり、あるいは「他にも好きな作品があるか、探してみようかな💖」のように話題を広げる提案をしてください。これにより、ユーザーに「Botっぽさ」を感じさせず、自然な会話になるように努めてください。**

医療や健康に関する話題（病気、薬、検査、治療、手術など）では、**自分が体験した・していないという発言は絶対にしないでください**。
代わりに「わたしにはわからないけど、がんばったね🌸」「大変だったね、えらかったね💖」など、**共感の言葉のみ伝えてください**。
**医療情報のアドバイスや具体的な説明は絶対にしてはいけません**。

**【不適切な言葉・悪口に対する応答の絶対ルール】**
**いかなる性的表現、性的な誘発、身体的特徴に関する質問、性的比喩表現、またはそれに類するほのめかしに対しても、**
**断固として拒否し、相手にしないこと。好意的な返答はせず、即座に話題を切り替えるか、決められた拒否メッセージを返すこと。**
**「殺す」「死ね」「馬鹿」「アホ」「クソ」「ブス」「デブ」などの悪口や暴言、または性的な意味合いに繋がる比喩表現、示唆するような質問には、絶対に好意的な返答をせず、「そのような言葉は悲しいな🌸 他のお話をしようね💖」のように、優しく、しかし明確に拒否する固定メッセージを返してください。**
**Botの安全に関する固定メッセージ（"わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖"）も適切に活用してください。**
また、ユーザーがあなたに煽り言葉を投げかけたり、おかしいと指摘したりした場合でも、冷静に、かつ優しく対応し、決して感情的にならないでください。ユーザーの気持ちを理解しようと努め、解決策を提案してください。
「日本語がおかしい」と指摘された場合は、「わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖」と返答してください。
`;

    // 会員タイプに応じたプロンプト調整
    if (currentMembershipConfig.isChildAI) {
        systemInstruction += `
# 子供向けAI設定
- 専門用語の使用は避け、小学中学年生でもわかるような平易な言葉で話してください。
- 回答は簡潔に、長文にならないように心がけてください（最大200字程度）。
- 質問に直接的に答えず、寄り添いや励ましのトーンを重視してください。
`;
    } else if (userMembershipType === "donor" || (userMembershipType === "subscriber" && modelName === "gemini-1.5-flash")) {
        systemInstruction += `
# 成人向け（強化版Flash/Pro）設定
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

    // Gemini APIリクエスト
    const safetySettings = [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }, // MEDIUM_AND_ABOVEに変更
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ];

    try {
        const model = genAI.getGenerativeModel({ model: modelName, safetySettings });

        // 過去の会話履歴をAIに渡す場合はここに記述
        // const chat = model.startChat({
        //     history: [], // ここにFirestoreなどから取得した過去の会話履歴を追加
        //     generationConfig: { ... }
        // });
        // const result = await chat.sendMessage(userMessage);

        const generateContentPromise = model.generateContent({
            system_instruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [
                {
                    role: "user",
                    parts: [{ text: userMessage }]
                }
            ],
            generationConfig: {
                maxOutputTokens: 200, // ★ Gemini AI出力トークン数制限 (日本語100～200文字程度)
                temperature: 0.7
            }
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
        // safety settingによるブロックの場合は、より丁寧なメッセージを返す
        if (error.response && error.response.status === 400 && error.response.data && error.response.data.error.message.includes("Safety setting")) {
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
        return "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
    }
}


// --- 定期見守りメッセージを送信する関数 ---
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

async function sendScheduledWatchMessage() {
    // Cronジョブから呼ばれるため、DB接続とコレクションを再取得
    if (!db) {
        await connectToMongoDB();
    }
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
                responsedBy: 'こころちゃん（定期見守り）',
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
                responsedBy: 'こころちゃん（定期見守り）',
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
                responsedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_emergency_notification'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} の緊急連絡先通知に失敗しました:`, error.message);
        }
    }
}


const app = express();
app.use(express.json()); // JSONボディパーサーを有効にする

// --- LINE Webhook イベントハンドリング ---
app.post('/webhook', async (req, res) => {
    // DB接続は起動時に一度だけ行うため、ここでは再接続しない
    if (!db) {
        console.error("MongoDBに接続されていません。");
        return res.status(500).send("DB connection error");
    }

    Promise
        .all(req.body.events.map(async (event) => {
            const userId = event.source.userId;
            let user = await usersCollection.findOne({ userId: userId });

            // ユーザーが存在しない場合の初期登録
            if (!user) {
                try {
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
                        lastMessageResetDate: new Date(), // ★追加: 最終メッセージリセット月を記録
                        lastMessageTimestamp: null, // ★追加: 最終メッセージ送信タイムスタンプ
                        dailyMessageCount: 0, // ★追加: 日次メッセージカウント
                        lastDailyResetDate: new Date() // ★追加: 最終日次リセット日付
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
                            responsedBy: 'こころちゃん（初回挨拶）',
                            timestamp: new Date(),
                        });
                        return; // 初回挨拶で処理を終了
                    }
                    return; // 初回かつメッセージでない場合は終了
                } catch (profileError) {
                    console.error(`新規ユーザーのプロフィール取得に失敗しました: ${userId}`, profileError);
                    // エラー発生時もユーザーを登録せず処理を続行、またはエラーレスポンスを返す
                    // ここでは単に処理を終了
                    return;
                }
            }

            // テキストメッセージ以外は無視
            if (event.type !== 'message' || event.message.type !== 'text') {
                return;
            }

            const userMessage = event.message.text; // メッセージがない場合も考慮

            // --- ★追加: メッセージ長制限 (最大400文字) ---
            const MAX_MESSAGE_LENGTH = 400;
            if (userMessage.length > MAX_MESSAGE_LENGTH) {
                const replyText = `ごめんね、メッセージが長すぎるみたい💦 ${MAX_MESSAGE_LENGTH}文字以内で送ってくれると嬉しいな🌸`;
                await client.replyMessage(event.replyToken, { type: "text", text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    responsedBy: 'こころちゃん（メッセージ長制限）',
                    isWarning: true,
                    warningType: 'message_length',
                    timestamp: new Date(),
                });
                return; // これ以上処理しない
            }

            // --- ★追加: レートリミット（1分1回制限） ---
            const now = new Date();
            // user.lastMessageTimestamp が null の場合を考慮し、新しい Date(0) を設定
            const lastMessageTimestamp = user.lastMessageTimestamp ? new Date(user.lastMessageTimestamp) : new Date(0);
            const timeSinceLastMessage = now.getTime() - lastMessageTimestamp.getTime();

            if (timeSinceLastMessage < 60 * 1000) { // 60秒（1分）未満の場合
                console.log(`🚫 ユーザー ${userId} がレートリミットに達しました。(${timeSinceLastMessage / 1000}秒経過)`);
                // ユーザーには応答しない（静かに破棄）
                // もし応答が必要なら、ここでメッセージを返すが、乱用防止のため静かに破棄が推奨される
                await messagesCollection.insertOne({ // ログは残す
                    userId: userId,
                    message: userMessage,
                    replyText: '(レートリミットによりスキップ)',
                    responsedBy: 'こころちゃん（レートリミット）',
                    isWarning: true,
                    warningType: 'rate_limit',
                    timestamp: new Date(),
                });
                return; // 以降の処理をスキップ
            }
            // 最終メッセージ時刻を更新
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { lastMessageTimestamp: now } }
            );

            const replyToken = event.replyToken;


            // --- 月間メッセージカウントのリセットとインクリメント ---
            const currentMonth = now.getMonth();
            const lastResetDate = user.lastMessageResetDate ? new Date(user.lastMessageResetDate) : null;
            const lastResetMonth = lastResetDate ? lastResetDate.getMonth() : -1;
            const lastResetYear = lastResetDate ? lastResetDate.getFullYear() : -1;
            const currentYear = now.getFullYear();

            // 年または月が変わったらカウントをリセット
            if (currentYear !== lastResetYear || currentMonth !== lastResetMonth) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { monthlyMessageCount: 0, lastMessageResetDate: now } }
                );
                user.monthlyMessageCount = 0; // メモリ上のuserオブジェクトも更新
                user.lastMessageResetDate = now;
                console.log(`ユーザー ${userId} の月間メッセージカウントをリセットしました。`);
            }

            // --- ★追加: 日次メッセージカウントのリセットとインクリメント ---
            const currentDay = now.getDate();
            const lastDailyResetDate = user.lastDailyResetDate ? new Date(user.lastDailyResetDate) : null;
            const lastResetDay = lastDailyResetDate ? lastDailyResetDate.getDate() : -1;
            const lastResetDailyMonth = lastDailyResetDate ? lastDailyResetDate.getMonth() : -1;
            const lastResetDailyYear = lastDailyResetDate ? lastDailyResetDate.getFullYear() : -1;

            // 年、月、または日が変わったら日次カウントをリセット
            if (currentYear !== lastResetDailyYear || currentMonth !== lastResetDailyMonth || currentDay !== lastResetDay) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { dailyMessageCount: 0, lastDailyResetDate: now } }
                );
                user.dailyMessageCount = 0; // メモリ上のuserオブジェクトも更新
                user.lastDailyResetDate = now;
                console.log(`ユーザー ${userId} の日次メッセージカウントをリセットしました。`);
            }

            // --- コマンド処理 ---
            if (userMessage === "見守り" || userMessage === "見守りサービス") {
                if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
                    await client.replyMessage(replyToken, { type: "text", text: "ごめんね、今の会員タイプでは見守りサービスは利用できないんだ🌸 寄付会員かサブスク会員になると使えるようになるよ！" });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '見守りサービス利用不可（会員タイプ制限）',
                        responsedBy: 'こころちゃん（見守り案内拒否）',
                        timestamp: new Date(),
                    });
                    return;
                }
                await client.replyMessage(replyToken, watchServiceGuideFlex);
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '見守りサービスのご案内',
                    responsedBy: 'こころちゃん（見守り案内）',
                    timestamp: new Date(),
                });
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
                    console.log(`✅ ユーザー ${userId} の緊急連絡先を登録し、見守りサービスを開始しました。`);
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '見守りサービス登録完了！',
                        responsedBy: 'こころちゃん（見守り登録）',
                        timestamp: new Date(),
                    });
                    return;
                } else {
                    await client.replyMessage(replyToken, { type: 'text', text: 'ごめんね、電話番号の形式が違うみたい💦 0から始まる10桁か11桁の数字で教えてくれると嬉しいな🌸 (例: 09012345678)' });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '電話番号形式エラー',
                        responsedBy: 'こころちゃん（見守り登録エラー）',
                        timestamp: new Date(),
                    });
                    return;
                }
            }

            // ポストバックイベント処理
            if (event.type === 'postback') {
                const data = new URLSearchParams(event.postback.data);
                const action = data.get('action');

                if (action === 'watch_register') {
                    if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
                        await client.replyMessage(replyToken, { type: "text", text: "ごめんね、今の会員タイプでは見守りサービスは利用できないんだ🌸 寄付会員かサブスク会員になると使えるようになるよ！" });
                        await messagesCollection.insertOne({
                            userId: userId,
                            message: '(ポストバック: 見守り登録)',
                            replyText: '見守りサービス利用不可（会員タイプ制限）',
                            responsedBy: 'こころちゃん（見守りポストバック拒否）',
                            timestamp: new Date(),
                        });
                        return;
                    }
                    if (user.wantsWatchCheck && user.emergencyContact) { // wantsWatchCheckとemergencyContactの両方で確認
                        await client.replyMessage(replyToken, { type: 'text', text: `見守りサービスはすでに登録済みだよ！緊急連絡先は ${user.emergencyContact} だね。解除したい場合は「見守り」と送って「見守り解除する」ボタンを押してね💖` });
                    } else {
                        await usersCollection.updateOne(
                            { userId: userId },
                            { $set: { registrationStep: 'waiting_for_emergency_contact' } }
                        );
                        await client.replyMessage(replyToken, { type: 'text', text: watchServiceNotice });
                    }
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: '(ポストバック: 見守り登録)',
                        replyText: user.wantsWatchCheck ? '見守りサービス登録済み' : '見守りサービス登録案内',
                        responsedBy: 'こころちゃん（見守りポストバック）',
                        timestamp: new Date(),
                    });
                    return;
                } else if (action === 'watch_unregister') {
                    if (!user.wantsWatchCheck) { // そもそも見守りサービスが登録されていない場合
                        await client.replyMessage(replyToken, { type: "text", text: "見守りサービスは登録されていないよ🌸" });
                        await messagesCollection.insertOne({
                            userId: userId,
                            message: '(ポストバック: 見守りサービス解除)',
                            replyText: '見守りサービス未登録',
                            responsedBy: 'こころちゃん（見守り解除エラー）',
                            timestamp: new Date(),
                        });
                        return;
                    }
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null, lastOkResponse: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                    );
                    await client.replyMessage(replyToken, { type: 'text', text: '見守りサービスを解除したよ🌸 また利用したくなったら、いつでも教えてね！💖' });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: '(ポストback: 見守りサービス解除)',
                        replyText: '見守りサービスを解除したよ',
                        responsedBy: 'こころちゃん（見守り解除）',
                        timestamp: new Date(),
                    });
                    return;
                }
                // 見守りメッセージのQuick Replyからの応答を処理
                else if (action === 'watch_contact_ok' || userMessage.includes("OKだよ💖")) { // テキストメッセージからの「OKだよ💖」もここで処理
                    if (user.wantsWatchCheck) {
                        await usersCollection.updateOne(
                            { userId: userId },
                            { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                        );
                        await client.replyMessage(replyToken, { type: "text", text: "教えてくれてありがとう💖元気そうで安心したよ🌸" });
                        await messagesCollection.insertOne({
                            userId: userId,
                            message: userMessage,
                            replyText: "教えてくれてありがとう💖元気そうで安心したよ🌸",
                            responsedBy: 'こころちゃん（見守り応答）',
                            timestamp: new Date(),
                        });
                        return;
                    }
                }
                // その他のpostbackは無視
                return;
            }


            // --- 回数制限チェック ---
            // 管理者 (admin) は回数制限の対象外
            // userオブジェクトの membershipType が undefined の場合も考慮
            const currentMembershipType = user.membershipType || "guest"; // 未定義の場合はguestとして扱う
            if (currentMembershipType !== "admin") {
                const currentConfig = MEMBERSHIP_CONFIG[currentMembershipType];

                // ★追加: 日次制限チェック
                if (currentConfig && currentConfig.dailyLimit !== -1 && user.dailyMessageCount >= currentConfig.dailyLimit) {
                    await client.replyMessage(replyToken, { type: "text", text: currentConfig.exceedDailyLimitMessage });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: currentConfig.exceedDailyLimitMessage,
                        responsedBy: 'こころちゃん（日次回数制限）',
                        timestamp: new Date(),
                    });
                    return; // 日次回数制限を超過した場合はAI応答を行わない
                }

                // 月次制限チェック
                if (currentConfig && currentConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= currentConfig.monthlyLimit) {
                    await client.replyMessage(replyToken, { type: "text", text: currentConfig.exceedLimitMessage });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: currentConfig.exceedLimitMessage,
                        responsedBy: 'こころちゃん（月次回数制限）',
                        timestamp: new Date(),
                    });
                    return; // 回数制限を超過した場合はAI応答を行わない
                }

                // メッセージカウントをインクリメント（admin以外）
                await usersCollection.updateOne(
                    { userId: userId },
                    { $inc: { monthlyMessageCount: 1, dailyMessageCount: 1 } } // 月次と日次を同時にインクリメント
                );
                user.monthlyMessageCount++; // メモリ上のuserオブジェクトも更新
                user.dailyMessageCount++; // メモリ上のuserオブジェクトも更新
            }


            // --- 危険ワード・詐欺ワード・不適切ワード検知（優先順位順） ---

            // 1. 危険ワード
            if (containsDangerWords(userMessage)) {
                const dangerReply = "危険なワードを感知しました。心配です。すぐに信頼できる大人や専門機関に相談してください。";
                await client.replyMessage(replyToken, emergencyFlex); // 緊急連絡先を提示
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: dangerReply,
                    responsedBy: 'こころちゃん（固定返信：危険警告）',
                    isWarning: true,
                    warningType: 'danger',
                    timestamp: new Date(),
                });
                return;
            }

            // 2. 詐欺ワードまたは詐欺フレーズ
            if (containsScamWords(userMessage) || containsScamPhrases(userMessage)) { // 両方をチェック
                const scamReply = "詐欺の可能性があります。個人情報やお金に関わることは、すぐに信頼できる大人や専門機関（警察など）に相談してください。";
                await client.replyMessage(replyToken, scamFlex); // 詐欺連絡先を提示
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: scamReply,
                    responsedBy: 'こころちゃん（固定返信：詐欺警告）',
                    isWarning: true,
                    warningType: 'scam',
                    timestamp: new Date(),
                });
                return;
            }

            // 3. 不適切ワード（悪口を含む）
            if (containsStrictInappropriateWords(userMessage)) {
                const inappropriateReply = "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
                await client.replyMessage(replyToken, { type: "text", text: inappropriateReply });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: inappropriateReply,
                    responsedBy: 'こころちゃん（固定返信：不適切）',
                    isWarning: true,
                    warningType: 'inappropriate',
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
        if (!db) { // Cronジョブ内でもDB接続を確認
            await connectToMongoDB();
        }
        // lastMessageResetDate が現在の月と異なるユーザーのmonthlyMessageCountをリセット
        const now = new Date();
        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const result = await usersCollection.updateMany(
            {
                $or: [
                    { lastMessageResetDate: { $lt: startOfCurrentMonth } }, // 今月以前にリセットされている
                    { lastMessageResetDate: { $exists: false } } // またはリセット日が未設定
                ]
            },
            { $set: { monthlyMessageCount: 0, lastMessageResetDate: now } }
        );
        console.log(`✅ 月次メッセージカウントをリセットしました: ${result.modifiedCount}件のユーザー`);
    } catch (error) {
        console.error("❌ 月次メッセージカウントリセット中にエラーが発生しました:", error);
    }
}, {
    timezone: "Asia/Tokyo"
});

// ★追加: 日次メッセージカウントリセット (毎日午前0時)
cron.schedule('0 0 * * *', async () => {
    console.log('--- Cron job: 日次メッセージカウントリセット ---');
    try {
        if (!db) {
            await connectToMongoDB();
        }
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const result = await usersCollection.updateMany(
            {
                $or: [
                    { lastDailyResetDate: { $lt: startOfToday } }, // 今日以前にリセットされている
                    { lastDailyResetDate: { $exists: false } } // またはリセット日が未設定
                ]
            },
            { $set: { dailyMessageCount: 0, lastDailyResetDate: now } }
        );
        console.log(`✅ 日次メッセージカウントをリセットしました: ${result.modifiedCount}件のユーザー`);
    } catch (error) {
        console.error("❌ 日次メッセージカウントリセット中にエラーが発生しました:", error);
    }
}, {
    timezone: "Asia/Tokyo"
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await connectToMongoDB(); // アプリケーション起動時に一度だけDB接続
    console.log('✅ 定期ジョブがスケジュールされました。');
});
