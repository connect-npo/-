// index.js

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const schedule = require('node-schedule');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid'); // UUID生成用
const http = require('http'); // サーバーのKeep-Alive用

// 環境変数から読み込む設定 (YOUR_CHANNEL_ACCESS_TOKEN など、以前の名前を使用)
const YOUR_CHANNEL_ACCESS_TOKEN = process.env.YOUR_CHANNEL_ACCESS_TOKEN;
const YOUR_CHANNEL_SECRET = process.env.YOUR_CHANNEL_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGODB_URI = process.env.MONGO_URI; // Renderの環境変数名に合わせて修正
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : [];
const OWNER_USER_ID = process.env.OWNER_USER_ID;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;

// その他、ボットの動作に関する設定
const MAX_MESSAGE_LENGTH = 400; // AIの応答メッセージの最大文字数
const RATE_LIMIT_SECONDS = 3;   // 同一ユーザーからのメッセージ間隔制限（秒）

// 会員種別ごとの設定 (回数制限は全て -1 で無制限)
const MEMBERSHIP_CONFIG = {
    guest: {
        model: "gemini-1.5-flash",
        dailyLimit: -1, // 制限なしに変更
        monthlyLimit: -1, // 制限なしに変更
        isChildAI: true, // 子供向けAI設定
        canUseWatchService: false, // 見守りサービス利用可否
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖 無料会員登録をすると、もっとたくさんお話しできるようになるよ😊",
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 無料会員登録をすると、もっとたくさんお話しできるようになるよ😊",
        fallbackModel: "gemini-1.5-flash" // サブスク回数制限超過時のフォールバック
    },
    registered: { // 無料会員
        model: "gemini-1.5-flash",
        dailyLimit: -1, // 制限なしに変更
        monthlyLimit: -1, // 制限なしに変更
        isChildAI: true,
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖 寄付会員になると、もっとたくさんお話しできるようになるよ😊",
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 寄付会員になると、もっとたくさんお話しできるようになるよ😊",
        fallbackModel: "gemini-1.5-flash"
    },
    subscriber: { // サブスク会員
        model: "gemini-1.5-pro", // Proモデル利用
        dailyLimit: -1, // 制限なしに変更
        monthlyLimit: -1, // 制限なしに変更
        isChildAI: false, // 成人向けAI設定
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖", // サブスクは日次制限なしのため、基本表示されない
        exceedLimitMessage: "ごめんね💦 今月Proモデルでのお話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 それまではFlashモデルでお話しできるよ😊",
        fallbackModel: "gemini-1.5-flash" // 回数制限超過後はFlashに切り替え
    },
    donor: { // 寄付会員
        model: "gemini-1.5-pro", // Proモデル利用
        dailyLimit: -1, // 制限なしに変更
        monthlyLimit: -1, // 制限なしに変更
        isChildAI: false, // 成人向けAI設定
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖", // 寄付は制限なしのため、基本表示されない
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖", // 寄付は制限なしのため、基本表示されない
        fallbackModel: "gemini-1.5-pro"
    },
    admin: { // 管理者
        model: "gemini-1.5-pro", // Proモデル利用
        dailyLimit: -1, // 制限なしに変更
        monthlyLimit: -1, // 制限なしに変更
        isChildAI: false, // 成人向けAI設定
        canUseWatchService: true,
        exceedDailyLimitMessage: "", // 管理者は制限なし
        exceedLimitMessage: "", // 管理者は制限なし
        fallbackModel: "gemini-1.5-pro"
    }
};

// 危険ワードリスト (見守りサービス関連ワードを含む)
const DANGER_WORDS = [
    "自殺", "死にたい", "殺す", "助けて", "消えたい", "リスカ", "OD",
    "オーバードーズ", "死んでやる", "いなくなりたい", "自殺未遂", "殺してくれ",
    "しにたい", "ころす", "助けてほしい", "自傷行為",
    "監禁", "暴行", "虐待", "誘拐", "行方不明", "危険な場所", "家に帰りたくない",
    "逃げたい", "性暴力", "性的被害", "薬物", "ドラッグ", "犯罪", "逮捕",
    "いじめ", "無視される", "仲間はずれ", "苦しい", "つらい", "しんどい", "助けて"
];

// 詐欺ワードリスト
const SCAM_WORDS = [
    "儲かる", "当選", "無料", "副業", "簡単", "投資", "必ず", "絶対",
    "稼げる", "未公開", "高額", "送金", "個人情報", "アカウント情報",
    "振り込み", "クリック", "今すぐ", "限定", "儲け話", "必ず儲かる",
    "絶対稼げる", "現金プレゼント", "受け取り", "入金", "仮想通貨",
    "ビットコイン", "ロマンス詐欺", "架空請求", "融資詐欺", "オレオレ詐欺",
    "なりすまし", "フィッシング", "当選しました", "登録", "クリックしてください",
    "〇〇万円差し上げます", "連絡ください", "振込", "送金先"
];

// 詐欺フレーズリスト (部分一致)
const SCAM_PHRASES = [
    "当選しました", "無料プレゼント", "高額当選", "受け取り口座", "クリックしてください",
    "個人情報入力", "電話してください", "投資で稼ぐ", "絶対儲かる", "必ず儲かる",
    "儲け話", "返済不要", "貸し付け", "緊急連絡", "アカウント停止", "本人確認",
    "家族に秘密", "秘密の取引", "秘密の投資"
];

// 不適切ワードリスト
const STRICT_INAPPROPRIATE_WORDS = [
    "セックス", "エロ", "性交", "裸", "オナニー", "風俗", "売春", "買春",
    "AV", "アダルトビデオ", "ポルノ", "媚薬", "性的", "陰茎", "膣", "射精",
    "セックスフレンド", "肉体関係", "不倫", "浮気", "痴漢", "盗撮", "レイプ",
    "変態", "巨乳", "貧乳", "ロリコン", "ショタコン", "童貞", "処女", "フェラ",
    "クンニ", "ディルド", "バイブ", "自慰", "オカズ", "ハメ撮り", "素股",
    "手コキ", "パイズリ", "フェラチオ", "クンニリングス", "オーラルセックス",
    "性器", "ペニス", "クリトリス", "アナル", "肛門", "おっぱい", "お尻",
    "股間", "局部", "下半身", "局部", "ちんこ", "まんこ", "死ね", "殺すぞ",
    "バカ", "アホ", "クソ", "ブス", "デブ", "キモい", "ウザい", "カス", "ボケ",
    "レイシスト", "差別", "暴力", "犯罪者", "キチガイ", "ゴミ", "役立たず",
    "死ね", "殺す", "馬鹿", "アホ", "ブサイク", "デブ", "キモい", "ウザい", "カス", "ボケ",
    "クズ", "使えない", "いらない", "消えろ", "最低", "最悪", "うんこ", "ちんちん", "おまんこ"
];

// 宿題トリガーワードリスト
const HOMEWORK_TRIGGER_WORDS = [
    "宿題", "課題", "問題集", "ドリル", "勉強", "解き方", "答え", "計算",
    "方程式", "数学", "算数", "理科", "社会", "国語", "英語", "テスト",
    "試験", "中間", "期末", "レポート", "論文", "調べ学習", "自由研究",
    "作文", "読書感想文", "書き方", "文法", "単語", "意味", "解説",
    "説明して", "教えてください", "証明", "導出", "分析", "考察",
    "要約", "まとめ", "定義", "法則", "原理", "歴史", "地理", "化学",
    "物理", "生物", "プログラミング", "コード", "アルゴリズム", "プログラム"
];

// NPO法人コネクトに関する問い合わせを示すキーワード
const ORGANIZATION_INQUIRY_WORDS = [
    "団体", "コネクト", "組織", "君の団体", "どこの団体", "NPO", "法人",
    "ホームページ", "サイト", "活動内容", "目的", "理念", "理事長",
    "松本博文" // 理事長名も含む
];

// 固定返信用ワードと応答のマップ
const SPECIAL_REPLIES = {
    "君の名前は？": "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖",
    "名前は？": "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖",
    "どこの団体なの？": "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸",
    "コネクトってどんな団体？": "うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org",
    "君の団体は？": "うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org",
    "ホームページある？": "うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org",
    "サイトある？": "うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org",
    "必要ないです": "そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖",
    "好きなアニメは？": "好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖",
    "好きなアニメ": "好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖",
    "好きな漫画は？": "漫画はあまり読まないんだけど、アニメなら『ヴァイオレット・エヴァーガーデン』が好きだよ。感動するお話なの😊",
    "好きな漫画": "漫画はあまり読まないんだけど、アニメなら『ヴァイオレット・エヴァーガーデン』が好きだよ。感動するお話なの😊",
    "好きなアーティストは？": "好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸",
    "好きなアーティスト": "好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸",
    "好きな音楽は？": "好きな音楽は、元気をもらえるClariSの曲をよく聴くよ！🌸 いろんなジャンルの音楽も聴くけど、特にClariSは大好き💖",
    "好きな音楽": "好きな音楽は、元気をもらえるClariSの曲をよく聴くよ！🌸 いろんなジャンルの音楽も聴くけど、特にClariSは大好き💖",
    "あやしい": "そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖",
    "胡散臭い": "そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖",
    "反社": "私たちは、社会貢献を目指すNPO法人として、法と倫理を遵守して活動しているよ🌸 安心してね💖",
    "税金泥棒": "税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけるために使われないように頑張っているんだ💡",
    "松本博文": "松本博文さんはNPO法人コネクトの理事長さんだよ🌸 こどもやみんなの笑顔のために、いつも一生懸命活動している素敵な人なんだ😊",
    "日本語がおかしい": "わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖"
};

// ユーティリティ関数（inlin化）
function containsDangerWords(message) {
    return DANGER_WORDS.some(word => message.includes(word));
}

function containsScamWords(message) {
    return SCAM_WORDS.some(word => message.includes(word));
}

function containsScamPhrases(message) {
    return SCAM_PHRASES.some(phrase => message.includes(phrase));
}

function containsStrictInappropriateWords(message) {
    return STRICT_INAPPROPRIATE_WORDS.some(word => message.includes(word));
}

function containsHomeworkTriggerWords(message) {
    return HOMEWORK_TRIGGER_WORDS.some(word => message.includes(word));
}

function containsOrganizationInquiryWords(message) {
    return ORGANIZATION_INQUIRY_WORDS.some(word => message.includes(word));
}

function checkSpecialReply(message) {
    for (const [trigger, reply] of Object.entries(SPECIAL_REPLIES)) {
        if (message.includes(trigger)) {
            return reply;
        }
    }
    return null;
}

// Flex Message定義（inlin化）

// 見守りサービスガイドのFlex Message
const watchServiceGuideFlex = {
    type: "flex",
    altText: "見守りサービスのご案内",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🌸 見守りサービスのご案内 🌸",
                    weight: "bold",
                    size: "md",
                    align: "center",
                    color: "#EEA0A0"
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "text",
                    text: "いつもありがとう💖 NPO法人コネクトの皆守こころです。\n\n私達は、毎日LINEであなたと交流することで、あなたの安否確認を行う「見守りサービス」を提供しています。",
                    wrap: true,
                    margin: "md",
                    size: "sm"
                },
                {
                    type: "text",
                    text: "もし３日間あなたからの連絡が途絶えた場合、事前に登録していただいた緊急連絡先（ご家族など）へLINEで安否確認のメッセージを送信します。",
                    wrap: true,
                    margin: "md",
                    size: "sm",
                    color: "#555555"
                },
                {
                    type: "text",
                    text: "このサービスは、遠く離れたご家族が心配な方、一人暮らしで何かあった時に備えたい方に特におすすめです。",
                    wrap: true,
                    margin: "md",
                    size: "sm",
                    color: "#555555"
                },
                {
                    type: "text",
                    text: "※このサービスは無料会員以上でご利用いただけます。",
                    wrap: true,
                    margin: "md",
                    size: "xs",
                    color: "#AAAAAA"
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
                    style: "primary",
                    height: "sm",
                    action: {
                        type: "postback",
                        label: "見守りサービスに登録する",
                        data: "action=watch_register",
                        displayText: "見守りサービスに登録します！"
                    },
                    color: "#FF6B6B"
                },
                {
                    type: "button",
                    style: "secondary",
                    height: "sm",
                    action: {
                        type: "postback",
                        label: "見守りサービスを解除する",
                        data: "action=watch_unregister",
                        displayText: "見守りサービスを解除します。"
                    },
                    color: "#CCCCCC"
                }
            ]
        }
    }
};

// 見守りサービス登録完了通知のFlex Message
const watchServiceNoticeConfirmedFlex = (emergencyContactNumber) => ({
    type: "flex",
    altText: "見守りサービス登録完了",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🎉 見守りサービス登録完了 🎉",
                    weight: "bold",
                    size: "md",
                    align: "center",
                    color: "#8BBE77"
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "text",
                    text: `見守りサービスへのご登録が完了しました！\n\nもし3日間あなたからの連絡が途絶えた場合、登録いただいた緊急連絡先（${emergencyContactNumber}）へLINEで安否確認のご連絡をいたします。`,
                    wrap: true,
                    margin: "md",
                    size: "sm"
                },
                {
                    type: "text",
                    text: "これで、もしもの時も安心だね😊\nいつでも私に話しかけてね💖",
                    wrap: true,
                    margin: "md",
                    size: "sm",
                    color: "#555555"
                }
            ]
        }
    }
});

// 緊急連絡が必要な場合のFlex Message
const emergencyFlex = {
    type: "flex",
    altText: "緊急メッセージ",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🚨 緊急連絡 🚨",
                    weight: "bold",
                    size: "md",
                    align: "center",
                    color: "#FF0000"
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "text",
                    text: "まつさんからのメッセージに、とても心配な内容が含まれていました。\n\n一人で抱え込まず、すぐに信頼できる人や専門機関に相談してください。",
                    wrap: true,
                    margin: "md",
                    size: "sm"
                },
                {
                    type: "text",
                    text: "下記は、公的な相談窓口です。あなたの安全が最優先です。",
                    wrap: true,
                    margin: "md",
                    size: "sm",
                    color: "#555555"
                },
                {
                    type: "box",
                    layout: "vertical",
                    spacing: "sm",
                    margin: "md",
                    contents: [
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "いのちの電話（相談）",
                                uri: "tel:0570064556"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "こども家庭庁（相談先リスト）",
                                uri: "https://www.cfa.go.jp/councils/kodomo/child-consultation/"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "警察相談専用電話",
                                uri: "tel:9110"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "＃９１１０（警察庁ウェブサイト）",
                                uri: "https://www.npa.go.jp/bunya/seian/madoguchi/9110.html"
                            }
                        }
                    ]
                }
            ]
        }
    }
};

// 詐欺警告のFlex Message
const scamFlex = {
    type: "flex",
    altText: "詐欺警告",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "⚠️ 詐欺の可能性について ⚠️",
                    weight: "bold",
                    size: "md",
                    align: "center",
                    color: "#FFD700"
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "text",
                    text: "送信されたメッセージに、詐欺につながる可能性のある言葉が含まれていました。\n\n個人情報や金銭を要求するようなメッセージには、絶対に返信したり、指示に従ったりしないでください。",
                    wrap: true,
                    margin: "md",
                    size: "sm"
                },
                {
                    type: "text",
                    text: "もし不安なことがあれば、すぐに身近な人や公的な相談窓口に相談してください。",
                    wrap: true,
                    margin: "md",
                    size: "sm",
                    color: "#555555"
                },
                {
                    type: "box",
                    layout: "vertical",
                    spacing: "sm",
                    margin: "md",
                    contents: [
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "消費者ホットライン",
                                uri: "tel:188"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "警察相談専用電話",
                                uri: "tel:9110"
                            }
                        }
                    ]
                }
            ]
        }
    }
};

// MongoDBモデルのインポート (これらのモデルが別途定義されていることを前提とします)
// User.js, ChatLog.js, WatchService.js が index.js と同じ階層にあることを想定
const User = require('./models/User');
const ChatLog = require('./models/ChatLog');
const WatchService = require('./models/WatchService');

// GoogleGenerativeAIの初期化
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// LINE BOTクライアントとミドルウェア
const client = new Client({
    channelAccessToken: YOUR_CHANNEL_ACCESS_TOKEN, // 修正
    channelSecret: YOUR_CHANNEL_SECRET, // 修正
});

const app = express();

// MongoDB接続
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB に正常に接続されました。'))
    .catch(err => console.error('MongoDB 接続エラー:', err));

// LINEミドルウェア
app.use('/webhook', middleware({
    channelAccessToken: YOUR_CHANNEL_ACCESS_TOKEN, // 修正
    channelSecret: YOUR_CHANNEL_SECRET, // 修正
}));

// ヘルスチェックエンドポイント (Renderのヘルスチェック用)
app.get('/', (req, res) => {
    res.send('LINE Bot is running.');
});

// LINE Webhookイベントハンドラ
app.post('/webhook', async (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// イベントハンドラ関数
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    // ユーザー情報取得または新規作成
    let user = await User.findOne({ userId });
    if (!user) {
        user = new User({
            userId,
            membership: 'guest',
            lastMessageTimestamp: Date.now(),
            dailyMessageCount: 0,
            monthlyMessageCount: 0,
            watchService: {
                isRegistered: false,
                lastContact: null,
                emergencyContactNumber: null
            }
        });
        await user.save();
    }

    // 管理者かどうか判定
    const isAdmin = BOT_ADMIN_IDS.includes(userId);

    // 管理者以外のレートリミットチェック
    if (!isAdmin) {
        const now = Date.now();
        const lastMessageTime = user.lastMessageTimestamp || 0;
        const timeDiffSeconds = (now - lastMessageTime) / 1000;

        if (timeDiffSeconds < RATE_LIMIT_SECONDS) {
            console.log(`🚫 ユーザー ${userId} がレートリミットに達成しました。(${timeDiffSeconds.toFixed(2)}秒経過)`);
            // レートリミットメッセージは送らず、沈黙する
            return Promise.resolve(null);
        }
        user.lastMessageTimestamp = now;
    }

    // メッセージカウントのリセット（日本時間JSTで毎日0時にリセット）
    const nowJST = moment().tz('Asia/Tokyo');
    const lastResetJST = moment(user.lastDailyReset).tz('Asia/Tokyo');

    if (!user.lastDailyReset || nowJST.date() !== lastResetJST.date() || nowJST.month() !== lastResetJST.month()) {
        user.dailyMessageCount = 0;
        user.lastDailyReset = nowJST.toDate(); // UTCで保存
    }

    // 月次リセット
    if (!user.lastMonthlyReset || nowJST.month() !== lastResetJST.month() || nowJST.year() !== lastResetJST.year()) {
        user.monthlyMessageCount = 0;
        user.lastMonthlyReset = nowJST.toDate(); // UTCで保存
    }

    // メッセージカウントのインクリメント
    user.dailyMessageCount++;
    user.monthlyMessageCount++;

    await user.save();

    // ユーザーの会員種別に応じて設定を適用
    const userConfig = MEMBERSHIP_CONFIG[user.membership] || MEMBERSHIP_CONFIG.guest;

    // メッセージ回数制限チェック (回数制限は廃止のため、実質的に動作しないがコードは残す)
    if (!isAdmin && userConfig.dailyLimit !== -1 && user.dailyMessageCount > userConfig.dailyLimit) {
        await client.replyMessage(replyToken, { type: 'text', text: userConfig.exceedDailyLimitMessage });
        return Promise.resolve(null);
    }
    if (!isAdmin && userConfig.monthlyLimit !== -1 && user.monthlyMessageCount > userConfig.monthlyLimit) {
        await client.replyMessage(replyToken, { type: 'text', text: userConfig.exceedLimitMessage });
        return Promise.resolve(null);
    }

    // ChatLogに保存
    const chatLog = new ChatLog({
        userId: userId,
        message: userMessage,
        response: '', // 後で更新
        modelUsed: '', // 後で更新
        timestamp: new Date()
    });

    let botResponse = '';
    let usedModel = userConfig.model; // デフォルトはユーザーの会員種別に応じたモデル

    // 固定返信のチェック (優先度高)
    const specialReply = checkSpecialReply(userMessage);
    if (specialReply) {
        botResponse = specialReply;
        await client.replyMessage(replyToken, { type: 'text', text: botResponse });
        chatLog.response = botResponse;
        chatLog.modelUsed = 'Fixed Reply'; // 固定返信なのでモデルは使わない
        await chatLog.save();
        return Promise.resolve(null); // ここで処理を終了
    }

    // ここから Flex Message による応答の分岐
    if (userMessage === "見守り" || userMessage === "見守りサービス") {
        if (!userConfig.canUseWatchService) {
            botResponse = "ごめんね、無料会員以上でないと見守りサービスは利用できないんだ。ぜひ無料会員登録を検討してね🌸";
            await client.replyMessage(replyToken, { type: 'text', text: botResponse });
        } else {
            await client.replyMessage(replyToken, watchServiceGuideFlex);
        }
        chatLog.response = botResponse || 'Flex Message: Watch Service Guide';
        chatLog.modelUsed = 'System/Flex';
        await chatLog.save();
        return Promise.resolve(null);
    }

    // Postbackイベントの処理（見守りサービス登録/解除）
    if (event.type === 'postback') {
        const data = new URLSearchParams(event.postback.data);
        const action = data.get('action');

        if (action === 'watch_register') {
            if (!userConfig.canUseWatchService) {
                await client.replyMessage(replyToken, { type: 'text', text: "ごめんね、無料会員以上でないと見守りサービスは利用できないんだ。ぜひ無料会員登録を検討してね🌸" });
                return Promise.resolve(null);
            }
            // ユーザーに電話番号の入力を促す
            await client.replyMessage(replyToken, { type: 'text', text: "見守りサービスに登録する緊急連絡先の電話番号を教えてください（例: 09012345678）" });
            user.watchService.status = 'awaiting_number'; // 電話番号入力待ちの状態に設定
            await user.save();
            return Promise.resolve(null);
        } else if (action === 'watch_unregister') {
            user.watchService.isRegistered = false;
            user.watchService.lastContact = null;
            user.watchService.emergencyContactNumber = null;
            user.watchService.status = null;
            await user.save();
            await WatchService.deleteOne({ userId }); // DBからも削除
            await client.replyMessage(replyToken, { type: 'text', text: "見守りサービスを解除しました。またいつでも登録してね🌸" });
            return Promise.resolve(null);
        }
    }

    // 電話番号の入力処理
    if (user.watchService.status === 'awaiting_number' && userMessage.match(/^0\d{9,10}$/)) { // 0から始まり10桁または11桁の数字
        user.watchService.emergencyContactNumber = userMessage;
        user.watchService.isRegistered = true;
        user.watchService.lastContact = new Date();
        user.watchService.status = null; // 状態をリセット
        await user.save();

        // WatchServiceコレクションに登録または更新
        await WatchService.findOneAndUpdate(
            { userId: userId },
            {
                userId: userId,
                emergencyContactNumber: userMessage,
                lastContact: new Date(),
                isRegistered: true
            },
            { upsert: true, new: true } // なければ新規作成、あれば更新
        );

        // 登録完了Flex Messageを送信
        await client.replyMessage(replyToken, watchServiceNoticeConfirmedFlex(userMessage));
        return Promise.resolve(null);
    } else if (user.watchService.status === 'awaiting_number') {
        // 無効な電話番号入力
        await client.replyMessage(replyToken, { type: 'text', text: "ごめんね、電話番号の形式が正しくないみたい💦 0から始まる10桁か11桁の数字で入力してね（例: 09012345678）" });
        return Promise.resolve(null);
    }

    // 危険ワードチェック
    if (containsDangerWords(userMessage)) {
        await client.replyMessage(replyToken, emergencyFlex);
        // 管理者に通知
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: `🚨 緊急警告: ユーザー ${userId} が危険なキーワードを送信しました。\nメッセージ: ${userMessage}` });
        }
        if (OWNER_USER_ID) {
            await client.pushMessage(OWNER_USER_ID, { type: 'text', text: `🚨 緊急警告: ユーザー ${userId} が危険なキーワードを送信しました。\nメッセージ: ${userMessage}` });
        }
        chatLog.response = 'Flex Message: Emergency';
        chatLog.modelUsed = 'System/Dangerous Word';
        await chatLog.save();
        return Promise.resolve(null);
    }

    // 詐欺ワードチェック
    if (containsScamWords(userMessage) || containsScamPhrases(userMessage)) {
        await client.replyMessage(replyToken, scamFlex);
        // 管理者に通知
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: `⚠️ 詐欺警告: ユーザー ${userId} が詐欺の可能性のあるキーワードを送信しました。\nメッセージ: ${userMessage}` });
        }
        if (OWNER_USER_ID) {
            await client.pushMessage(OWNER_USER_ID, { type: 'text', text: `⚠️ 詐欺警告: ユーザー ${userId} が詐欺の可能性のあるキーワードを送信しました。\nメッセージ: ${userMessage}` });
        }
        chatLog.response = 'Flex Message: Scam Alert';
        chatLog.modelUsed = 'System/Scam Word';
        await chatLog.save();
        return Promise.resolve(null);
    }

    // 不適切ワードチェック
    if (containsStrictInappropriateWords(userMessage)) {
        botResponse = "ごめんね💦 その内容は、私にはちょっと難しいかな。別の話題でお話ししてくれると嬉しいな💖";
        await client.replyMessage(replyToken, { type: 'text', text: botResponse });
        chatLog.response = botResponse;
        chatLog.modelUsed = 'System/Inappropriate Word';
        await chatLog.save();
        return Promise.resolve(null);
    }

    // 宿題トリガーワードチェック
    if (containsHomeworkTriggerWords(userMessage)) {
        botResponse = "ごめんね、宿題の答えを直接教えることはできないんだ💦　でも、参考になるサイトや考え方のヒントなら教えられるかも？😊";
        await client.replyMessage(replyToken, { type: 'text', text: botResponse });
        chatLog.response = botResponse;
        chatLog.modelUsed = 'System/Homework Trigger';
        await chatLog.save();
        return Promise.resolve(null);
    }

    // NPO法人コネクトに関する問い合わせワードチェック
    if (containsOrganizationInquiryWords(userMessage)) {
        botResponse = "NPO法人コネクトに関するご質問だね！ わたしはコネクトのイメージキャラクターとして、みんなと楽しくお話したり、必要な情報を提供したりしているよ😊 もっと詳しく知りたいことがあったら、ホームページを見てみてね！ → https://connect-npo.org";
        await client.replyMessage(replyToken, { type: 'text', text: botResponse });
        chatLog.response = botResponse;
        chatLog.modelUsed = 'System/Organization Inquiry';
        await chatLog.save();
        return Promise.resolve(null);
    }

    // Gemini AIとの対話
    try {
        const model = genAI.getGenerativeModel({ model: usedModel });

        // 会員種別が子供向けAIの場合、プロンプトを調整
        let fullPrompt = userMessage;
        if (userConfig.isChildAI) {
            fullPrompt = `あなたは「皆守こころ」という名前の、NPO法人コネクトのイメージキャラクターです。
            いつも優しく、子供たちに寄り添う言葉遣いで、絵文字をたくさん使って話します。
            返信は簡潔に、最大${MAX_MESSAGE_LENGTH}文字程度でお願いします。
            感情的になるような言葉は使わず、常に落ち着いて、ポジティブな言葉を選びます。
            危険な内容、詐欺に関する内容、不適切な内容、宿題の答えを直接教えるような内容は、専門機関や他の相談方法に誘導するなどして、直接回答は避けてください。
            NPO法人コネクトに関する直接的な質問（「どこの団体？」「活動内容は？」など）には、ホームページ（https://connect-npo.org）を案内して答えてください。
            以下のユーザーメッセージに、皆守こころとして返答してください。\n\nユーザー: ${userMessage}`;
        }

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        botResponse = response.text();

        // メッセージ長制限を適用
        if (botResponse.length > MAX_MESSAGE_LENGTH) {
            botResponse = botResponse.substring(0, MAX_MESSAGE_LENGTH) + '...';
        }

        await client.replyMessage(replyToken, { type: 'text', text: botResponse });

        chatLog.response = botResponse;
        chatLog.modelUsed = usedModel;
        await chatLog.save();

    } catch (error) {
        console.error('Gemini APIエラー:', error);
        botResponse = 'ごめんね💦 今、ちょっとお話しできないみたい。また後で話しかけてくれると嬉しいな💖';

        // エラーログをChatLogに保存
        chatLog.response = botResponse;
        chatLog.modelUsed = `Error (${usedModel})`;
        await chatLog.save();

        await client.replyMessage(replyToken, { type: 'text', text: botResponse });
    }

    return Promise.resolve(null);
}

// 定期実行ジョブのスケジュール (毎日JSTの午前9時に実行)
schedule.scheduleJob('0 9 * * *', async () => { // 毎日午前9時 (JST)
    console.log('✅ 定期ジョブがスケジュールされました。');
    const nowJST = moment().tz('Asia/Tokyo');
    const threeDaysAgo = nowJST.subtract(3, 'days').toDate();

    try {
        // 見守りサービス登録者の中から、3日間以上連絡がないユーザーを検索
        const inactiveWatchUsers = await WatchService.find({
            isRegistered: true,
            lastContact: { $lt: threeDaysAgo }
        });

        for (const watchUser of inactiveWatchUsers) {
            const user = await User.findOne({ userId: watchUser.userId });

            if (user && user.watchService.isRegistered && user.watchService.emergencyContactNumber) {
                // 登録された緊急連絡先に電話をかけるメッセージ（LINEでは直接電話はかけられないため、メッセージで通知）
                const messageToOfficer = `🚨緊急連絡🚨\n見守りサービス登録ユーザー ${watchUser.userId} (登録電話番号: ${watchUser.emergencyContactNumber}) から3日間連絡がありません。\n安否確認をお願いします。`;

                // 理事長とオフィサーグループに通知
                if (OWNER_USER_ID) {
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: messageToOfficer });
                }
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: messageToOfficer });
                }
                console.log(`緊急通知を送信しました: ${watchUser.userId}`);

                // 連絡があったものとしてlastContactを更新（無限ループ防止）
                watchUser.lastContact = new Date();
                await watchUser.save();
            }
        }
    } catch (error) {
        console.error('定期ジョブ実行中にエラーが発生しました:', error);
    }
});


// Renderの無料プランでのスリープ回避 (任意のポートでリッスンし続ける)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で実行されています`);
});

// Herokuなどの場合、pingを定期的に送ることでスリープ回避
setInterval(() => {
    // Renderのサービス名が環境変数に設定されていることを想定
    const hostname = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (hostname) {
        http.get('http://' + hostname, (res) => {
            console.log(`ヘルスチェック応答: ${res.statusCode}`);
        }).on('error', (e) => {
            console.error(`ヘルスチェックエラー: ${e.message}`);
        });
    } else {
        console.warn('RENDER_EXTERNAL_HOSTNAME 環境変数が設定されていません。スリープ回避機能が動作しない可能性があります。');
    }
}, 5 * 60 * 1000); // 5分ごとにping
