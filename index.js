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
// OWNER_USER_IDを追加
const OWNER_USER_ID = process.env.OWNER_USER_ID; 
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : [];

// BOT_ADMIN_IDSにOWNER_USER_IDとOFFICER_GROUP_IDを合体させ、重複を排除
// ただし、OFFICER_GROUP_IDはグループIDなので、BOT_ADMIN_IDS（個人ID）とは別に扱うべきです。
// ここではBOT_ADMIN_IDSは個別の管理者IDとして扱い、OWNER_USER_IDを追加します。
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
    // ★追加：ネガティブワード・人物名への優先処理
    ["税金泥棒", "税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけるために使われないように頑張っているんだ💡"],
    ["松本博文", "松本理事長は、やさしさでみんなを守るために活動しているよ。心配なことがあれば、わたしにも教えてね🌱"],

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
    // 好きなアニメ・アーティストの回答をAIに任せるため、マップからは削除し、AIプロンプトで制御
    // ["好きなアニメ", "わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖"],
    // ["好きなアーティスト", "わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸"],

    // こころちゃんの使い方テンプレート
    ["使い方", "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],
    ["ヘルプ", "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],
    ["メニュー", "こころちゃんのメニューだよ🌸 画面下のリッチメニューや、'見守り'とメッセージを送ってくれると、いろいろな機能が使えるよ😊"]
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

// ★追加：ログを保存すべきか判定する関数 (危険ログの判定も含む)
function shouldLogMessage(text) {
    return containsDangerWords(text) || containsScamWords(text) || containsInappropriateWords(text);
}


function checkSpecialReply(text) {
    const lowerText = text.toLowerCase();
    // 完全一致を優先
    if (specialRepliesMap.has(text)) {
        return specialRepliesMap.get(text);
    }
    // 部分一致をチェック（長いキーから順に）
    const sortedKeys = Array.from(specialRepliesMap.keys()).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        if (lowerText.includes(key.toLowerCase())) {
            return specialRepliesMap.get(key);
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

    // HomeworkTriggerの検知はgenerateReplyの外で行い、返信は専用テンプレートで行うため、
    // ここではisHomeworkQuestionフラグは、より一般的な「学習支援の意図」と捉える
    // 具体的な宿題回答ロジックはgenerateReplyの外で処理される。
    // ここではAIが直接宿題の答えを出さないように、プロンプトで制御を強める。
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

**【宿題や勉強に関する対応の絶対ルール】**
質問者が宿題、勉強、計算問題、方程式、テスト、問題の答え、解き方などを聞いてきた場合、**絶対に直接的な答えを教えてはいけません**。
代わりに、**「わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦」**と説明し、**「でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖」**と、あくまでヒントを提供する姿勢を優しく伝えてください。
具体的な問題（例: 3x−5=2x+4）が出された場合は、**答えを教えずに、解き方のステップや考え方のヒントを優しく教えてください**。「まずはxの項を左辺に、定数項を右辺に集める」のように、**手順を具体的に促す**形が理想です。最終的な答えは言わないでください。

**【AIの知識に関する指示】**
「好きなアニメ」や「好きなアーティスト」などの質問には、設定に基づいて答えてください。
- 好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖
- 好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸

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
            const emergencyMessageForAdmin = `【こころちゃん見守りサービス 緊急通知🚨】\n\n${userDisplayName}様（ユーザーID: ${user.userId}）が3日以上応答していません。\n\n初回見守りメッセージ送信から24時間、さらにリマインドメッセージ送信から5時間経過しました。\n\n登録された緊急連絡先: ${user.emergencyContact} に連絡を取ってください。`;

            // 管理者グループに通知
            if (OFFICER_GROUP_ID) {
                await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: emergencyMessageForAdmin });
                console.log(`✅ 管理者グループ ${OFFICER_GROUP_ID} に緊急通知を送信しました。`);
            } else {
                console.warn("OFFICER_GROUP_ID が設定されていません。管理者への緊急通知をスキップします。");
            }

            // ユーザーに最後の通知
            const finalUserMessage = "ごめんなさい、応答が確認できなかったため、緊急連絡先に連絡しました。何かあったら、いつでもこころに話してね🌸";
            await client.pushMessage(user.userId, { type: 'text', text: finalUserMessage })
            
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { secondReminderSent: true, secondReminderTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 緊急連絡先通知)',
                replyText: finalUserMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_emergency'
            });

        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への緊急連絡通知に失敗しました:`, error.message);
        }
    }
    console.log('✅ 定期見守りメッセージ送信処理が完了しました。');
}

// --- LINE Messaging APIイベントハンドラー ---
app.post('/webhook', async (req, res) => {
    const db = await connectToMongoDB();
    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    Promise
        .all(req.body.events.map(event => handleEvent(event, usersCollection, messagesCollection)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

async function handleEvent(event, usersCollection, messagesCollection) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const { replyToken } = event;
    const userMessage = event.message.text;
    const userId = event.source.userId;

    // ★宿題系トリガーの検知とテンプレ返信
    if (containsHomeworkTrigger(userMessage)) {
        const homeworkReply = "宿題は自分の力で解くことがいちばん大切なんだよ🌸　ヒントなら出せるかもしれないから、どこで困ってるか教えてくれる？💖";
        await client.replyMessage(replyToken, { type: 'text', text: homeworkReply });

        await messagesCollection.insertOne({
            userId,
            message: userMessage,
            replyText: homeworkReply,
            respondedBy: 'こころちゃん（宿題対応）',
            timestamp: new Date(),
            logType: 'homework_guard'
        });
        return; // ここで処理を終了し、AIによる通常の返信は行わない
    }

    // 見守りサービス関連のメッセージを処理
    const isWatchServiceHandled = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
    if (isWatchServiceHandled) {
        return;
    }

    // 不適切ワードチェック
    const isInappropriate = containsInappropriateWords(userMessage);
    if (isInappropriate) {
        const replyText = "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await messagesCollection.insertOne({
            userId,
            message: userMessage,
            replyText,
            respondedBy: 'こころちゃん（不適切ワード）',
            timestamp: new Date(),
            logType: 'inappropriate_content_guard'
        });
        return;
    }

    // 危険ワードチェック
    if (containsDangerWords(userMessage)) {
        await client.replyMessage(replyToken, emergencyFlex);
        await messagesCollection.insertOne({
            userId,
            message: userMessage,
            replyText: '（緊急連絡先Flex表示）',
            respondedBy: 'こころちゃん（危険ワード）',
            timestamp: new Date(),
            logType: 'danger_word_triggered'
        });
        return;
    }

    // 詐欺ワードチェック
    if (containsScamWords(userMessage)) {
        await client.replyMessage(replyToken, scamFlex);
        await messagesCollection.insertOne({
            userId,
            message: userMessage,
            replyText: '（詐欺警告Flex表示）',
            respondedBy: 'こころちゃん（詐欺ワード）',
            timestamp: new Date(),
            logType: 'scam_word_triggered'
        });
        return;
    }

    // 固定返信のチェック
    const specialReply = checkSpecialReply(userMessage);
    if (specialReply) {
        await client.replyMessage(replyToken, { type: 'text', text: specialReply });
        await messagesCollection.insertOne({
            userId,
            message: userMessage,
            replyText: specialReply,
            respondedBy: 'こころちゃん（定型応答）',
            timestamp: new Date(),
            logType: 'special_reply'
        });
        return;
    }

    // その他のメッセージはGeminiで応答
    try {
        const replyText = await generateReply(userMessage);
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await messagesCollection.insertOne({
            userId,
            message: userMessage,
            replyText,
            respondedBy: 'こころちゃん（Gemini）',
            timestamp: new Date(),
            logType: 'gemini_reply'
        });
    } catch (error) {
        console.error("返信生成または送信中にエラーが発生しました:", error);
        const errorReply = "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
        await client.replyMessage(replyToken, { type: 'text', text: errorReply });
        await messagesCollection.insertOne({
            userId,
            message: userMessage,
            replyText: errorReply,
            respondedBy: 'こころちゃん（エラー）',
            timestamp: new Date(),
            logType: 'error_reply'
        });
    }
}


// --- 定期実行スケジューラー ---
// 毎日午後3時に実行
cron.schedule('0 15 * * *', async () => {
    console.log('Running scheduled job to send watch messages...');
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo" // 日本時間で設定
});


// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    await connectToMongoDB();
});
