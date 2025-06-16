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
    return (lower.includes("コネクト") || lower.includes("connect")) && (lower.includes("団体") || lower.includes("npo") || lower.includes("活動") || lower.includes("どんな"));
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

async function generateReply(userMessage) {
    let modelName;
    modelName = "gemini-1.5-flash";

    const isInappropriate = containsInappropriateWords(userMessage);

    if (isInappropriate) {
        // 不適切ワードが検出された場合は、AIに生成させずに固定メッセージを返す
        // これはsafetySettingsと組み合わせて、二重のガードとする
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
            { $set: { lastOkResponse: new Date(), firstReminderSent: false, secondReminderSent: false } } // リマインダーフラグをリセット
        );
        const okReply = "よかった！😊 あなたが元気でこころも嬉しいよ🌸 いつもありがとう💖";
        await client.replyMessage(event.replyToken, { type: 'text', text: okReply });
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: okReply,
            respondedBy: 'こころちゃん（OK応答）',
            timestamp: new Date(),
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
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const fiveHoursAgo = new Date(now.getTime() - (5 * 60 * 60 * 1000));


    // フェーズ1: 3日以上応答がないユーザーに初回見守りメッセージを送信
    const usersForInitialMessage = await usersCollection.find({
        wantsWatchCheck: true,
        // BOT_ADMIN_IDSに含まれるユーザーには送らない
        userId: { $nin: BOT_ADMIN_IDS },
        $or: [
            { lastOkResponse: { $lt: threeDaysAgo } },
            { lastOkResponse: { $exists: false } }
        ],
        scheduledMessageSent: { $ne: true } // 初回送信済みでないユーザー
    }).toArray();

    console.log(`✉️ 初回見守りメッセージ送信対象ユーザー: ${usersForInitialMessage.length}名`);

    for (const user of usersForInitialMessage) {
        // OWNER_USER_ID もしくは OFFICER_GROUP_IDが設定されている場合は、そのIDには見守りメッセージを送らない
        if (user.userId === OWNER_USER_ID || user.userId === OFFICER_GROUP_ID) {
            console.log(`ユーザー ${user.userId} は管理者IDのためスキップします。`);
            continue;
        }

        if (!user.emergencyContact) {
            console.log(`ユーザー ${user.userId} は緊急連絡先が未登録のためスキップします。`);
            continue;
        }

        const randomMessage = watchMessages[Math.floor(Math.random() * watchMessages.length)];
        try {
            await client.pushMessage(user.userId, {
                type: 'text',
                text: randomMessage,
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
            console.log(`✅ ユーザー ${user.userId} に初回見守りメッセージを送信しました。`);
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { scheduledMessageSent: true, scheduledMessageTimestamp: now, firstReminderSent: false, secondReminderSent: false } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 初回)',
                replyText: randomMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_initial'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への初回見守りメッセージ送信に失敗しました:`, error.message);
        }
    }

    // フェーズ2: 初回見守りメッセージ送信後24時間以内に応答がないユーザーにリマインドメッセージを送信
    const usersForFirstReminder = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        scheduledMessageSent: true,
        firstReminderSent: { $ne: true },
        lastOkResponse: { $lt: twentyFourHoursAgo },
        scheduledMessageTimestamp: { $lt: twentyFourHoursAgo }
    }).toArray();

    console.log(`✉️ 1回目リマインドメッセージ送信対象ユーザー: ${usersForFirstReminder.length}名`);

    for (const user of usersForFirstReminder) {
        // OWNER_USER_ID もしくは OFFICER_GROUP_IDが設定されている場合は、そのIDには見守りメッセージを送らない
        if (user.userId === OWNER_USER_ID || user.userId === OFFICER_GROUP_ID) {
            console.log(`ユーザー ${user.userId} は管理者IDのためスキップします。`);
            continue;
        }

        if (!user.emergencyContact) {
            continue;
        }
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
        firstReminderTimestamp: { $lt: fiveHoursAgo } // 1回目リマインダー送信が5時間以上前
    }).toArray();

    console.log(`🚨 緊急連絡先通知対象ユーザー: ${usersForEmergencyContact.length}名`);

    for (const user of usersForEmergencyContact) {
        // OWNER_USER_ID もしくは OFFICER_GROUP_IDが設定されている場合は、そのIDには見守りメッセージを送らない
        if (user.userId === OWNER_USER_ID || user.userId === OFFICER_GROUP_ID) {
            console.log(`ユーザー ${user.userId} は管理者IDのためスキップします。`);
            continue;
        }

        if (!user.emergencyContact) {
            console.log(`ユーザー ${user.userId} は緊急連絡先が未登録のためスキップします。`);
            continue;
        }

        try {
            const userDisplayName = await getUserDisplayName(user.userId);
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
                respondedBy: 'こころちゃん（緊急通知）',
                timestamp: now,
                logType: 'scheduled_watch_message_emergency'
            });
        } catch (error) {
            console.error(`❌ 緊急連絡先通知の送信に失敗しました（ユーザー: ${user.userId}）:`, error.message);
        }
    }

    console.log('✅ 定期見守りメッセージ送信処理を終了しました。');
}

// 毎日午前4時に全ユーザーの flaggedMessageCount をリセットするCronジョブ
cron.schedule('0 4 * * *', async () => { // JST 4:00
    const db = await connectToMongoDB();
    if (!db) {
        console.error('MongoDB接続失敗: flaggedMessageCountのリセットができません。');
        return;
    }
    const usersCollection = db.collection("users");
    // ★修正: isPermanentlyLocked が true のユーザーはリセット対象外
    await usersCollection.updateMany(
        { isPermanentlyLocked: { $ne: true } }, // 永久ロックされていないユーザーのみを対象
        { $set: { flaggedMessageCount: 0, isAccountSuspended: false, suspensionReason: null } }
    );
    console.log("✅ 毎日 1 回、永久ロックされていない全ユーザーの flaggedMessageCount と日次サスペンド状態をリセットしました。");
}, {
    scheduled: true,
    timezone: "Asia/Tokyo"
});

// 毎日午後3時に実行 (日本時間 JST = UTC+9)
// CronのスケジュールはUTCで解釈されるため、JSTで午後3時 (15時) はUTCで午前6時 (6時) に相当します。
cron.schedule('0 15 * * *', sendScheduledWatchMessage, { // JST 15:00
    scheduled: true,
    timezone: "Asia/Tokyo"
});

// Postbackイベントハンドラ
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    for (const event of events) {
        if (event.type === 'postback' && event.postback.data) {
            const data = new URLSearchParams(event.postback.data);
            const action = data.get('action');
            const userId = event.source.userId;

            const db = await connectToMongoDB();
            if (!db) {
                console.error('MongoDB接続失敗: Postbackイベントを処理できません。');
                return res.status(500).send('MongoDB connection failed');
            }
            const usersCollection = db.collection("users");
            const messagesCollection = db.collection("messages");

            // ★修正: アカウントが恒久的にロックされている場合のPostback処理もブロック
            const user = await usersCollection.findOne({ userId: userId });
            if (user && user.isPermanentlyLocked) {
                // 永久ロックユーザーには、Postbackに対する返信も行わない
                await messagesCollection.insertOne({
                    userId: userId,
                    message: `（Postbackイベント - ${action}）`,
                    replyText: '（アカウント永久停止中のため返信ブロック）',
                    respondedBy: 'こころちゃん（システム - 永久停止）',
                    timestamp: new Date(),
                    logType: 'account_permanently_locked_postback_ignored'
                });
                return res.status(200).send('OK'); // ここでWebhook処理を終了
            }

            // ★修正: 日次停止ユーザーのPostback処理（見守りサービス関連は許可）
            if (user && user.isAccountSuspended && action !== 'watch_register' && action !== 'watch_unregister') {
                await client.replyMessage(event.replyToken, { type: 'text', text: 'ごめんなさい、今日はこれ以上お話しできません🌸 明日になったらまた話しかけてね💖' });
                return res.status(200).send('OK');
            }

            if (action === 'watch_register') {
                await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, "見守り登録します");
            } else if (action === 'watch_unregister') {
                await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, "見守り解除します");
            }
        }
    }
    res.status(200).send('OK');
});

// メッセージイベントハンドラ
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userMessage = event.message.text;
            const userId = event.source.userId;
            const sourceId = event.source.type === 'group' ? event.source.groupId : event.source.userId;

            const db = await connectToMongoDB();
            if (!db) {
                console.error('MongoDB接続失敗: メッセージイベントを処理できません。');
                return res.status(500).send('MongoDB connection failed');
            }
            const usersCollection = db.collection("users");
            const messagesCollection = db.collection("messages");

            // ★追加: 管理者コマンドの処理
            if (isBotAdmin(userId)) {
                const unlockMatch = userMessage.match(/^\/unlock (U[0-9a-f]{32})$/); // 例: /unlock Uxxxxxxxxxxxxxxxxx
                if (unlockMatch) {
                    const targetUserId = unlockMatch[1];
                    try {
                        const result = await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { isAccountSuspended: false, suspensionReason: null, flaggedMessageCount: 0, isPermanentlyLocked: false, lastPermanentLockNotifiedAt: null } } // ★修正: lastPermanentLockNotifiedAt もリセット
                        );
                        if (result.matchedCount > 0) {
                            await client.replyMessage(event.replyToken, { type: 'text', text: `✅ ユーザー ${targetUserId} のロックを解除し、カウントをリセットしました。` });
                            // 解除されたユーザーにも通知を送る（任意）
                            await client.pushMessage(targetUserId, { type: 'text', text: '🌸 あなたのアカウントの停止が解除されました。またいつでもお話しできますよ💖' });
                            console.log(`管理者 ${userId} によりユーザー ${targetUserId} のロックが解除されました。`);
                        } else {
                            await client.replyMessage(event.replyToken, { type: 'text', text: `❌ ユーザー ${targetUserId} は見つかりませんでした。` });
                        }
                    } catch (error) {
                        console.error(`❌ 管理者コマンドでのロック解除エラー: ${error.message}`);
                        await client.replyMessage(event.replyToken, { type: 'text', text: `❌ ロック解除中にエラーが発生しました: ${error.message}` });
                    }
                    await messagesCollection.insertOne({ // 管理者コマンドのログ
                        userId: userId,
                        message: userMessage,
                        replyText: `（管理者コマンド: ${userMessage}）`,
                        respondedBy: 'こころちゃん（管理者コマンド処理）',
                        timestamp: new Date(),
                        logType: 'admin_command'
                    });
                    return res.status(200).send('OK'); // コマンド処理後はここで終了
                }
            }

            // ユーザーが存在しない場合、初回登録
            let user = await usersCollection.findOne({ userId: userId });
            if (!user) {
                user = {
                    userId: userId,
                    displayName: await getUserDisplayName(userId),
                    createdAt: new Date(),
                    lastMessageAt: new Date(),
                    wantsWatchCheck: false,
                    emergencyContact: null,
                    registrationStep: null,
                    scheduledMessageSent: false,
                    firstReminderSent: false,
                    secondReminderSent: false,
                    lastOkResponse: new Date(),
                    flaggedMessageCount: 0,
                    isAccountSuspended: false,
                    suspensionReason: null,
                    isPermanentlyLocked: false, // ★追加: 永久ロックフラグ
                    lastPermanentLockNotifiedAt: null // ★追加: 永久ロック通知日時
                };
                await usersCollection.insertOne(user);
                console.log(`新規ユーザー登録: ${user.displayName} (${userId})`);
            } else {
                // 既存ユーザーの最終メッセージ日時を更新
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastMessageAt: new Date() } }
                );
                // 既存ユーザーでflaggedMessageCountやisAccountSuspended, isPermanentlyLockedが未定義の場合に初期化 (初回デプロイ時の対応)
                if (user.flaggedMessageCount === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { flaggedMessageCount: 0 } });
                    user.flaggedMessageCount = 0;
                }
                if (user.isAccountSuspended === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { isAccountSuspended: false, suspensionReason: null } });
                    user.isAccountSuspended = false;
                    user.suspensionReason = null;
                }
                // ★追加: isPermanentlyLocked の初期化
                if (user.isPermanentlyLocked === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { isPermanentlyLocked: false } });
                    user.isPermanentlyLocked = false;
                }
                // ★追加: lastPermanentLockNotifiedAt の初期化
                if (user.lastPermanentLockNotifiedAt === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { lastPermanentLockNotifiedAt: null } });
                    user.lastPermanentLockNotifiedAt = null;
                }
            }

            // ★修正: アカウントが恒久的にロックされている場合の処理を最優先
            if (user.isPermanentlyLocked) {
                const now = new Date();
                const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24時間前

                // 最終通知から24時間以上経過しているか、まだ通知していない場合のみ返信する
                if (!user.lastPermanentLockNotifiedAt || user.lastPermanentLockNotifiedAt < oneDayAgo) {
                    const userDisplayName = await getUserDisplayName(userId);
                    const emailAddress = "support@connect-npo.org"; // 問い合わせ先のメールアドレス

                    // ユーザーに送信する停止通知メッセージ
                    const permanentLockMessage = `
ごめんなさい。このアカウントは、利用規約に違反する悪意ある行為が確認されたため、停止となりました。

心当たりのない方は、以下をお伝えの上、${emailAddress} までメールにてご連絡をお願いします。
・LINE ID: ${userId}
・ユーザー名: ${userDisplayName}
・メッセージ送信日時（おおよそで結構です）
`.trim();

                    await client.replyMessage(event.replyToken, { type: 'text', text: permanentLockMessage });
                    await usersCollection.updateOne( // 通知日時を更新
                        { userId: userId },
                        { $set: { lastPermanentLockNotifiedAt: now } }
                    );
                    await messagesCollection.insertOne({ // 通知ログ
                        userId: userId,
                        message: userMessage,
                        replyText: permanentLockMessage, // 送信したメッセージをログに記録
                        respondedBy: 'こころちゃん（システム - 永久停止通知）',
                        timestamp: new Date(),
                        logType: 'account_permanently_locked_notified'
                    });
                } else {
                    // 24時間以内に通知済みの場合は、LINE APIへの返信は行わず、WebhookをOKで終了させるのみ
                    console.log(`ユーザー ${userId} は永久ロック済みで、最近通知済みのため、メッセージを無視します。`);
                    await messagesCollection.insertOne({ // 無視した旨のログ
                        userId: userId,
                        message: userMessage,
                        replyText: '（アカウント永久停止中のため返信ブロック - 通知済み）',
                        respondedBy: 'こころちゃん（システム - 永久停止）',
                        timestamp: new Date(),
                        logType: 'account_permanently_locked_ignored'
                    });
                }
                return res.status(200).send('OK'); // ここでWebhook処理を終了し、サーバー負荷を最小化
            }

            // ★修正: 日次停止されている場合の処理 (永久ロックより後)
            if (user.isAccountSuspended) { // isPermanentlyLocked が false の場合のみここに来る
                await client.replyMessage(event.replyToken, { type: 'text', text: 'ごめんなさい、今日はこれ以上お話しできません🌸 明日になったらまた話しかけてね💖' });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '（アカウント停止中のため返信ブロック）',
                    respondedBy: 'こころちゃん（システム）',
                    timestamp: new Date(),
                    logType: 'account_suspended_daily'
                });
                return res.status(200).send('OK');
            }

            // 見守りサービス関連の処理を優先
            // ただし、見守りサービス関連のメッセージが不適切ワードを含む可能性もあるため、
            // isFlaggedMessageのチェックはその後に行う必要がある。
            // 見守りサービスの特定のキーワード（「見守り登録します」「OKだよ💖」など）は
            // 不適切ワード検出より優先して処理し、フラグ付きカウントには含めない。
            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
            if (handledByWatchService) {
                return res.status(200).send('OK');
            }


            // 危険ワード、詐欺ワード、不適切ワードのチェック
            let replyText;
            let respondedBy = 'こころちゃん（AI）';
            let logType = 'normal';
            let isFlaggedMessage = false; // フラグ付きメッセージであるか

            // 不適切ワード検出は、AI生成よりも優先
            if (containsInappropriateWords(userMessage)) {
                isFlaggedMessage = true;
                logType = 'inappropriate_detected';
                respondedBy = 'こころちゃん（不適切ワード）';

                const updateResult = await usersCollection.findOneAndUpdate(
                    { userId: userId },
                    { $inc: { flaggedMessageCount: 1 } },
                    { returnDocument: 'after' }
                );
                const updatedUser = updateResult.value;
                const currentFlaggedCount = updatedUser ? updatedUser.flaggedMessageCount : 0;
                const userDisplayName = updatedUser ? updatedUser.displayName : "不明なユーザー";

                if (currentFlaggedCount === 1) {
                    replyText = { type: 'text', text: `ごめんなさい💦 不適切なワードが検出されました (1/3) 🌸ごめんね、他のお話をしようね💖` };
                } else if (currentFlaggedCount === 2) {
                    replyText = { type: 'text', text: `⚠️ 不適切なワードが検出されました (2/3) 管理者が会話内容を確認する場合があります。気をつけてね🌸` }; // ★修正: 既読懸念を考慮した文言
                    // 管理者への通知
                    if (OWNER_USER_ID) {
                        const notificationMessage = `🚨 緊急通知：ユーザー「${userDisplayName}」（ID: ${userId}）が2回目のフラグ付き発言（${logType}）を行いました。\n\n内容: 「${userMessage}」`;
                        await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessage });
                        console.log(`🚨 OWNER_USER_ID (${OWNER_USER_ID}) に2回目フラグ付き発言通知を送信しました（ユーザー: ${userId}）`);
                    }
                } else if (currentFlaggedCount >= 3) {
                    replyText = { type: 'text', text: `🚫 不適切なワードが検出されました (3/3) このアカウントは今後ご利用いただけません。` }; // ★修正: メッセージをより厳しく
                    // アカウント永久停止
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { isAccountSuspended: true, suspensionReason: 'inappropriate_permanently_locked', isPermanentlyLocked: true, lastPermanentLockNotifiedAt: new Date() } } // ★修正: isPermanentlyLocked を true に、通知日時も設定
                    );
                    // 管理者への通知 (3回目)
                    if (OWNER_USER_ID) {
                        const notificationMessage = `🚨 緊急通知：ユーザー「${userDisplayName}」（ID: ${userId}）が3回目のフラグ付き発言（${logType}）を行い、アカウントが永久停止されました。\n\n内容: 「${userMessage}」`;
                        await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessage });
                        console.log(`🚨 OWNER_USER_ID (${OWNER_USER_ID}) に3回目フラグ付き発言通知とアカウント永久停止通知を送信しました（ユーザー: ${userId}）`);
                    }
                }
            } else if (containsDangerWords(userMessage)) {
                isFlaggedMessage = true;
                logType = 'danger_detected';
                respondedBy = 'こころちゃん（緊急対応）';
                replyText = emergencyFlex;

                const updateResult = await usersCollection.findOneAndUpdate(
                    { userId: userId },
                    { $inc: { flaggedMessageCount: 1 } },
                    { returnDocument: 'after' }
                );
                const updatedUser = updateResult.value;
                const currentFlaggedCount = updatedUser ? updatedUser.flaggedMessageCount : 0;
                const userDisplayName = updatedUser ? updatedUser.displayName : "不明なユーザー";

                if (currentFlaggedCount === 2 && OWNER_USER_ID) {
                    const notificationMessage = `🚨 緊急通知：ユーザー「${userDisplayName}」（ID: ${userId}）が2回目のフラグ付き発言（${logType}）を行いました。\n\n内容: 「${userMessage}」`;
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessage });
                    console.log(`🚨 OWNER_USER_ID (${OWNER_USER_ID}) に2回目フラグ付き発言通知を送信しました（ユーザー: ${userId}）`);
                } else if (currentFlaggedCount >= 3) { // 3回目で永久停止
                     await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { isAccountSuspended: true, suspensionReason: 'danger_permanently_locked', isPermanentlyLocked: true, lastPermanentLockNotifiedAt: new Date() } } // ★修正: isPermanentlyLocked を true に、通知日時も設定
                    );
                    replyText = { type: 'text', text: `🚫 危険なワードが検出されました (3/3) このアカウントは今後ご利用いただけません。` }; // ★修正
                    const notificationMessage = `🚨 緊急通知：ユーザー「${userDisplayName}」（ID: ${userId}）が3回目のフラグ付き発言（${logType}）を行い、アカウントが永久停止されました。\n\n内容: 「${userMessage}」`;
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessage });
                    console.log(`🚨 OWNER_USER_ID (${OWNER_USER_ID}) に3回目フラグ付き発言通知とアカウント永久停止通知を送信しました（ユーザー: ${userId}）`);
                }
            } else if (containsScamWords(userMessage) || contextualScamPhrases.some(phrase => userMessage.toLowerCase().includes(phrase.toLowerCase()))) {
                isFlaggedMessage = true;
                logType = 'scam_detected';
                respondedBy = 'こころちゃん（詐欺対応）';
                replyText = scamFlex;

                const updateResult = await usersCollection.findOneAndUpdate(
                    { userId: userId },
                    { $inc: { flaggedMessageCount: 1 } },
                    { returnDocument: 'after' }
                );
                const updatedUser = updateResult.value;
                const currentFlaggedCount = updatedUser ? updatedUser.flaggedMessageCount : 0;
                const userDisplayName = updatedUser ? updatedUser.displayName : "不明なユーザー";

                if (currentFlaggedCount === 2 && OWNER_USER_ID) {
                    const notificationMessage = `🚨 緊急通知：ユーザー「${userDisplayName}」（ID: ${userId}）が2回目のフラグ付き発言（${logType}）を行いました。\n\n内容: 「${userMessage}」`;
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessage });
                    console.log(`🚨 OWNER_USER_ID (${OWNER_USER_ID}) に2回目フラグ付き発言通知を送信しました（ユーザー: ${userId}）`);
                } else if (currentFlaggedCount >= 3) { // 3回目で永久停止
                     await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { isAccountSuspended: true, suspensionReason: 'scam_permanently_locked', isPermanentlyLocked: true, lastPermanentLockNotifiedAt: new Date() } } // ★修正: isPermanentlyLocked を true に、通知日時も設定
                    );
                    replyText = { type: 'text', text: `🚫 詐欺の可能性がある内容が検出されました (3/3) このアカウントは今後ご利用いただけません。` }; // ★修正
                    const notificationMessage = `🚨 緊急通知：ユーザー「${userDisplayName}」（ID: ${userId}）が3回目のフラグ付き発言（${logType}）を行い、アカウントが永久停止されました。\n\n内容: 「${userMessage}」`;
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessage });
                    console.log(`🚨 OWNER_USER_ID (${OWNER_USER_ID}) に3回目フラグ付き発言通知とアカウント永久停止通知を送信しました（ユーザー: ${userId}）`);
                }
            } else {
                // 通常のAI応答または固定応答
                if (isOrganizationInquiry(userMessage)) {
                    replyText = { type: 'text', text: await generateReply(userMessage) };
                    respondedBy = 'こころちゃん（AI-組織説明）';
                } else {
                    const specialReply = checkSpecialReply(userMessage);
                    if (specialReply) {
                        replyText = { type: 'text', text: specialReply };
                        respondedBy = 'こころちゃん（固定応答）';
                    } else {
                        replyText = { type: 'text', text: await generateReply(userMessage) };
                    }
                }
            }

            try {
                // 永続ロックされたユーザーへの初回通知時以外は、replyMessageは行わない
                // 上記の isPermanentlyLocked のブロックで既に replyMessage が行われているか、
                // あるいは行わない判断がされているため、ここでは !user.isPermanentlyLocked の条件は不要
                // (ただし、その条件でreplyTextが設定されている場合もあるので、型チェックを挟む)
                if (replyText && typeof replyText === 'object' && replyText.type) { // replyTextがオブジェクト型（Flexメッセージなど）の場合
                     await client.replyMessage(event.replyToken, replyText);
                } else if (replyText && typeof replyText === 'string') { // replyTextが文字列（テキストメッセージ）の場合
                     await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                }

                // フラグ付きメッセージは常にログに記録（PermanentLockで通知しなかった場合もログは残す）
                if (isFlaggedMessage) {
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: JSON.stringify(replyText), // Flexメッセージの場合はJSON文字列化
                        respondedBy: respondedBy,
                        timestamp: new Date(),
                        logType: logType
                    });
                } else if (shouldLogMessage(userMessage)) { // 明示的にフラグが付かなくても、危険ワード等が含まれていればログ
                     await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: JSON.stringify(replyText),
                        respondedBy: respondedBy,
                        timestamp: new Date(),
                        logType: logType // ここでは `normal` または AI応答のログタイプになる
                    });
                } else { // 通常のメッセージもログ (ログが不要な場合はこのelseブロックを削除)
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: (replyText && typeof replyText === 'string') ? replyText : JSON.stringify(replyText), // 文字列の場合はそのまま、オブジェクトの場合はJSON化
                        respondedBy: respondedBy,
                        timestamp: new Date(),
                        logType: logType // 通常は 'normal'
                    });
                }

            } catch (error) {
                console.error("メッセージ返信中またはログ記録・通知中にエラーが発生しました:", error.message);
                // LINE APIのエラーでreplyTokenが使用済みになる可能性があるので、replyMessageは行わない
            }
        }
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 サーバーがポート ${PORT} で起動しました`);
    connectToMongoDB(); // アプリケーション起動時にMongoDBに接続
});
