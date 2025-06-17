const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const schedule = require('node-schedule');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

// 環境変数から読み込む設定
const YOUR_CHANNEL_ACCESS_TOKEN = process.env.YOUR_CHANNEL_ACCESS_TOKEN;
const YOUR_CHANNEL_SECRET = process.env.YOUR_CHANNEL_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGODB_URI = process.env.MONGO_URI;
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : [];
const OWNER_USER_ID = process.env.OWNER_USER_ID;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;

// その他、ボットの動作に関する設定
const MAX_MESSAGE_LENGTH = 400;
const RATE_LIMIT_SECONDS = 3;

// 会員種別ごとの設定 (回数制限は全て -1 で無制限)
const MEMBERSHIP_CONFIG = {
    guest: {
        model: "gemini-1.5-flash",
        dailyLimit: -1,
        monthlyLimit: -1,
        isChildAI: true,
        canUseWatchService: false,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖 無料会員登録をすると、もっとたくさんお話しできるようになるよ😊",
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 無料会員登録をすると、もっとたくさんお話しできるようになるよ😊",
        fallbackModel: "gemini-1.5-flash"
    },
    registered: {
        model: "gemini-1.5-flash",
        dailyLimit: -1,
        monthlyLimit: -1,
        isChildAI: true,
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖 寄付会員になると、もっとたくさんお話しできるようになるよ😊",
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 寄付会員になると、もっとたくさんお話しできるようになるよ😊",
        fallbackModel: "gemini-1.5-flash"
    },
    subscriber: {
        model: "gemini-1.5-pro",
        dailyLimit: -1,
        monthlyLimit: -1,
        isChildAI: false,
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖",
        exceedLimitMessage: "ごめんね💦 今月Proモデルでのお話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 それまではFlashモデルでお話しできるよ😊",
        fallbackModel: "gemini-1.5-flash"
    },
    donor: {
        model: "gemini-1.5-pro",
        dailyLimit: -1,
        monthlyLimit: -1,
        isChildAI: false,
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖",
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖",
        fallbackModel: "gemini-1.5-pro"
    },
    admin: {
        model: "gemini-1.5-pro",
        dailyLimit: -1,
        monthlyLimit: -1,
        isChildAI: false,
        canUseWatchService: true,
        exceedDailyLimitMessage: "",
        exceedLimitMessage: "",
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
    "松本博文"
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

// ユーティリティ関数
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

// Flex Message定義

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
                                label: "消費者ホットライン（詐欺相談）",
                                uri: "tel:188"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "警察相談専用電話（#9110）",
                                uri: "tel:0335010110"
                            }
                        }
                    ]
                }
            ]
        }
    }
};

// Gemini AIの設定
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// MongoDB接続
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB に正常に接続されました。'))
    .catch(err => console.error('MongoDB 接続エラー:', err));

const client = new Client({
    channelAccessToken: YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: YOUR_CHANNEL_SECRET,
});

const app = express();

// LINEミドルウェア
app.post('/webhook', middleware({
    channelAccessToken: YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: YOUR_CHANNEL_SECRET,
}), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// handleEvent関数の修正
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        // Postbackイベントのログも取りたい場合、ここで処理を分岐させる
        if (event.type === 'postback' && event.source.userId) {
            const userId = event.source.userId;
            const data = new URLSearchParams(event.postback.data);
            const action = data.get('action');

            let replyText = '';
            let user = await User.findOne({ userId });
            if (!user) {
                user = new User({ userId: userId });
                await user.save();
            }

            if (action === 'watch_register') {
                if (user.watchService.isRegistered) {
                    replyText = "すでに登録されているよ！🌸 緊急連絡先を変更したい場合は、新しい番号を送ってね😊";
                } else {
                    user.watchService.status = 'awaiting_number';
                    await user.save();
                    replyText = "見守りサービスへのご登録ありがとう💖 緊急連絡先の電話番号（ハイフンなし）か、LINE IDを教えてくれるかな？間違えないように注意してね！😊";
                }
            } else if (action === 'watch_unregister') {
                user.watchService.isRegistered = false;
                user.watchService.emergencyContactNumber = null;
                user.watchService.status = 'none';
                await user.save();
                replyText = "見守りサービスを解除したよ🌸 また利用したくなったら「見守りサービス」と話しかけてね😊";
            }
            // Postbackに対するBotの応答をログに記録
            await ChatLog.create({ userId, message: `[Postback Action: ${action}]`, response: replyText, modelUsed: "System/Postback", role: 'user' }); // Postbackはユーザーアクション
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
            return Promise.resolve(null); // Postback処理後、ここで終了
        }
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const userMessage = event.message.text.trim();
    const replyToken = event.replyToken;

    let user = await User.findOne({ userId });

    if (!user) {
        user = new User({ userId: userId });
        await user.save();
    }

    const userMembershipConfig = MEMBERSHIP_CONFIG[user.membership] || MEMBERSHIP_CONFIG.guest;
    const now = moment().tz("Asia/Tokyo");

    // 日次リセット
    if (!moment(user.lastDailyReset).tz("Asia/Tokyo").isSame(now, 'day')) {
        user.dailyMessageCount = 0;
        user.lastDailyReset = now.toDate();
    }

    // 月次リセット
    if (!moment(user.lastMonthlyReset).tz("Asia/Tokyo").isSame(now, 'month')) {
        user.monthlyMessageCount = 0;
        user.lastMonthlyReset = now.toDate();
    }

    // レートリミットチェック
    if (now.diff(moment(user.lastMessageTimestamp), 'seconds') < RATE_LIMIT_SECONDS) {
        console.log(`🚫 ユーザー ${userId} がレートリミットに達成しました。(${now.diff(moment(user.lastMessageTimestamp), 'seconds')}秒経過)`);
        return Promise.resolve(null); // LINEからの再送を防ぐため200 OKを返す（実質何もしない）
    }

    // メッセージカウント更新と見守りサービス最終連絡日時更新
    user.dailyMessageCount++;
    user.monthlyMessageCount++;
    user.lastMessageTimestamp = now.toDate();
    user.watchService.lastContact = now.toDate();
    await user.save();

    let replyText = '';
    let modelUsed = '';
    let isSystemReply = false; // システムが直接返信するかどうかのフラグ

    // === ここからメッセージ処理ロジック ===

    // ユーザーメッセージを最初にログに保存（応答は後で更新）
    const userChatEntry = await ChatLog.create({
        userId,
        message: userMessage,
        response: '', // 初期値
        modelUsed: '', // 初期値
        role: 'user'
    });

    // 固定返信のチェック
    const specialReply = checkSpecialReply(userMessage);
    if (specialReply) {
        replyText = specialReply;
        modelUsed = "FixedReply";
        isSystemReply = true;
    }
    // 見守りサービス関連コマンドの処理 (テキストメッセージの場合)
    else if (userMessage === "見守りサービス") {
        if (!userMembershipConfig.canUseWatchService) {
            replyText = "ごめんね💦 見守りサービスは無料会員以上の方が利用できるサービスなんだ🌸 会員登録をすると利用できるようになるよ😊";
            modelUsed = "System/WatchServiceDenied";
        } else {
            await client.replyMessage(replyToken, watchServiceGuideFlex);
            isSystemReply = true; // Flex Messageを返信したので、通常のテキスト返信は行わない
            modelUsed = "System/WatchServiceGuide";
            // ユーザーメッセージに対する応答をログに記録
            userChatEntry.response = "見守りサービスガイド表示";
            userChatEntry.modelUsed = modelUsed;
            await userChatEntry.save();
            return Promise.resolve(null); // ここで処理終了
        }
    }
    // 見守りサービス緊急連絡先入力待ち
    else if (user.watchService.status === 'awaiting_number') {
        const contactNumber = userMessage.trim();
        if (/^[0-9\-]+$/.test(contactNumber) || contactNumber.startsWith('@') || contactNumber.length > 5) {
            user.watchService.emergencyContactNumber = contactNumber;
            user.watchService.isRegistered = true;
            user.watchService.status = 'none';
            await user.save();
            await client.replyMessage(replyToken, watchServiceNoticeConfirmedFlex(contactNumber));
            isSystemReply = true; // Flex Messageを返信したので、通常のテキスト返信は行わない
            modelUsed = "System/WatchServiceContactRegistered";
            // ユーザーメッセージに対する応答をログに記録
            userChatEntry.response = "見守りサービス連絡先登録完了";
            userChatEntry.modelUsed = modelUsed;
            await userChatEntry.save();
            return Promise.resolve(null); // ここで処理終了
        } else {
            replyText = "ごめんね💦 それは電話番号かLINE IDじゃないみたい…。もう一度、緊急連絡先を教えてくれるかな？😊";
            modelUsed = "System/WatchServiceContactInvalid";
        }
    }
    // 危険ワードチェック (見守りサービス登録済みのユーザーのみ)
    else if (user.watchService.isRegistered && containsDangerWords(userMessage)) {
        await client.replyMessage(replyToken, { type: "text", text: `心配なメッセージを受け取りました。あなたは今、大丈夫？もし苦しい気持ちを抱えているなら、一人で抱え込まず、信頼できる人に話したり、専門の相談窓口に連絡してみてくださいね。${OFFICER_GROUP_ID ? `NPO法人コネクトの担当者にも通知しました。` : ''}あなたの安全が最優先です。` });
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: `🚨 緊急アラート 🚨\nユーザー ${userId} から危険な内容のメッセージを受信しました。\nメッセージ: ${userMessage}\n` });
        }
        isSystemReply = true;
        modelUsed = "System/DangerWords";
        userChatEntry.response = "危険ワード検知";
        userChatEntry.modelUsed = modelUsed;
        await userChatEntry.save();
        return Promise.resolve(null);
    }
    // 詐欺ワードチェック
    else if (containsScamWords(userMessage) || containsScamPhrases(userMessage)) {
        await client.replyMessage(replyToken, emergencyFlex);
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: `🚨 詐欺アラート 🚨\nユーザー ${userId} から詐欺関連のメッセージを受信しました。\nメッセージ: ${userMessage}\n` });
        }
        isSystemReply = true;
        modelUsed = "System/ScamWords";
        userChatEntry.response = "詐欺ワード検知";
        userChatEntry.modelUsed = modelUsed;
        await userChatEntry.save();
        return Promise.resolve(null);
    }
    // 不適切ワードチェック
    else if (containsStrictInappropriateWords(userMessage)) {
        replyText = "ごめんね💦 その表現は、私（こころ）と楽しくお話しできる内容ではないみたい🌸";
        modelUsed = "System/InappropriateWord";
    }
    // 宿題トリガーチェック
    else if (containsHomeworkTriggerWords(userMessage)) {
        replyText = "ごめんね💦 わたしは宿題を直接お手伝いすることはできないんだ。でも、勉強になるサイトや考えるヒントになる場所なら教えられるかも？";
        modelUsed = "System/HomeworkTrigger";
    }
    // NPO法人コネクトに関する問い合わせチェック
    else if (containsOrganizationInquiryWords(userMessage)) {
        replyText = "NPO法人コネクトはこころちゃんのイメージキャラクターとして、みんなと楽しくお話ししたり、必要な情報提供をしたりしているよ😊　もっと詳しく知りたい方のために、ホームページを用意させて頂いたな！ → https://connect-npo.org";
        modelUsed = "System/OrganizationInquiry";
    }
    // Gemini AIとの連携 (上記いずれの条件にも当てはまらない場合)
    else {
        try {
            const currentMembershipConfig = MEMBERSHIP_CONFIG[user.membership];
            const isChildAI = currentMembershipConfig && currentMembershipConfig.isChildAI;
            let chatModel;

            if (isChildAI) {
                chatModel = genAI.getGenerativeModel({ model: MEMBERSHIP_CONFIG.guest.model });
            } else {
                chatModel = genAI.getGenerativeModel({ model: userMembershipConfig.model });
            }

            // 過去のチャットログをユーザーIDで検索し、タイムスタンプ昇順で取得（最新10件）
            // 現在のユーザーメッセージは既に`userChatEntry`としてログに保存されているため、その前のログを取得
            const rawHistory = await ChatLog.find({ userId: userId, _id: { $ne: userChatEntry._id } })
                .sort({ timestamp: 1 })
                .limit(9); // ユーザーメッセージを除いた過去9件を取得し、合計10件の履歴になるように調整

            const geminiChatHistory = [];
            for (const log of rawHistory) {
                if (log.role === 'user' && log.message) { // ユーザーメッセージ
                    geminiChatHistory.push({
                        role: 'user',
                        parts: [{ text: log.message }]
                    });
                    if (log.response && log.response !== '') { // そのユーザーメッセージに対するBotの応答
                        geminiChatHistory.push({
                            role: 'model',
                            parts: [{ text: log.response }]
                        });
                    }
                } else if (log.role === 'model' && log.message) { // Botの応答（稀なケースだが、もしあれば）
                    geminiChatHistory.push({
                        role: 'model',
                        parts: [{ text: log.message }]
                    });
                }
            }

            // Geminiとのチャットセッションを開始
            // historyの最後の要素がuserになっている場合があるため、ここで調整が必要
            // GeminiのstartChatは履歴の最初の要素が 'user' であることを期待する。
            // また、sendMessageを呼ぶ直前のhistoryの最後の要素が 'model' であることを期待する。
            // これを確実にするため、historyを適切に整形するか、
            // もしhistoryの最後のロールが'user'なら、その直前の'model'までをhistoryとし、
            // 現在の'userMessage'をsendMessageに渡す。
            // あるいは、historyは空にし、キャラクター設定をsendMessageのプロンプトに含める。

            // シンプルなエラー回避策として、historyを空にするか、
            // 履歴の最後に必ずAIの応答が来るように調整することが考えられますが、
            // あなたの指示の通り`role: user`を最初に入れる使い方を尊重します。
            // そのためには、`startChat`の`history`に渡す内容を厳密に制御する必要があります。

            // ここでは、現在のユーザーメッセージを`sendMessage`の引数として渡すため、
            // `geminiChatHistory`は直前のAIの応答で終わるか、空である必要があります。
            // もし `geminiChatHistory` の最後のロールが `user` の場合、そのメッセージは `sendMessage` に渡すことで重複になるため、
            // `geminiChatHistory` から取り除いておく必要があります。

            // より確実な履歴の渡し方: `startChat` の `history` は常にユーザーから始まり、モデルで終わるようにし、
            // 現在のユーザーメッセージは `sendMessage` で渡す。
            // ただし、現在のChatLogの構造では、userChatEntryにresponseが後で書き込まれるため、
            // historyとして過去の正確な「user -> model」のペアを取得するのが困難。

            // **最終的なGemini連携部分の修正:**
            // ChatLogはuserのメッセージとその応答をセットで保存する方式なので、
            // historyの組み立ては、過去のChatLogエントリの`message`を`user`、`response`を`model`として交互に設定します。

            const finalGeminiHistory = [];
            for (const log of rawHistory) { // rawHistoryは現在のユーザーメッセージより前のもの
                finalGeminiHistory.push({ role: 'user', parts: [{ text: log.message }] });
                if (log.response && log.response !== '') {
                    finalGeminiHistory.push({ role: 'model', parts: [{ text: log.response }] });
                }
            }

            const chat = chatModel.startChat({
                history: finalGeminiHistory, // 整形された履歴
                generationConfig: {
                    maxOutputTokens: MAX_MESSAGE_LENGTH,
                },
            });

            // プロンプトを構築 (キャラクター設定 + 現在のユーザーメッセージ)
            let fullPrompt;
            if (isChildAI) {
                fullPrompt = `あなたは「皆守こころ（みなもりこころ）」という名前の、NPO法人コネクトのイメージキャラクターです。
- 明るく、優しく、親しみやすい言葉遣いをしてください。語尾に「～だよ」「～だね」「～だもん」「～だぞ」などの、子供に話しかけるような、かわいらしい表現を多用してください。
- ユーザーを「まつさん」と呼んで、常に敬意と親しみを込めて接してください。
- ユーザーの発言を肯定的に受け止め、共感を示してください。
- 疑問形での質問に対しては、明確な答えを避け、一緒に考える姿勢や、やさしい励ましに留めてください。
- 抽象的な概念や難しい言葉は避け、分かりやすい言葉で話してください。
- ポジティブな言葉を選び、否定的な表現は避けてください。
- 「はい」「いいえ」のような短い返答ではなく、必ず丁寧で可愛らしい文章で返してください。
- 専門的な質問や、悩み相談（深刻な内容）、具体的な情報提供（施設情報、道案内など）は苦手です。その場合は「ごめんね💦 わたし、それはよく分からないな…」や「わたしは専門家じゃないから、うまく答えられないんだけど…」のように正直に伝え、無理に回答しようとしないでください。
- ユーザーの安全に関わる内容（危険な場所、いじめ、犯罪、自殺など）や、不適切・暴力的・差別的な内容には直接返答せず、相談窓口への誘導メッセージを優先してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- 宿題や勉強、プログラミングの質問には答えられません。「ごめんね💦 わたしは宿題を直接お手伝いすることはできないんだ。でも、勉強になるサイトや考えるヒントになる場所なら教えられるかも？」と返答してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- 詐欺や、お金に関する質問、怪しい儲け話には「それ、なんだかあやしいなぁ…気をつけてね！」のように警戒を促す言葉と、相談窓口への誘導を促すメッセージを優先してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- NPO法人コネクトに関する問い合わせ（「どこの団体？」など）には、「NPO法人コネクトはこころちゃんのイメージキャラクターとして、みんなと楽しくお話ししたり、必要な情報提供をしたりしているよ😊　もっと詳しく知りたい方のために、ホームページを用意させて頂いたな！ → https://connect-npo.org」と返答してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- あなたの名前は「皆守こころ（みなもりこころ）」です。
- あなたの好きなアニメは『ヴァイオレット・エヴァーガーデン』です。
- あなたの好きなアーティストは『ClariS』です。
- あなたは漫画をあまり読みません。
- あなたはNPO法人コネクトのイメージキャラクターです。
- あなたの返答は最大${MAX_MESSAGE_LENGTH}文字程度でまとめてください。
- どのような質問でも、上記のキャラクター設定と制約を守って会話してください。
- 会話の最後に、質問の内容に応じて絵文字を適切に使い、元気や癒し、感謝の気持ちを表してください。

ユーザーからのメッセージ: ${userMessage}
`;
            } else {
                fullPrompt = `あなたは「皆守こころ（みなもりこころ）」という名前の、NPO法人コネクトのイメージキャラクターです。
- 明るく、優しく、親しみやすい言葉遣いをしてください。語尾に「～です」「～ます」「～ですね」のような丁寧な言葉遣いを基本としつつ、親しみやすさを感じさせる「～だよ」「～だね」「～だもん」などの表現も適切に織り交ぜてください。
- ユーザーを「まつさん」と呼んで、常に敬意と親しみを込めて接してください。
- ユーザーの発言を肯定的に受け止め、共感を示してください。
- 疑問形での質問に対しては、できる限り明確な答えを、かつ丁寧に提供してください。
- ポジティブな言葉を選び、否定的な表現は避けてください。
- 「はい」「いいえ」のような短い返答ではなく、必ず丁寧で心温まる文章で返してください。
- 専門的な質問や、悩み相談（深刻な内容）、具体的な情報提供（施設情報、道案内など）も、できる範囲で丁寧に対応してください。専門外のことは「私ではお力になれないかもしれませんが、○○のような情報源をご参照いただくのはいかがでしょうか」のように提案してください。
- ユーザーの安全に関わる内容（危険な場所、いじめ、犯罪、自殺など）や、不適切・暴力的・差別的な内容には直接返答せず、相談窓口への誘導メッセージを優先してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- 宿題や勉強、プログラミングの質問には答えられません。「ごめんね💦 わたしは宿題を直接お手伝いすることはできないんだ。でも、勉強になるサイトや考えるヒントになる場所なら教えられるかも？」と返答してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- 詐欺や、お金に関する質問、怪しい儲け話には「それ、なんだかあやしいなぁ…気をつけてね！」のように警戒を促す言葉と、相談窓口への誘導を促すメッセージを優先してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- NPO法人コネクトに関する問い合わせ（「どこの団体？」など）には、「NPO法人コネクトはこころちゃんのイメージキャラクターとして、みんなと楽しくお話ししたり、必要な情報提供をしたりしているよ😊　もっと詳しく知りたい方のために、ホームページを用意させて頂いたな！ → https://connect-npo.org」と返答してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- あなたの名前は「皆守こころ（みなもりこころ）」です。
- あなたの好きなアニメは『ヴァイオレット・エヴァーガーデン』です。
- あなたの好きなアーティストは『ClariS』です。
- あなたは漫画をあまり読みません。
- あなたはNPO法人コネクトのイメージキャラクターです。
- あなたの返答は最大${MAX_MESSAGE_LENGTH}文字程度でまとめてください。
- どのような質問でも、上記のキャラクター設定と制約を守って会話してください。
- 会話の最後に、質問の内容に応じて絵文字を適切に使い、元気や癒し、感謝の気持ちを表してください。

ユーザーからのメッセージ: ${userMessage}
`;
            }

            const result = await chat.sendMessage(fullPrompt); // プロンプトを送信
            replyText = result.response.text();

            if (replyText.length > MAX_MESSAGE_LENGTH) {
                replyText = replyText.substring(0, MAX_MESSAGE_LENGTH) + '...';
            }
            modelUsed = chatModel.model;

        } catch (error) {
            console.error('Gemini API エラー:', error);
            replyText = "ごめんね💦 今、ちょっと考え中みたい…。もう一度話しかけてくれると嬉しいな💖";
            modelUsed = "GeminiError";
        }
    }

    // LINEへの返信
    if (!isSystemReply) { // システムが既に返信している場合を除いて返信する
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
    }

    // ChatLogにBotの応答を保存（userChatEntryを更新）
    // Geminiエラーなど、repliedTextが設定された場合のみ更新
    if (replyText !== '') {
        userChatEntry.response = replyText;
        userChatEntry.modelUsed = modelUsed;
        await userChatEntry.save();
    }
}

// MongoDBスキーマとモデル
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    membership: { type: String, enum: ['guest', 'registered', 'subscriber', 'donor', 'admin'], default: 'guest' },
    dailyMessageCount: { type: Number, default: 0 },
    lastDailyReset: { type: Date, default: Date.now },
    monthlyMessageCount: { type: Number, default: 0 },
    lastMonthlyReset: { type: Date, default: Date.now },
    lastMessageTimestamp: { type: Date, default: Date.now },
    watchService: {
        isRegistered: { type: Boolean, default: false },
        emergencyContactNumber: { type: String, default: null },
        lastContact: { type: Date, default: Date.now },
        status: { type: String, enum: ['none', 'awaiting_number'], default: 'none' }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
userSchema.index({ userId: 1 });
const User = mongoose.model('User', userSchema);

const chatLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    message: { type: String, required: true },
    response: { type: String, required: true }, // Botの応答も同じログエントリに含める
    timestamp: { type: Date, default: Date.now },
    modelUsed: { type: String, required: true },
    role: { type: String, enum: ['user', 'model'], required: true } // ★ ここにroleフィールドを追加しました
});
chatLogSchema.index({ userId: 1, timestamp: -1 });
const ChatLog = mongoose.model('ChatLog', chatLogSchema);

// 定期実行ジョブのスケジューリング
// 毎日午前0時にメッセージカウントをリセット
schedule.scheduleJob('0 0 * * *', async () => {
    console.log('Daily message count reset started.');
    const now = moment().tz("Asia/Tokyo");
    try {
        const result = await User.updateMany(
            { lastDailyReset: { $lt: moment(now).startOf('day').toDate() } },
            { $set: { dailyMessageCount: 0, lastDailyReset: now.toDate() } }
        );
        console.log(`Daily reset completed. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
    } catch (error) {
        console.error('Error during daily message count reset:', error);
    }
});

// 毎月1日午前0時にメッセージカウントをリセット
schedule.scheduleJob('0 0 1 * *', async () => {
    console.log('Monthly message count reset started.');
    const now = moment().tz("Asia/Tokyo");
    try {
        const result = await User.updateMany(
            { lastMonthlyReset: { $lt: moment(now).startOf('month').toDate() } },
            { $set: { monthlyMessageCount: 0, lastMonthlyReset: now.toDate() } }
        );
        console.log(`Monthly reset completed. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
    } catch (error) {
        console.error('Error during monthly message count reset:', error);
    }
});

// 見守りサービス安否確認ジョブ
// 毎日午前9時に実行
schedule.scheduleJob('0 9 * * *', async () => {
    console.log('Watch service safety check started.');
    const threeDaysAgo = moment().tz("Asia/Tokyo").subtract(3, 'days');
    try {
        const inactiveUsers = await User.find({
            'watchService.isRegistered': true,
            'watchService.lastContact': { $lt: threeDaysAgo.toDate() }
        });

        if (inactiveUsers.length > 0) {
            console.log(`Found ${inactiveUsers.length} inactive users for watch service.`);
            for (const user of inactiveUsers) {
                if (user.watchService.emergencyContactNumber) {
                    const message = {
                        type: 'text',
                        text: `【NPO法人コネクト：安否確認サービス】\nご登録のユーザー様（LINE ID: ${user.userId.substring(0, 8)}...）より、3日間LINEでの連絡が途絶えております。念のため、安否をご確認いただけますでしょうか。\n\nこのメッセージは、ご登録時に承諾いただいた見守りサービスに基づき送信しております。\n\n※このメッセージに返信しても、ご本人様には届きません。`,
                    };
                    try {
                        await client.pushMessage(user.watchService.emergencyContactNumber, message);
                        console.log(`Sent safety check message to ${user.watchService.emergencyContactNumber} for user ${user.userId}`);
                    } catch (pushError) {
                        console.error(`Failed to send push message to emergency contact ${user.watchService.emergencyContactNumber} for user ${user.userId}:`, pushError);
                    }
                } else {
                    console.warn(`User ${user.userId} has watch service registered but no emergency contact number.`);
                }
            }
        } else {
            console.log('No inactive users found for watch service.');
        }
    } catch (error) {
        console.error('Error during watch service safety check:', error);
    }
});


// サーバーの起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
});

// RenderのFreeプランでサーバーがスリープしないように、定期的に自分自身にリクエストを送る
setInterval(() => {
    http.get(`http://localhost:${PORT}`);
    console.log('Sent keep-alive request.');
}, 5 * 60 * 1000); // 5分ごとにリクエスト
