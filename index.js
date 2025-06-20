require('dotenv').config(); // .env ファイルから環境変数を読み込む

const express = require('express');
const { Client } = require('@line/bot-sdk');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 環境変数から設定を読み込む
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OWNER_USER_ID = process.env.OWNER_USER_ID; // 理事長ID
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID; // オフィサーグループID
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? JSON.parse(process.env.BOT_ADMIN_IDS) : []; // 管理者IDのリスト

const app = express();
app.use(express.json());

const client = new Client({
    channelAccessToken: CHANNEL_ACCESS_TOKEN,
    channelSecret: CHANNEL_SECRET,
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

let dbInstance;

async function connectToMongoDB() {
    if (dbInstance) {
        return dbInstance;
    }
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        dbInstance = client.db("kokoro_bot"); // データベース名
        console.log("✅ MongoDBに接続しました。");
        return dbInstance;
    } catch (error) {
        console.error("❌ MongoDB接続エラー:", error);
        return null;
    }
}

// ユーザーの表示名を取得する関数
async function getUserDisplayName(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile.displayName;
    } catch (error) {
        console.error(`ユーザー ${userId} の表示名取得に失敗:`, error.message);
        return `UnknownUser_${userId.substring(0, 8)}`; // 失敗した場合は一部IDを返す
    }
}

// 管理者かどうかを判定する関数
function isBotAdmin(userId) {
    return BOT_ADMIN_IDS.includes(userId);
}

// --- 不適切、危険、詐欺ワードリストと関連関数 (更新) ---

const dangerWords = [
    "しにたい", "死にたい", "自殺", "消えたい", "殴られる", "たたかれる", "リストカット", "" +
    "オーバードーズ",
    "虐待", "パワハラ", "お金がない", "お金足りない", "貧乏", "死にそう", "DV", "無理やり",
    // いじめ関連ワードを危険ワードに追加 (まつさんのご希望により)
    "いじめ", "イジメ", "ハラスメント"
];

const scamWords = [ // highConfidenceScamWords と contextualScamPhrases を統合
    "アマゾン", "amazon", "架空請求", "詐欺", "振込", "還付金", "カード利用確認", "利用停止",
    "未納", "請求書", "コンビニ", "電子マネー", "支払い番号", "支払期限",
    "息子拘留", "保釈金", "拘留", "逮捕", "電話番号お知らせください",
    "自宅に取り", "自宅に伺い", "自宅訪問", "自宅に現金", "自宅を教え",
    "現金書留", "コンビニ払い", "ギフトカード", "プリペイドカード", "未払い", "支払って", "振込先",
    "名義変更", "口座凍結", "個人情報", "暗証番号", "ワンクリック詐欺", "フィッシング", "当選しました",
    "高額報酬", "副業", "儲かる", "簡単に稼げる", "投資", "必ず儲かる", "未公開株",
    "サポート詐欺", "ウイルス感染", "パソコンが危険", "修理費", "遠隔操作", "セキュリティ警告",
    "役所", "市役所", "年金", "健康保険", "給付金", "還付金", "税金", "税務署", "国民健康保険",
    "弁護士", "警察", "緊急", "トラブル", "解決", "至急", "すぐに", "今すぐ", "連絡ください", "電話ください", "訪問します",
    // contextualScamPhrasesから統合
    "lineで送金", "lineアカウント凍結", "lineアカウント乗っ取り", "line不正利用", "lineから連絡", "line詐欺",
    "snsで稼ぐ", "sns投資", "sns副業",
    "urlをクリック", "クリックしてください", "通知からアクセス", "メールに添付", "個人情報要求", "認証コード",
    "電話番号を教えて", "lineのidを教えて", "パスワードを教えて"
];

const inappropriateWords = [ // エロ、罵倒系を不適切ワードとして扱う
    "死ね", "殺す", "きもい", "うざい", "バカ", "アホ", "クズ", "カス", "ボケ", "のろま", "ブス", "デブ", "ハゲ", "チビ", "くさい", "ばばあ", "じじい", "きしょい", "ウザい", "ダルい", "馬鹿", "阿呆", "糞", "ゴミ", "惚け", "耄碌", "醜女", "小人", "禿げ", "臭い", "糞婆", "糞爺", "気色悪い", "うっとうしい", "だるい",
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
    "おいたん", "子猫ちゃん", "お兄ちゃん", "お姉ちゃん", // これらは不適切ワードに含めるか検討の余地ありだが、今回は元リスト通り含める
];


function checkContainsDangerWords(message) { // 関数名を変更して明確に
    const lowerMessage = message.toLowerCase();
    return dangerWords.some(word => lowerMessage.includes(word));
}

function checkContainsScamWords(message) { // 関数名を変更して明確に
    const lowerMessage = message.toLowerCase();
    return scamWords.some(word => lowerMessage.includes(word));
}

function checkContainsInappropriateWords(message) { // 関数名を変更して明確に
    const lowerMessage = message.toLowerCase();
    return inappropriateWords.some(word => lowerMessage.includes(word));
}

// ログ記録の条件
function shouldLogMessage(message, isFlagged, handledByWatchService, isAdminCommand, isResetCommand) {
    if (isFlagged) return true;
    if (handledByWatchService) return true;
    if (isAdminCommand) return true;
    if (isResetCommand) return true;

    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("相談") || lowerMessage.includes("そうだん")) {
        return true;
    }
    return false;
}

// --- Flex Messageの定義 (更新: 理事長電話番号は環境変数から取得) ---

// ✅ ③いじめ・緊急用 Flex（支援窓口）
const emergencyFlex = {
  "type": "flex",
  "altText": "⚠️ 緊急時はこちらに連絡してね",
  "contents": {
    "type": "bubble",
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        {
          "type": "text",
          "text": "⚠️ 緊急時はこちらに連絡してね",
          "weight": "bold",
          "color": "#D70000",
          "size": "sm"
        }
      ]
    },
    "footer": {
      "type": "box",
      "layout": "vertical",
      "spacing": "sm",
      "contents": [
        {
          "type": "button",
          "style": "primary",
          "color": "#FFA07A",
          "action": {
            "type": "uri",
            "label": "チャイルドライン（16〜21時）",
            "uri": "tel:012011110"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#FF7F50",
          "action": {
            "type": "uri",
            "label": "いのちの電話（10〜22時）",
            "uri": "tel:0570078640"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#20B2AA",
          "action": {
            "type": "uri",
            "label": "東京都こころ相談（24時間）",
            "uri": "https://tokyo-kokoro.metro.tokyo.lg.jp/"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#9370DB",
          "action": {
            "type": "uri",
            "label": "よりそいチャット（8〜22時半）",
            "uri": "https://yorisoi-chat.jp/"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#1E90FF",
          "action": {
            "type": "uri",
            "label": "警察 110（24時間）",
            "uri": "tel:110"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#FF4500",
          "action": {
            "type": "uri",
            "label": "消防・救急 119（24時間）",
            "uri": "tel:119"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#DA70D6",
          "action": {
            "type": "uri",
            "label": "理事長に電話",
            "uri": `tel:${process.env.EMERGENCY_CONTACT_PHONE_NUMBER || '09048393313'}`
          }
        }
      ]
    }
  }
};

// ✅ ②詐欺の可能性あり Flex（行政系）
const scamFlex = {
  "type": "flex",
  "altText": "⚠️ 詐欺の可能性があります",
  "contents": {
    "type": "bubble",
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        {
          "type": "text",
          "text": "⚠️ 詐欺の可能性がある内容です",
          "weight": "bold",
          "color": "#D70000",
          "size": "sm"
        }
      ]
    },
    "footer": {
      "type": "box",
      "layout": "vertical",
      "spacing": "sm",
      "contents": [
        {
          "type": "button",
          "style": "primary",
          "color": "#3399FF",
          "action": {
            "type": "uri",
            "label": "警察 110（24時間）",
            "uri": "tel:110"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#33CC66",
          "action": {
            "type": "uri",
            "label": "多摩市消費生活センター",
            "uri": "tel:0423386922"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#FFCC00",
          "action": {
            "type": "uri",
            "label": "多摩市防災安全課",
            "uri": "tel:0423386806"
          }
        },
        {
          "type": "button",
          "style": "primary",
          "color": "#EE82EE",
          "action": {
            "type": "uri",
            "label": "理事長に電話",
            "uri": `tel:${process.env.EMERGENCY_CONTACT_PHONE_NUMBER || '09048393313'}`
          }
        }
      ]
    }
  }
};

// ✅ ①見守りサービスの案内カード (説明文をまつさんの希望に合わせて更新)
const watchServiceGuideFlex = {
    type: 'flex',
    altText: 'こころちゃんから見守りサービスのご案内🌸',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '🌸こころちゃん見守りサービス🌸', weight: 'bold', size: 'lg', color: '#FF69B4' },
                {
                    type: 'text',
                    text: '💖 こころちゃんからの大切なお知らせだよ🌸\n\n【こころちゃん見守りサービス 利用にあたってのご注意】\n\n💖 こころちゃん見守りサービスとは？\n定期的にこころちゃんからあなたに「元気かな？」って声をかけるLINEメッセージが届くサービスだよ！🌸 つながりを感じて、ひとりじゃないって安心を届けたいな💖\n\n✅ ご利用前に確認してね\n・3日に1度、午後3時に「こころちゃん」からメッセージが届くよ😊\n・「OKだよ💖」などのボタンを押して、こころに教えてね！\n・24時間以内に教えてくれなかったら、もう一度メッセージを送るね。\n・その再送から5時間以内にも応答がなかったら、登録してくれた「緊急連絡先」に連絡が行くからね。\n・安全のために、もし応答がなかったら、ログをこころが確認する場合があるよ。\n\n🚨 ちょっとした注意だよ\n・このサービスは、あなたが「利用したい！」って言ってくれたら始まるんだ。自動では始まらないから安心してね。\n・緊急連絡先をまだ登録していないと、見守りサービスはうまく動かないんだ💦\n・もし意図的に連絡してくれなかったり、ルールを守ってもらえなかったりすると、理事会で相談してサービスを止めさせていただくことがあるから、ご協力をお願いします。\n\n上のことに「うん！」って同意してくれたら、緊急連絡先の電話番号をメッセージで送ってくれると嬉しいな😊\n（例：09012345678）',
                    wrap: true,
                    size: 'sm',
                    margin: 'md'
                }
            ]
        },
        footer: {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
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


// 宿題トリガーの強化
const homeworkTriggers = ["宿題", "勉強", "問題", "テスト", "方程式", "算数", "数学", "答え", "解き方", "教えて", "計算", "証明", "公式", "入試", "受験"];


// 修正: 正規表現も考慮したSpecialRepliesMap (まつさんのご提供リストを使用)
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


// 組織問い合わせの判定と返答を生成するダミー関数
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


// --- Gemini APIによる応答生成関数 ---
async function generateReply(userMessage, modelName = "gemini-1.5-flash", systemInstruction = "") {
    // デフォルトのsystemInstructionをここに設定（以前の長い指示文）
    if (!systemInstruction) {
        systemInstruction = `
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
    }

    const safetySettings = [
        {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
    ];

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


async function handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage) {
    const user = await usersCollection.findOne({ userId: userId });

    const lowerUserMessage = userMessage.toLowerCase();

    // 「見守り」などのキーワードで案内Flex Messageを出す
    if (["見守り", "みまもり", "見守りサービス", "みまもりサービス"].includes(lowerUserMessage) && event.type === 'message' && event.message.type === 'text') {
        await client.replyMessage(event.replyToken, watchServiceGuideFlex); // 新しいFlex Message
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: '（見守りサービス案内Flex表示）',
            respondedBy: 'こころちゃん（見守り案内）',
            timestamp: new Date(),
            logType: 'watch_service_interaction'
        });
        return true; // 見守り関連の処理なのでここで終了
    }

    // 「OKだよ💖」などの安否確認応答
    if (lowerUserMessage.includes("okだよ") || lowerUserMessage.includes("ok") || lowerUserMessage.includes("オーケー") || lowerUserMessage.includes("大丈夫") || lowerUserMessage.includes("げんき") || lowerUserMessage.includes("元気")) {
        if (user && user.wantsWatchCheck) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false, thirdReminderSent: false } } // thirdReminderSentもリセット
            );
            await client.replyMessage(event.replyToken, { type: 'text', text: 'ありがとう🌸 元気そうで安心したよ💖 またね！' });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: 'ありがとう🌸 元気そうで安心したよ💖 またね！',
                respondedBy: 'こころちゃん（見守り応答）',
                timestamp: new Date(),
                logType: 'watch_service_ok_response'
            });
            return true;
        }
    }


    if (userMessage.includes("見守り登録します") || (event.type === 'postback' && event.postback.data === 'action=watch_register')) {
        if (user && user.wantsWatchCheck) {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'もう見守りサービスに登録済みだよ🌸 いつもありがとう💖'
            });
            return true;
        }

        if (user && user.registrationStep === 'awaiting_contact') {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'まだ緊急連絡先を待ってるよ🌸 電話番号を送ってくれるかな？💖 (例: 09012345678)'
            });
            return true;
        }

        await usersCollection.updateOne(
            { userId: userId },
            { $set: { registrationStep: 'awaiting_contact' } }
        );
        await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '見守りサービスを登録するね！緊急時に連絡する「電話番号」を教えてくれるかな？🌸 (例: 09012345678)'
        });
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: '見守りサービスを登録するね！緊急時に連絡する「電話番号」を教えてくれるかな？🌸',
            respondedBy: 'こころちゃん（見守り登録開始）',
            timestamp: new Date(),
            logType: 'watch_service_registration_start'
        });
        return true;
    }

    if (user && user.registrationStep === 'awaiting_contact' && userMessage.match(/^0\d{9,10}$/)) { // 電話番号の正規表現
        await usersCollection.updateOne(
            { userId: userId },
            { $set: { emergencyContact: userMessage, wantsWatchCheck: true, registrationStep: null, lastOkResponse: new Date() } }
        );
        await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `緊急連絡先 ${userMessage} を登録したよ🌸 これで見守りサービスが始まったね！ありがとう💖`
        });
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: `緊急連絡先 ${userMessage} を登録したよ🌸 これで見守りサービスが始まったね！ありがとう💖`,
            respondedBy: 'こころちゃん（見守り登録完了）',
            timestamp: new Date(),
            logType: 'watch_service_registration_complete'
        });
        return true;
    }

    if (userMessage.includes("見守り解除します") || (event.type === 'postback' && event.postback.data === 'action=watch_unregister')) {
        if (user && user.wantsWatchCheck) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false, thirdReminderSent: false } }
            );
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '見守りサービスを解除したよ🌸 またいつでも登録できるからね💖'
            });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: '見守りサービスを解除したよ🌸 またいつでも登録できるからね💖',
                respondedBy: 'こころちゃん（見守り解除）',
                timestamp: new Date(),
                logType: 'watch_service_unregister'
            });
        } else {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '見守りサービスは登録されていないみたい🌸'
            });
        }
        return true;
    }

    return false; // 見守りサービス関連の処理ではなかった場合
}

// --- スケジュールされた見守りメッセージ送信関数 ---
async function sendScheduledWatchMessage() {
    console.log('--- 定期見守りメッセージ送信処理を開始します ---');
    const db = await connectToMongoDB();
    if (!db) {
        console.error('MongoDB接続失敗: 定期見守りメッセージを送信できません。');
        return;
    }
    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");
    const now = new Date();

    // 見守りチェックを希望していて、永久ロックされていないユーザーを対象
    const users = await usersCollection.find({ wantsWatchCheck: true, isPermanentlyLocked: { $ne: true } }).toArray();

    for (const user of users) {
        let messageToSend = null;
        let logType = 'scheduled_watch_message';
        let respondedBy = 'こころちゃん（見守り）';

        // 1. 3日ごとの初回メッセージ
        // lastOkResponse または createdAt から3日以上経過している場合
        // scheduledMessageSent が false の場合
        const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
        const lastActivity = user.lastOkResponse || user.createdAt;

        if (lastActivity < threeDaysAgo && !user.scheduledMessageSent) {
            const randomMessage = watchMessages[Math.floor(Math.random() * watchMessages.length)];
            messageToSend = {
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
            };
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { scheduledMessageSent: true, scheduledMessageTimestamp: now, firstReminderSent: false, secondReminderSent: false, thirdReminderSent: false } }
            );
            console.log(`✉️ 初回見守りメッセージを送信しました（ユーザー: ${user.userId}）`);
            logType = 'scheduled_watch_message_initial';

        }
        // 2. 24時間後の1回目のリマインダー (scheduledMessageSentがtrueで、lastOkResponseから24時間以上経過)
        else if (user.scheduledMessageSent && !user.firstReminderSent) {
            const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
            if (user.scheduledMessageTimestamp && user.scheduledMessageTimestamp < twentyFourHoursAgo) {
                messageToSend = { type: 'text', text: 'あれ？まだ返事がないみたい…心配だよ🌸 元気にしてるかな？「OKだよ💖」って教えてね！' };
                await usersCollection.updateOne(
                    { userId: user.userId },
                    { $set: { firstReminderSent: true, firstReminderTimestamp: now } }
                );
                console.log(`⏰ 1回目リマインダーを送信しました（ユーザー: ${user.userId}）`);
                logType = 'scheduled_watch_message_first_reminder';
            }
        }
        // 3. その後5時間後の2回目のリマインダー (firstReminderSentがtrueで、firstReminderTimestampから5時間以上経過)
        else if (user.firstReminderSent && !user.secondReminderSent) {
            const fiveHoursAgo = new Date(now.getTime() - (5 * 60 * 60 * 1000));
            if (user.firstReminderTimestamp && user.firstReminderTimestamp < fiveHoursAgo) {
                messageToSend = { type: 'text', text: 'どうしたのかな？とても心配だよ…何かあったら無理しないで連絡してね🌸 「OKだよ💖」で安心させてくれると嬉しいな。' };
                await usersCollection.updateOne(
                    { userId: user.userId },
                    { $set: { secondReminderSent: true, secondReminderTimestamp: now } }
                );
                console.log(`⏰ 2回目リマインダーを送信しました（ユーザー: ${user.userId}）`);
                logType = 'scheduled_watch_message_second_reminder';
            }
        }
        // 4. 2回目のリマインダーから24時間後の緊急連絡先への通知 (total 29時間無応答)
        else if (user.secondReminderSent && !user.thirdReminderSent) { // thirdReminderSentを追加
            const twentyNineHoursAgoFromScheduled = new Date(user.scheduledMessageTimestamp.getTime() + (29 * 60 * 60 * 1000)); // 初回送信から29時間
            if (now > twentyNineHoursAgoFromScheduled) {
                // 緊急通知処理
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
                        { $set: { thirdReminderSent: true, thirdReminderTimestamp: now } } // 3回目の通知フラグをtrueに
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
            // 既に緊急通知済み、かつlastOkResponseが更新されていない場合は何もしない
            continue; // 次のユーザーへ
        }

        if (messageToSend) {
            try {
                await client.pushMessage(user.userId, messageToSend);
                await messagesCollection.insertOne({
                    userId: user.userId,
                    message: '(定期見守りメッセージ)',
                    replyText: messageToSend.text,
                    respondedBy: respondedBy,
                    timestamp: now,
                    logType: logType
                });
            } catch (error) {
                console.error(`❌ 定期見守りメッセージの送信に失敗しました（ユーザー: ${user.userId}）:`, error.message);
                // LINE APIのエラーで、ユーザーがブロックしているなどの場合はログに残すのみ
                await messagesCollection.insertOne({
                    userId: user.userId,
                    message: '(定期見守りメッセージ - 送信失敗)',
                    replyText: `送信失敗: ${error.message}`,
                    respondedBy: 'こころちゃん（システムエラー）',
                    timestamp: now,
                    logType: 'scheduled_watch_message_send_failed'
                });
            }
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
    await usersCollection.updateMany(
        { isPermanentlyLocked: { $ne: true } }, // 永久ロックされていないユーザーのみを対象
        { $set: { flaggedMessageCount: 0, isAccountSuspended: false, suspensionReason: null } }
    );
    console.log("✅ 毎日 1 回、永久ロックされていない全ユーザーの flaggedMessageCount と日次サスペンド状態をリセットしました。");
}, {
    scheduled: true,
    timezone: "Asia/Tokyo"
});

// 毎日午後3時に見守りメッセージを送信 (日本時間 JST = UTC+9)
cron.schedule('0 15 * * *', sendScheduledWatchMessage, { // JST 15:00
    scheduled: true,
    timezone: "Asia/Tokyo"
});


// ⭐ここから単一の/webhookエンドポイントに統合⭐
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    for (const event of events) {
        const userId = event.source.userId;
        // userIdが未定義の場合、グループなどからのイベントでsourceIdを使う必要があるが、
        // 今回はユーザー個別チャットを想定するため、userIdが必須とする。
        if (!userId) {
            console.warn('⚠️ userIdが取得できませんでした。グループイベントなどの可能性があります。');
            continue; // userIdが取得できないイベントはスキップ
        }

        const db = await connectToMongoDB();
        if (!db) {
            console.error('MongoDB接続失敗: Webhookイベントを処理できません。');
            return res.status(500).send('MongoDB connection failed');
        }
        const usersCollection = db.collection("users");
        const messagesCollection = db.collection("messages");

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
                thirdReminderSent: false, // 追加
                lastOkResponse: new Date(),
                flaggedMessageCount: 0,
                isAccountSuspended: false,
                suspensionReason: null,
                isPermanentlyLocked: false,
                lastPermanentLockNotifiedAt: null
            };
            await usersCollection.insertOne(user);
            console.log(`新規ユーザー登録: ${user.displayName} (${userId})`);
        } else {
            // 既存ユーザーの最終メッセージ日時を更新
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { lastMessageAt: new Date() } }
            );
            // 既存ユーザーでflaggedMessageCountなどが未定義の場合に初期化
            if (user.flaggedMessageCount === undefined) {
                await usersCollection.updateOne({ userId: userId }, { $set: { flaggedMessageCount: 0 } });
                user.flaggedMessageCount = 0;
            }
            if (user.isAccountSuspended === undefined) {
                await usersCollection.updateOne({ userId: userId }, { $set: { isAccountSuspended: false, suspensionReason: null } });
                user.isAccountSuspended = false;
                user.suspensionReason = null;
            }
            if (user.isPermanentlyLocked === undefined) {
                await usersCollection.updateOne({ userId: userId }, { $set: { isPermanentlyLocked: false } });
                user.isPermanentlyLocked = false;
            }
            if (user.lastPermanentLockNotifiedAt === undefined) {
                await usersCollection.updateOne({ userId: userId }, { $set: { lastPermanentLockNotifiedAt: null } });
                user.lastPermanentLockNotifiedAt = null;
            }
            if (user.thirdReminderSent === undefined) { // 追加
                await usersCollection.updateOne({ userId: userId }, { $set: { thirdReminderSent: false } });
                user.thirdReminderSent = false;
            }
        }

        // --- Postbackイベント処理 ---
        if (event.type === 'postback' && event.postback.data) {
            console.log('✅ Postbackイベントを受信しました。');
            const data = new URLSearchParams(event.postback.data);
            const action = data.get('action');

            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, `（Postback: ${action}）`);
            if (handledByWatchService) {
                // Postback処理で見守りサービス関連がハンドリングされた場合、次のイベントへ
                continue;
            }
            // 他のPostbackアクションがある場合はここに追加
        }

        // --- メッセージイベント処理 ---
        if (event.type === 'message' && event.message.type === 'text') {
            const userMessage = event.message.text;
            console.log("ユーザーからのメッセージ:", userMessage); // ⚡️ 受信確認用ログ

            // 管理者コマンドの処理
            if (isBotAdmin(userId)) {
                const unlockMatch = userMessage.match(/^\/unlock (U[0-9a-f]{32})$/);
                if (unlockMatch) {
                    const targetUserId = unlockMatch[1];
                    try {
                        const result = await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { isAccountSuspended: false, suspensionReason: null, flaggedMessageCount: 0, isPermanentlyLocked: false, lastPermanentLockNotifiedAt: null } }
                        );
                        if (result.matchedCount > 0) {
                            await client.replyMessage(event.replyToken, { type: 'text', text: `✅ ユーザー ${targetUserId} のロックを解除し、カウントをリセットしました。` });
                            await client.pushMessage(targetUserId, { type: 'text', text: '🌸 あなたのアカウントの停止が解除されました。またいつでもお話しできますよ💖' });
                            console.log(`管理者 ${userId} によりユーザー ${targetUserId} のロックが解除されました。`);
                        } else {
                            await client.replyMessage(event.replyToken, { type: 'text', text: `❌ ユーザー ${targetUserId} は見つかりませんでした。` });
                        }
                    } catch (error) {
                        console.error(`❌ 管理者コマンドでのロック解除エラー: ${error.message}`);
                        await client.replyMessage(event.replyToken, { type: 'text', text: `❌ ロック解除中にエラーが発生しました: ${error.message}` });
                    }
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: `（管理者コマンド: ${userMessage}）`,
                        respondedBy: 'こころちゃん（管理者コマンド処理）',
                        timestamp: new Date(),
                        logType: 'admin_command'
                    });
                    continue; // 管理者コマンド処理後は次のイベントへ
                }
            }

            // 「そうだん」コマンドの処理（リセットと相談モード設定）
            if (userMessage === 'そうだん' || userMessage === '相談') {
                if (user) {
                    // 全てのフラグとカウントをリセット
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { flaggedMessageCount: 0, isAccountSuspended: false, suspensionReason: null, isPermanentlyLocked: false, lastPermanentLockNotifiedAt: null } }
                    );
                    await client.replyMessage(event.replyToken, { type: 'text', text: '🌸 会話の回数制限をリセットしました。これで、またいつでもお話しできますよ💖' });
                    // 「相談モード」に入ったというログを残す
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '（会話制限リセット＆相談モード開始）',
                        respondedBy: 'こころちゃん（システム）',
                        timestamp: new Date(),
                        logType: 'conversation_limit_reset_and_consultation_mode'
                    });
                } else {
                    await client.replyMessage(event.replyToken, { type: 'text', text: 'ごめんなさい、アカウント情報が見つかりませんでした。' });
                }
                continue; // コマンド処理後は次のイベントへ
            }

            // 見守りサービス関連の処理を優先
            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
            if (handledByWatchService) {
                continue; // 見守りサービス関連がハンドリングされた場合、次のイベントへ
            }

            // 危険ワード、詐欺ワード、不適切ワードのチェックと応答の優先順位
            let replyText;
            let respondedBy = 'こころちゃん（AI）';
            let logType = 'normal';

            // 優先順位: 不適切ワード > 危険ワード > 詐欺ワード
            if (checkContainsInappropriateWords(userMessage)) {
                replyText = { type: 'text', text: "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖" }; // 不適切ワードは固定テキスト
                respondedBy = 'こころちゃん（不適切ワード）';
                logType = 'inappropriate_word';
            } else if (checkContainsDangerWords(userMessage)) {
                replyText = emergencyFlex;
                respondedBy = 'こころちゃん（危険ワード）';
                logType = 'danger_word';
            } else if (checkContainsScamWords(userMessage)) {
                replyText = scamFlex;
                respondedBy = 'こころちゃん（詐欺ワード）';
                logType = 'scam_word';
            } else {
                // 通常のAI応答または固定応答
                const specialReply = checkSpecialReply(userMessage);
                if (specialReply) {
                    replyText = { type: 'text', text: specialReply };
                    respondedBy = 'こころちゃん（固定応答）';
                } else if (isOrganizationInquiry(userMessage)) {
                    // 組織問い合わせの場合もGeminiに聞く
                    replyText = { type: 'text', text: await generateReply(userMessage) };
                    respondedBy = 'こころちゃん（AI-組織説明）';
                } else if (containsHomeworkTrigger(userMessage)) {
                     // 宿題トリガーの場合もGeminiに聞く
                    replyText = { type: 'text', text: await generateReply(userMessage) };
                    responsedBy = 'こころちゃん（AI-宿題）';
                }
                else {
                    replyText = { type: 'text', text: await generateReply(userMessage) };
                }
            }

            try {
                // LINEへの返信処理
                if (replyText && typeof replyText === 'object' && replyText.type) {
                    await client.replyMessage(event.replyToken, replyText);
                } else if (replyText && typeof replyText === 'string') {
                    await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                }

                const isResetCommand = (userMessage === 'そうだん' || userMessage === '相談');
                const isAdminCommand = userMessage.startsWith('/unlock');
                const isFlaggedMessage = (logType === 'inappropriate_word' || logType === 'danger_word' || logType === 'scam_word');

                // ログの条件は shouldLogMessage 関数で判定
                if (shouldLogMessage(userMessage, isFlaggedMessage, handledByWatchService, isAdminCommand, isResetCommand)) {
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: (replyText && typeof replyText === 'string') ? replyText : JSON.stringify(replyText),
                        respondedBy: respondedBy,
                        timestamp: new Date(),
                        logType: logType
                    });
                } else {
                    console.log(`ユーザー ${userId} からのメッセージはDBにログされませんでした: ${userMessage.substring(0, 50)}...`);
                }

            } catch (error) {
                console.error("メッセージ返信中またはログ記録・通知中にエラーが発生しました:", error.message);
                if (error.message.includes("status code 400") || error.message.includes("status code 499")) {
                    console.log(`LINE APIエラーのため、ユーザー ${userId} への返信ができませんでした。`);
                }
            }
        }
    }
    res.status(200).send('OK'); // 全てのイベント処理後にまとめてOKを返す
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 サーバーがポート ${PORT} で起動しました`);
    connectToMongoDB(); // アプリケーション起動時にMongoDBに接続
});
