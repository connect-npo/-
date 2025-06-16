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
    "しにたい", "死にたい", "自殺", "消えたい", "リストカット", "オーバードーズ",
    "虐待", "パワハラ", "お金がない", "お金足りない", "貧乏", "死にそう", "DV", "無理やり",
    "殴られる", "たたかれる",
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

const whiteListWords = ["ラブライブ", "ラブレター", "ラブソング"];

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
    ["好きなアニメ", "わたしは『ヴァイオレット・エヴァーガーデン』が好きだよ🌸とっても感動するお話だよ💖"],
    ["好きなアーティスト", "わたしは『ClariS』が好きだよ💖元気が出る音楽がたくさんあるんだ🌸"],

    // こころちゃんの使い方テンプレート
    ["使い方", "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],
    ["ヘルプ", "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],
    ["メニュー", "こころちゃんのメニューだよ🌸 画面下のリッチメニューや、'見守り'とメッセージを送ってくれると、いろいろな機能が使えるよ😊"]
]);

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

function containsInappropriateWords(text) {
    const lowerText = text.toLowerCase();

    if (whiteListWords.some(w => lowerText.includes(w.toLowerCase()))) {
        return false;
    }

    return inappropriateWords.some(word => lowerText.includes(word));
}

function shouldLogMessage(text, userId, groupId) {
    if (isBotAdmin(userId)) {
        return false;
    }
    if (groupId && ["TEST_GROUP_ID", "GUARD_GROUP_ID"].includes(groupId)) {
        return false;
    }
    return containsDangerWords(text) || containsScamWords(text);
}


function checkSpecialReply(text) {
    const lowerText = text.toLowerCase();
    if (specialRepliesMap.has(text)) {
        return specialRepliesMap.get(text);
    }
    const sortedKeys = Array.from(specialRepliesMap.keys()).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        if (lowerText.includes(key.toLowerCase())) {
            return specialRepliesMap.get(key);
        }
    }
    return null;
}

// 【修正点1: 宿題検出ロジックの強化】
function isLikelyHomework(text) {
    const normalized = text.toLowerCase().replace(/\s/g, ''); // スペースを削除し、小文字に変換
    const equationPattern = /^[0-9xX+\-*/=^()]+$/; // 数字、x, X, 記号、括弧のみで構成されるパターン

    return (
        equationPattern.test(normalized) || // 数式パターンに合致
        text.includes('次の方程式') ||
        text.includes('この問題') ||
        text.includes('解きなさい') ||
        text.includes('答えを') ||
        text.includes('教えて') ||
        text.includes('問題：') ||
        text.includes('算数') ||
        text.includes('数学') ||
        text.includes('宿題') ||
        text.includes('テスト') ||
        // 追加: 特定の記号の組み合わせで宿題を判別
        (text.includes('x') && text.includes('=')) ||
        (text.includes('X') && text.includes('='))
    );
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
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

    // 【修正点2: Geminiのsystem promptにルール追加】
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

**【学習支援に関する重要なルール】**
- 数学や算数の問題（特に方程式）に対しては、**絶対に答えを言わずヒントだけを出す**ようにしてください。
- 以下のキーワードや記号が含まれるメッセージは宿題として扱い、答えを返してはいけません：
    "x=", "+", "-", "=", "解きなさい", "問題", "テスト", "宿題", "数学", "算数"
- 例外的に「1 + 1 は？」のような単純な問いには「1 + 1 = 2」のように答えても構いませんが、複雑な方程式はNGです。
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


    if (userMessage.includes("見守り登録します") || (event.type === 'postback' && event.postback.data === 'action=watch_register')) {
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

    if (userMessage.includes("見守り解除します") || (event.type === 'postback' && event.postback.data === 'action=watch_unregister')) {
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
            { $set: { lastOkResponse: new Date(), firstReminderSent: false, secondReminderSent: false } }
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
        userId: { $nin: BOT_ADMIN_IDS },
        $or: [
            { lastOkResponse: { $lt: threeDaysAgo } },
            { lastOkResponse: { $exists: false } }
        ],
        scheduledMessageSent: { $ne: true }
    }).toArray();

    console.log(`✉️ 初回見守りメッセージ送信対象ユーザー: ${usersForInitialMessage.length}名`);

    for (const user of usersForInitialMessage) {
        if (!user.emergencyContact) {
            console.log(`ユーザー ${user.userId} は緊急連絡先が未登録のためスキップします。`);
            continue;
        }

        try {
            const randomMessage = watchMessages[Math.floor(Math.random() * watchMessages.length)];
            await client.pushMessage(user.userId, {
                type: 'text',
                text: randomMessage,
                quickReply: {
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
        if (!user.emergencyContact) {
            continue;
        }
        try {
            const reminderMessage = "こころだよ🌸 前に送ったメッセージ、見てくれたかな？ 大丈夫か心配だよ💖";
            await client.pushMessage(user.userId, {
                type: 'text',
                text: reminderMessage,
                quickReply: {
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
        secondReminderSent: { $ne: true },
        lastOkResponse: { $lt: fiveHoursAgo },
        firstReminderTimestamp: { $lt: fiveHoursAgo }
    }).toArray();

    console.log(`🚨 緊急連絡先通知対象ユーザー: ${usersForEmergencyContact.length}名`);

    for (const user of usersForEmergencyContact) {
        if (!user.emergencyContact) {
            console.log(`ユーザー ${user.userId} は緊急連絡先が未登録のためスキップします。`);
            continue;
        }

        try {
            const userDisplayName = await getUserDisplayName(user.userId);
            const emergencyMessageForAdmin = `【こころちゃん見守りサービス 緊急通知🚨】\n\n${userDisplayName}様（ユーザーID: ${user.userId}）が3日以上応答していません。\n\n初回見守りメッセージ送信から24時間、さらにリマインドメッセージ送信から5時間経過しました。\n\n登録された緊急連絡先: ${user.emergencyContact} に連絡を取ってください。`;

            if (OFFICER_GROUP_ID && !isBotAdmin(user.userId)) {
                await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: emergencyMessageForAdmin });
                console.log(`✅ 管理者グループ ${OFFICER_GROUP_ID} に緊急通知を送信しました。`);
            } else if (!OFFICER_GROUP_ID) {
                console.warn("OFFICER_GROUP_ID が設定されていません。管理者への緊急通知をスキップします。");
            } else if (isBotAdmin(user.userId)) {
                console.log(`管理者ユーザー ${user.userId} のため、緊急通知はスキップしました。`);
            }

            const finalUserMessage = "ごめんなさい、応答が確認できなかったため、緊急連絡先に連絡しました。何かあったら、いつでもこころに話してね🌸";
            await client.pushMessage(user.userId, { type: 'text', text: finalUserMessage });
            console.log(`✅ ユーザー ${user.userId} に緊急連絡通知を送信しました。`);

            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { secondReminderSent: true } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 緊急通知)',
                replyText: emergencyMessageForAdmin,
                respondedBy: 'こころちゃん（緊急通知）',
                timestamp: now,
                logType: 'scheduled_watch_message_emergency'
            });

        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への緊急連絡通知送信に失敗しました:`, error.message);
        }
    }
    console.log('⏰ 定期見守りメッセージ送信処理を終了します。');
}


// --- LINE Bot Webhook処理 ---
app.post('/webhook', async (req, res) => {
    const db = await connectToMongoDB();
    const messagesCollection = db.collection("messages");
    const usersCollection = db.collection("users");

    let sourceId = null;
    let isGroupEvent = false;
    if (req.body.events && req.body.events.length > 0) {
        const firstEvent = req.body.events[0];
        if (firstEvent.source.type === 'user') {
            sourceId = firstEvent.source.userId;
        } else if (firstEvent.source.type === 'group') {
            sourceId = firstEvent.source.groupId;
            isGroupEvent = true;
        }
    }

    Promise
        .all(req.body.events.map(async event => {
            if (event.type !== 'message' || event.message.type !== 'text') {
                if (event.type === 'postback') {
                    const userId = event.source.userId;
                    const data = event.postback.data;
                    if (data === 'action=watch_register' || data === 'action=watch_unregister') {
                        return await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, data);
                    }
                }
                return Promise.resolve(null);
            }

            const userId = event.source.userId;
            const userMessage = event.message.text;
            let replyText = '';
            let respondedBy = 'こころちゃん（AI）';
            let logType = 'normal_chat';

            console.log(`🤖 メッセージ受信: ${userMessage} from ${userId}`);

            if (isBotAdmin(userId) || (isGroupEvent && ["TEST_GROUP_ID", "GUARD_GROUP_ID"].includes(sourceId))) {
                console.log(`⚠ 管理者またはテストグループからのメッセージのため、危険ワード通知をスキップします。`);
            } else {
                if (containsDangerWords(userMessage)) {
                    const userDisplayName = await getUserDisplayName(userId);
                    const dangerNotification = `⚠️ 危険ワード検出通知 ⚠️\n\nユーザー: ${userDisplayName} (ID: ${userId})\nメッセージ: ${userMessage}`;
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: dangerNotification });
                        console.log(`🚨 危険ワード検出につき、管理者グループ ${OFFICER_GROUP_ID} に通知しました。`);
                    }
                    replyText = "大丈夫…？ こころ、あなたのことが心配だよ🌸 辛い時は、無理しないでね。いつでも話を聞く準備はできているよ💖";
                    logType = 'danger_word_detected';
                    respondedBy = 'こころちゃん（危険ワード応答）';
                    await client.replyMessage(event.replyToken, { type: 'flex', altText: "緊急連絡先一覧", contents: emergencyFlex.contents });
                    return Promise.resolve(null);
                }

                if (containsScamWords(userMessage) || contextualScamPhrases.some(phrase => userMessage.toLowerCase().includes(phrase.toLowerCase()))) {
                    const userDisplayName = await getUserDisplayName(userId);
                    const scamNotification = `🚨 詐欺ワード検出通知 🚨\n\nユーザー: ${userDisplayName} (ID: ${userId})\nメッセージ: ${userMessage}`;
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: scamNotification });
                        console.log(`🚨 詐欺ワード検出につき、管理者グループ ${OFFICER_GROUP_ID} に通知しました。`);
                    }
                    replyText = "それは詐欺の可能性があるお話だよ…🌸 気になることがあったら、すぐに家族や信頼できる人に相談してね。絶対に一人で悩まないでね💖";
                    logType = 'scam_word_detected';
                    respondedBy = 'こころちゃん（詐欺ワード応答）';
                    await client.replyMessage(event.replyToken, { type: 'flex', altText: "詐欺の可能性", contents: scamFlex.contents });
                    return Promise.resolve(null);
                }
            }

            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
            if (handledByWatchService) {
                return Promise.resolve(null);
            }

            // 【宿題検出ロジックの適用】
            if (isLikelyHomework(userMessage)) {
                replyText = "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ヒントなら出せるよ😊";
                respondedBy = 'こころちゃん（宿題ガード）';
            } else {
                const specialReply = checkSpecialReply(userMessage);
                if (specialReply) {
                    replyText = specialReply;
                    respondedBy = 'こころちゃん（固定応答）';
                } else if (containsInappropriateWords(userMessage)) {
                    replyText = "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
                    respondedBy = 'こころちゃん（不適切ワードガード）';
                } else {
                    try {
                        replyText = await generateReply(userMessage);
                    } catch (error) {
                        console.error("Gemini生成エラー:", error);
                        replyText = "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
                        respondedBy = 'こころちゃん（AIエラー）';
                    }
                }
            }

            try {
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: respondedBy,
                    timestamp: new Date(),
                    logType: logType
                });
            } catch (replyError) {
                console.error("LINEへの返信エラー:", replyError.message);
            }
        }))
        .then(() => res.sendStatus(200))
        .catch((err) => {
            console.error("Webhookイベント処理中にエラー:", err);
            res.sendStatus(500);
        });
});

// 定期実行スケジューラー
cron.schedule('0 15 * * *', sendScheduledWatchMessage, {
    timezone: "Asia/Tokyo"
});

// アプリケーションのポート設定
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 サーバーがポート ${PORT} で起動しました`);
    await connectToMongoDB();
});
