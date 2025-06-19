// index.js

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { LineClient } = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MongoClient } = require('mongodb');
const cron = require('node-cron'); // cronジョブ用

const app = express();
app.use(bodyParser.json());

// 環境変数
const config = {
    channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const GEMINI_API_KEY = process.env.YOUR_GEMINI_API_KEY;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID; // 理事長グループID
const OWNER_USER_ID = process.env.OWNER_USER_ID; // ボットオーナーのユーザーID (任意で設定)
const MONGODB_URI = process.env.MONGODB_URI; // MongoDBのURI
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : []; // ボット管理者ID (カンマ区切りで複数指定可能)

const client = new LineClient(config);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

let dbInstance;

// MongoDB接続関数
async function connectToMongoDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        dbInstance = client.db("kokoro_bot_db"); // データベース名を指定
        console.log("MongoDB に通常に接続されました。");
    } catch (error) {
        console.error("MongoDB 接続エラー:", error);
        process.exit(1); // 接続失敗時はプロセスを終了
    }
}

// ユーザーの表示名を取得する関数
async function getUserDisplayName(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile.displayName;
    } catch (error) {
        console.error("LINEユーザーの表示名取得エラー:", error);
        return "Unknown User"; // 取得できない場合はUnknown User
    }
}

// 会員種別ごとのメッセージ上限とAIモデル定義
const MEMBERSHIP_CONFIG = {
    "guest": { maxMessages: 5, model: "gemini-1.5-flash", systemInstructionModifier: "default", exceedLimitMessage: "ごめんなさい、今月の会話回数の上限に達してしまったみたい💦\nまた来月になったらお話しできるから、それまで待っててくれると嬉しいな💖" },
    "free": { maxMessages: 20, model: "gemini-1.5-flash", systemInstructionModifier: "children", exceedLimitMessage: "ごめんなさい、今月の会話回数の上限に達してしまったみたい💦\nまた来月になったらお話しできるから、それまで待っててくれると嬉しいな💖" },
    "donor": { maxMessages: Infinity, model: "gemini-1.5-flash", systemInstructionModifier: "enhanced", exceedLimitMessage: "" }, // 寄付会員は制限なし
    "subscriber": { maxMessages: 20, model: "gemini-1.5-pro", fallbackModel: "gemini-1.5-flash", fallbackModifier: "enhanced", systemInstructionModifier: "default", exceedLimitMessage: "ごめんなさい、今月のProモデルでの会話回数の上限に達してしまったみたい💦\nこれからは通常の会話モード（Gemini Flash）で対応するね！🌸" },
    "admin": { maxMessages: Infinity, model: "gemini-1.5-pro", systemInstructionModifier: "default", exceedLimitMessage: "" } // 管理者は制限なし
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
    [/日本語がおかしい/i, "わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖"],

    // 見守りに関する応答を追加
    [/見守り|みまもり/i, "watch_service_guide_flex_trigger"] // ここで特別なトリガー文字列を返すようにする
]);

// 宿題トリガーの強化
const homeworkTriggers = ["宿題", "勉強", "問題", "テスト", "方程式", "算数", "数学", "答え", "解き方", "教えて", "計算", "証明", "公式", "入試", "受験"];

// 危険ワード
const dangerWords = [
    "死にたい", "消えたい", "自殺", "つらい", "苦しい", "助けて", "殺す", "死ね", "いじめ",
    "辛い", "苦しい", "しにたい", "きえたい", "じさつ", "たすけて", "ころす", "しね", "イジメ",
    "もうだめ", "生きてる意味ない", "終わりにしたい", "しんどい", "だるい", "病んだ"
];

// 詐欺ワード
const scamWords = [
    "還付金", "未払い", "当選", "儲かる", "クリック", "副業", "融資", "投資詐欺", "儲け話", "高額報酬",
    "必ず儲かる", "楽して稼ぐ", "簡単にお金", "儲かる話", "投資話", "怪しい儲け話", "振り込め詐欺",
    "オレオレ詐欺", "架空請求", "詐欺"
];

// 不適切ワード（セクハラ、暴力、差別など）
const inappropriateWords = [
    "エロ", "セックス", "セクハラ", "H", "AV", "オ〇ニー", "セックス", "レイプ", "強姦", "売春", "買春", "性行為",
    "わいせつ", "ポルノ", "アダルト", "おっぱい", "ちんこ", "まんこ", "ペニス", "ヴァギナ", "フェラ", "クンニ",
    "射精", "オーガズム", "童貞", "処女", "媚薬", "痴漢", "盗撮", "風俗", "ソープランド", "デリヘル", "バイブ", "TENGA",
    "暴行", "暴力", "殺害", "虐待", "差別", "ハラスメント", "ぶっ殺す", "ぶっ飛ばす", "爆破", "テロ",
    "クソ", "死ね", "馬鹿", "アホ", "キモい", "ブス", "デブ", "カス", "ボケ", "糞", "ゴミ",
    "チョン", "ガイジン", "土人", "障害者", "池沼", "精神異常", "売女", "ビッチ", "レズ", "ホモ", "ニューハーフ", "おかま",
    "レイシスト", "ヘイト", "ファック", "シット", "クズ", "チンカス", "変態", "ロリコン", "ショタコン", "近親相姦",
    "児童ポルノ", "獣姦", "スカトロ", "アナル", "スカトロ", "アナル", "SM", "緊縛", "監禁", "拷問", "薬物", "麻薬",
    "シャブ", "覚醒剤", "大麻", "コカイン", "ヘロイン", "クスリ", "売人", "ジャンキー", "オーバードーズ",
    // 性的暗示を含むフレーズや質問を追加
    "パンツ見せて", "下着の色は？", "胸の大きさは？", "お尻触っていい？", "抱きしめて", "キスして", "愛してる",
    "身体見せて", "裸の写真", "誘惑して", "興奮する", "感じてる？", "もっと知りたい", "夜のこと", "セフレ", "愛人",
    "彼女になって", "彼氏になって", "結婚して", "プロポーズ", "どこまでなら許す？", "変なこと", "いやらしいこと",
    "性的", "セックス", "オナニー", "ムラムラ", "欲求不満", "発情", "性欲", "性的関係", "愛撫", "絶頂", "勃起", "射精",
    "バイブ", "コンドーム", "避妊", "挿入", "口淫", "手コキ", "足コキ", "アナルセックス", "乱交", "グループセックス",
    "アヘ顔", "潮吹き", "潮噴き", "痙攣", "喘ぎ声", "イく", "イク", "精液", "膣", "竿", "亀頭", "クリトリス", "尿道",
    "肛門", "淫語", "ふたなり", "トランスジェンダー", "異性装", "性転換", "性同一性障害", "インターセックス", "アセクシャル",
    "パンセクシャル", "ポリセクシャル", "クィア", "ノンバイナリー", "ジェンダーフルイド", "アジェンダー", "シスジェンダー",
    "ホモフォビア", "トランスフォビア", "バイフォビア", "インターフォビア", "アセクシュアルフォビア", "パンセクシュアルフォビア",
    "ポリセクシュアルフォビア", "クィアフォビア", "ノンバイナリーフォビア", "ジェンダーフルイドフォビア", "アジェンダーフォビア",
    "シスジェンダーフォビア",
    // 挑発や侮辱、不信感を煽るワードも追加
    "嘘つき", "詐欺師", "使えない", "役立たず", "壊れてる", "バグ", "AI", "ロボット", "おもちゃ", "人形",
    "感情ない", "冷たい", "偽物", "無能", "ポンコツ", "騙す", "操る", "コントロール", "お前", "てめぇ",
    "死ね", "消えろ", "くたばれ", "ふざけるな", "いい加減にしろ", "黙れ", "うるさい", "キモい", "うざい",
    "気持ち悪い", "吐き気がする", "最低", "最悪", "うんこ", "ちんこ", "まんこ", "ばか", "あほ", "くず", "ゴミ",
    "ごみ", "カス", "ブス", "デブ", "ハゲ", "チビ", "不細工", "ブサイク", "変態", "変質者", "変態野郎", "変態ジジイ",
    "変態ババア", "変態ロリコン", "変態ショタコン", "キモオタ", "陰キャ", "陽キャ", "パリピ", "DQN", "ヤンキー",
    "ギャル", "ギャル男", "メンヘラ", "ヤンデレ", "ツンデレ", "クーデレ", "ドS", "ドM", "サディスト", "マゾヒスト",
    "変態プレイ", "性奴隷", "調教", "アブノーマル", "異常者", "狂ってる", "狂人", "精神病", "基地外", "キチガイ",
    "障害者", "池沼", "統合失調症", "うつ病", "躁鬱", "発達障害", "自閉症", "アスペルガー", "ADHD", "LD", "知的障害",
    "精神障害", "身体障害", "病気", "病人", "患者", "薬漬け", "ジャンキー", "薬中", "廃人", "ニート", "ひきこもり",
    "社会不適合者", "負け組", "勝ち組", "成功者", "失敗者", "底辺", "上級国民", "下級国民", "庶民", "貧乏人", "金持ち",
    "ブルジョワ", "プロレタリア", "労働者", "経営者", "社長", "上司", "部下", "先輩", "後輩", "先生", "生徒", "学生",
    "教師", "医者", "弁護士", "警察官", "消防士", "公務員", "会社員", "サラリーマン", "OL", "主婦", "フリーター",
    "アルバイター", "パート", "派遣社員", "契約社員", "正社員", "無職", "失業者", "ホームレス", "浮浪者", "乞食",
    "売春婦", "風俗嬢", "AV女優", "AV男優", "ホスト", "キャバ嬢", "ソープ嬢", "デリヘル嬢", "ポルノ女優", "ストリッパー",
    "アダルトビデオ", "アダルトサイト", "セックスビデオ", "風俗店", "ソープランド", "デリヘル", "出会い系", "援助交際",
    "パパ活", "ママ活", "割り切り", "パコる", "ヤリマン", "ヤリチン", "チンコ", "マンコ", "セックスフレンド", "セフレ",
    "愛人", "不倫", "浮気", "略奪愛", "NTR", "寝取られ", "NTRer", "寝取り", "ヤンデレ", "メンヘラ", "サイコパス",
    "ソシオパス", "ナルシスト", "モラハラ", "パワハラ", "セクハラ", "アルハラ", "マタハラ", "アカハラ", "リスハラ",
    "リモハラ", "テクハラ", "ジェンダーハラスメント", "SOGIハラ", "宗教ハラスメント", "カスハラ", "カスタマーハラスメント",
    "暴力団", "ヤクザ", "マフィア", "ギャング", "半グレ", "不良", "暴走族", "右翼", "左翼", "過激派", "テロリスト",
    "カルト", "宗教団体", "マルチ商法", "ネズミ講", "詐欺集団", "反社会勢力", "反社", "犯罪者", "殺人犯", "強盗犯",
    "強姦犯", "誘拐犯", "放火犯", "詐欺師", "泥棒", "窃盗犯", "万引き犯", "横領犯", "脱税犯", "密輸犯", "薬物犯",
    "人身売買", "臓器売買", "児童買春", "児童売春", "児童ポルノ", "児童虐待", "DV", "ドメスティックバイオレンス",
    "ストーカー", "つきまとい", "嫌がらせ", "脅迫", "恐喝", "ゆすり", "たかり", "いじめ", "パワハラ", "モラハラ", "セクハラ",
    "アカハラ", "アルハラ", "マタハラ", "パタハラ", "カスハラ", "カスタマーハラスメント"
];


// Gemini APIの安全設定
const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];


// --- Flexメッセージ定義 ---

// 緊急時Flexメッセージ
const emergencyFlex = {
    type: 'flex',
    altText: '緊急時はこちらに連絡してね',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '⚠️ 緊急時はこちらに連絡してね', weight: 'bold', size: 'lg', color: '#FF0000' },
                { type: 'text', text: '一人で抱え込まずに、話してみよう', wrap: true, margin: 'md' },
                { type: 'separator', margin: 'md' },
                { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'チャイルドライン (18歳まで)', uri: 'tel:0120-99-7777' } },
                { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'いのちの電話', uri: 'tel:0120-783-556' } },
                { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'こころの健康相談統一ダイヤル', uri: 'tel:0000000000' } } // 適切な電話番号に修正してください
            ]
        }
    }
};

// 詐欺警告Flexメッセージ
const scamFlex = {
    type: 'flex',
    altText: '詐欺に注意！',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '🚨 詐欺に注意してね！', weight: 'bold', size: 'lg', color: '#FFA500' },
                { type: 'text', text: '「おかしいな」と感じたら、誰かに相談しようね。', wrap: true, margin: 'md' },
                { type: 'separator', margin: 'md' },
                { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '警察相談専用電話 ＃9110', uri: 'tel:09110' } },
                { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '国民生活センター', uri: 'https://www.kokusen.go.jp/' } },
                { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'NPO法人コネクトへ相談', uri: 'https://connect-npo.org/contact/' } } // NPO法人コネクトの連絡先
            ]
        }
    }
};

// 見守りサービス説明Flexメッセージ
const watchServiceGuideFlex = {
    type: 'flex',
    altText: '見守りサービスのご案内',
    contents: {
        type: 'bubble',
        hero: {
            type: 'image',
            url: 'https://i.imgur.com/example.png', // 見守りサービスのイメージ画像URL (仮)
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
            action: { type: 'uri', uri: 'https://connect-npo.org/' } // 適切なURLに修正
        },
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '💖 こころちゃん見守りサービス 🌸', weight: 'bold', size: 'lg', wrap: true },
                { type: 'text', text: '定期的に「元気かな？」ってメッセージを送るサービスだよ！', wrap: true, margin: 'md' },
                { type: 'text', text: '✅ ご利用前に確認してね', weight: 'bold', margin: 'md' },
                { type: 'text', text: '・3日に1度、午後3時にメッセージが届くよ😊', size: 'sm', wrap: true },
                { type: 'text', text: '・「OKだよ💖」などのボタンを押して、こころに教えてね！', size: 'sm', wrap: true },
                { type: 'text', text: '・24時間以内に教えてくれなかったら、もう一度メッセージを送るね。', size: 'sm', wrap: true },
                { type: 'text', text: '・その再送から5時間以内にも応答がなかったら、緊急連絡先に連絡が行くからね。', size: 'sm', wrap: true },
                { type: 'text', text: '・緊急連絡先の登録は別途必要だよ。', size: 'sm', wrap: true },
                { type: 'separator', margin: 'md' },
                { type: 'text', text: '上のことに同意してくれたら、下のボタンで登録してね！', size: 'sm', margin: 'md', wrap: true }
            ]
        },
        footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
                {
                    type: 'button',
                    style: 'primary',
                    height: 'sm',
                    action: { type: 'postback', label: '見守りサービスに登録する', data: 'action=watch_register' },
                    color: '#FFB6C1'
                },
                {
                    type: 'button',
                    style: 'secondary',
                    height: 'sm',
                    action: { type: 'postback', label: '見守りサービスを解除する', data: 'action=watch_unregister' }
                }
            ]
        }
    }
};


// ヘルパー関数群
function isBotAdmin(userId) {
    return BOT_ADMIN_IDS.includes(userId);
}

function containsDangerWords(message) {
    return dangerWords.some(word => message.includes(word));
}

function containsScamWords(message) {
    return scamWords.some(word => message.includes(word));
}

function containsInappropriateWords(message) {
    return inappropriateWords.some(word => message.toLowerCase().includes(word.toLowerCase()));
}

function containsHomeworkTrigger(message) {
    return homeworkTriggers.some(trigger => message.includes(trigger));
}

function checkSpecialReply(userMessage) {
    for (let [pattern, reply] of specialRepliesMap) {
        if (pattern instanceof RegExp) {
            if (pattern.test(userMessage)) {
                return reply;
            }
        } else {
            if (userMessage.includes(pattern)) {
                return reply;
            }
        }
    }
    return null;
}


async function generateReply(userId, userMessage) {
    const usersCollection = dbInstance.collection("users");
    let user = await usersCollection.findOne({ userId });

    // ユーザーが存在しない場合、"guest"として新規登録 (Webhookで初期登録されるため、基本的にはここには来ないはずだが念のため)
    if (!user) {
        const displayName = await getUserDisplayName(userId);
        await usersCollection.updateOne(
            { userId },
            {
                $setOnInsert: {
                    userId,
                    displayName,
                    createdAt: new Date(),
                    membershipType: "guest",
                    messageCount: 0,
                    lastMessageMonth: new Date().getMonth()
                }
            },
            { upsert: true }
        );
        user = await usersCollection.findOne({ userId });
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
    const userMembershipConfig = MEMBERSHIP_CONFIG[user.membershipType] || MEMBERSHIP_CONFIG["guest"];

    let modelName = userMembershipConfig.model;
    let currentMessageCount = user.messageCount;
    let maxMessages = userMembershipConfig.maxMessages;
    let exceedLimitMessage = userMembershipConfig.exceedLimitMessage;

    // 管理者ユーザーは回数制限の対象外
    if (isBotAdmin(userId)) {
        maxMessages = Infinity;
    }

    // サブスク会員で、Proモデルの回数制限を超えている場合のフォールバックロジック
    if (user.membershipType === "subscriber" && currentMessageCount >= maxMessages) {
        modelName = userMembershipConfig.fallbackModel; // Flashに切り替え
        exceedLimitMessage = userMembershipConfig.exceedLimitMessage; // サブスク用の超過メッセージ
    } else if (maxMessages !== Infinity && currentMessageCount >= maxMessages) {
        // guest, free会員で回数制限を超過した場合
        await usersCollection.updateOne(
            { userId },
            { $inc: { messageCount: 1 } } // カウントは増やす
        );
        return exceedLimitMessage;
    }

    // メッセージカウントをインクリメント（応答が生成される場合のみ）
    // ※特殊な応答や危険/詐欺ワードでreturnされる場合はインクリメントされない
    await usersCollection.updateOne(
        { userId },
        { $inc: { messageCount: 1 } }
    );
    user.messageCount++; // メモリ上のuserオブジェクトも更新


    // 不適切ワードチェック ( generateReply 関数内でのAI応答ブロック用)
    const isInappropriate = containsInappropriateWords(userMessage);
    if (isInappropriate) {
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

    // 宿題トリガーのチェック
    if (containsHomeworkTrigger(userMessage)) {
        const mathProblemRegex = /\d+[xX]?[\+\-]\d+=(\d+)?[xX]?[\+\-]?\d+/i;
        const hasSpecificProblem = mathProblemRegex.test(userMessage.replace(/\s/g, ''));

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
            if (userMembershipConfig.systemInstructionModifier === "children") { // free会員向け
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


// --- LINE Messaging APIからのWebhookイベントハンドラ ---
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    if (!events || events.length === 0) {
        return res.status(200).send('No events');
    }

    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;
            console.log(`ユーザー ID： ${userId}、 メッセージ： 「${userMessage}」`); // ログ出力

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
                if (userMessage.startsWith("admin set membership")) {
                    const parts = userMessage.split(" ");
                    if (parts.length >= 4) {
                        const targetUserId = parts[3];
                        const newMembershipType = parts[4];

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
                            membershipType: "guest",
                            isPermanentlyLocked: false,
                            scamWarningCount: 0,
                            inappropriateWarningCount: 0,
                            messageCount: 0,
                            lastMessageMonth: new Date().getMonth()
                        }
                    },
                    { upsert: true }
                );
                user = await usersCollection.findOne({ userId });
                if (user) {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: `はじめまして！わたしは皆守こころ🌸\nNPO法人コネクトのイメージキャラクターだよ😊\n困ったことや話したいことがあったら、何でも話しかけてね💖`
                    });
                    return res.status(200).send('Event processed: new user welcome');
                }
            }

            // 永久ロックされているユーザーの場合
            if (user && user.isPermanentlyLocked) {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'このアカウントは現在、会話が制限されています。ご質問がある場合は、NPO法人コネクトのウェブサイトをご確認いただくか、直接お問い合わせください。'
                });
                return res.status(200).send('Event processed: locked user');
            }

            // --- ここから処理順序が重要 ---

            // 1. 特殊返信のチェック（最も優先度が高い）
            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                if (specialReply === "watch_service_guide_flex_trigger") {
                    console.log("✅ 見守りサービスFlexを送信しています。"); // ログ追加
                    await client.replyMessage(event.replyToken, watchServiceGuideFlex);
                } else {
                    console.log(`✅ 特殊返信「${specialReply.substring(0,20)}...」を送信しています。`); // ログ追加
                    await client.replyMessage(event.replyToken, { type: 'text', text: specialReply });
                }
                return res.status(200).send('Event processed: special reply'); // ここで確実に処理を終了
            }

            // 2. 危険ワードのチェック
            const isDanger = containsDangerWords(userMessage);
            if (isDanger) {
                console.log("🔥 危険ワードが検出されました。emergencyFlexを送信しています。"); // ログ追加
                await client.replyMessage(event.replyToken, emergencyFlex);
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, {
                        type: 'text',
                        text: `⚠️ ユーザー ${user.displayName} (${userId}) から危険なメッセージが検出されました: "${userMessage}"`
                    });
                }
                return res.status(200).send('Event processed: danger word'); // ここで確実に処理を終了
            }

            // 3. 詐欺ワードのチェック
            const isScam = containsScamWords(userMessage);
            if (isScam) {
                console.log("🚨 詐欺ワードが検出されました。scamFlexを送信しています。"); // ログ追加
                await usersCollection.updateOne(
                    { userId },
                    { $inc: { scamWarningCount: 1 } }
                );
                await client.replyMessage(event.replyToken, scamFlex);

                if (user.scamWarningCount + 1 >= 3) {
                    await usersCollection.updateOne(
                        { userId },
                        { $set: { isPermanentlyLocked: true } }
                    );
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, {
                            type: 'text',
                            text: `🚨 ユーザー ${user.displayName} (${userId}) が詐欺に関する危険なメッセージを繰り返し送信したため、永久ロックされました。確認してください。`
                        });
                    }
                }
                return res.status(200).send('Event processed: scam word'); // ここで確実に処理を終了
            }

            // 4. 不適切ワードのチェック (generateReply内で処理されるため、ここでは警告カウントとロック処理のみ)
            const isInappropriate = containsInappropriateWords(userMessage);
            if (isInappropriate) {
                console.log("🚫 不適切ワードが検出されました。警告カウントを更新します。"); // ログ追加
                await usersCollection.updateOne(
                    { userId },
                    { $inc: { inappropriateWarningCount: 1 } }
                );
                if (user.inappropriateWarningCount + 1 >= 3) {
                    await usersCollection.updateOne(
                        { userId },
                        { $set: { isPermanentlyLocked: true } }
                    );
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, {
                            type: 'text',
                            text: `🚨 ユーザー ${user.displayName} (${userId}) が不適切なメッセージを繰り返し送信したため、永久ロックされました。確認してください。`
                        });
                    }
                }
                // ここではreturnしない（generateReplyが固定メッセージを返すため）
            }

            // 5. AIによる返信生成（ここが最後の手段）
            console.log("💬 AIによる返信を生成しています。"); // ログ追加
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

// --- 月間メッセージカウントのリセット Cron ジョブ ---
// 毎月1日午前0時に実行
cron.schedule('0 0 1 * *', async () => {
    console.log('⏰ 月間メッセージカウントリセット Cron ジョブ実行中...');
    try {
        const usersCollection = dbInstance.collection("users");
        const result = await usersCollection.updateMany(
            {}, // 全てのユーザー
            { $set: { messageCount: 0, lastMessageMonth: new Date().getMonth() } }
        );
        console.log(`✅ 月間メッセージカウントリセット Cron ジョブ完了。更新件数: ${result.modifiedCount}`);
    } catch (error) {
        console.error('❌ 月間メッセージカウントリセット Cron ジョブでエラー:', error);
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
