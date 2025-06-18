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
                                uri: "tel:0335010110" // 日本の警察相談専用電話は #9110 ですが、uriスキームではそのまま電話番号が使われるため、代表番号かそれに準ずる番号が良いでしょう。ここでは一般的な例を維持します。
                            }
                        }
                    ]
                }
            ]
        }
    }
};

// 見守りサービス 送信メッセージの定型文 (30パターン)
const WATCH_SERVICE_MESSAGES = [
    "こんにちは！こころだよ😊 今日も元気にしてるかな？ 私はね、昨日お庭で可愛いお花を見つけたんだ🌸 小さな幸せを見つけると、心がポカポカするよね💖 OKって送ってくれると嬉しいな🍀",
    "やっほー！こころだよ✨ 最近、夜は涼しくなってきたね🌙 窓を開けて寝ると気持ちいいけど、風邪ひかないように気をつけてね😊 OKって送ってくれると嬉しいな🍀",
    "おはよう！こころだよ🌸 今日は晴れてるね☀️ お洗濯日和かな？ 私は今日、新しい本を読み始めるのが楽しみなんだ📚 あなたも素敵な一日を過ごしてね💖 OKって送ってくれると嬉しいな🍀",
    "元気にしてるかな？こころだよ🍀 最近、美味しいもの食べた？ 私はこの前、カフェで可愛いパンケーキを食べたんだ🥞 小さなご褒美って嬉しいよね😊 OKって送ってくれると嬉しいな🍀",
    "こんばんわ！こころだよ🌙 今日はどんな一日だった？ 疲れてないかな？ 頑張った一日の終わりは、ゆっくり休んでね😌 おやすみ💖 OKって送ってくれると嬉しいな🍀",
    "こんにちは！こころだよ😊 最近、何か楽しいことあった？ 私はね、新しい歌を覚えるのが楽しいんだ🎶 歌を歌うと元気が出るよね💖 OKって送ってくれると嬉しいな🍀",
    "やっほー！こころだよ✨ 雨の日が続いてるね☔️ じめじめするけど、雨上がりの虹はとってもきれいだよね🌈 早く晴れるといいな😊 OKって送ってくれると嬉しいな🍀",
    "おはよう！こころだよ🌸 朝ごはん、ちゃんと食べたかな？ 私はパンと牛乳だったよ🍞🥛 元気に一日をスタートしようね💖 OKって送ってくれると嬉しいな🍀",
    "元気にしてる？こころだよ🍀 季節の変わり目だから、体調崩しやすいよね💦 無理しないで、あったかくして過ごしてね😊 OKって送ってくれると嬉しいな🍀",
    "こんばんわ！こころだよ🌙 夜空に星がたくさん見えてるかな？ 都会だと難しいかもしれないけど、たまには夜空を見上げてみてね✨ きっと癒されるよ💖 OKって送ってくれると嬉しいな🍀",
    "こんにちは！こころだよ😊 今日も笑顔で過ごせるといいな💖 どんな小さなことでも、嬉しいことがあったら教えてね✨ OKって送ってくれると嬉しいな🍀",
    "やっほー！こころだよ✨ もうすぐ夏だね🍉 夏になったら、かき氷食べたいなー🍧 あなたは夏にしたいことある？😊 OKって送ってくれると嬉しいな🍀",
    "おはよう！こころだよ🌸 昨日はぐっすり眠れたかな？ 良い睡眠は元気の源だよね😴 今日も一日がんばろうね💖 OKって送ってくれると嬉しいな🍀",
    "元気にしてるかな？こころだよ🍀 最近、散歩してる？ 私はお散歩しながら、道に咲いてるお花を見るのが好きなんだ🌼 ちょっとした発見が楽しいよ😊 OKって送ってくれると嬉しいな🍀",
    "こんばんわ！こころだよ🌙 今日はね、なんだかふわふわした気分なんだ☁️ そんな日もあるよね😊 ゆっくり休んで、また明日ね💖 OKって送ってくれると嬉しいな🍀",
    "こんにちは！こころだよ😊 今日はどんなことしてるのかな？ 楽しい時間になっているといいな✨ 私もあなたのこと、応援してるよ💖 OKって送ってくれると嬉しいな🍀",
    "やっほー！こころだよ✨ ジューンブライドの季節だね👰‍♀️✨ 幸せそうな人を見ると、私も嬉しくなるな💖 OKって送ってくれると嬉しいな🍀",
    "おはよう！こころだよ🌸 今日はちょっと肌寒いね🍃 羽織るもの一枚持っていくといいかも😊 風邪ひかないように気をつけてね💖 OKって送ってくれると嬉しいな🍀",
    "元気にしてる？こころだよ🍀 最近、運動してる？ 私は体を動かすと、気分がスッキリするから好きだな👟 無理なくね😊 OKって送ってくれると嬉しいな🍀",
    "こんばんわ！こころだよ🌙 夜ご飯は美味しかったかな？ 私はね、今日カレーライスを食べたんだ🍛 温かいご飯って幸せだよね💖 OKって送ってくれると嬉しいな🍀",
    "こんにちは！こころだよ😊 今日はちょっとどんよりしたお天気だけど、心は晴れやかに過ごそうね☀️ OKって送ってくれると嬉しいな🍀",
    "やっほー！こころだよ✨ 最近、何か新しいこと始めた？ 私はね、新しい手芸に挑戦しようかなって思ってるんだ🧶 ワクワクするね😊 OKって送ってくれると嬉しいな🍀",
    "おはよう！こころだよ🌸 スッキリ目覚められたかな？ 今日も一日、あなたのペースで頑張ってね💖 OKって送ってくれると嬉しいな🍀",
    "元気にしてるかな？こころだよ🍀 梅雨の時期は、気分が沈みがちになることもあるけど、美味しいものを食べたり、好きな音楽を聴いたりして乗り越えようね☔️🎶 OKって送ってくれると嬉しいな🍀",
    "こんばんわ！こころだよ🌙 今日はね、すごく眠たい日だったの😴 そんな日もあるよね😊 早めに休んで、また明日元気になろうね💖 OKって送ってくれると嬉しいな🍀",
    "こんにちは！こころだよ😊 今日はどんな一日だった？ 嬉しいこと、楽しいこと、あったかな？ OKって送ってくれると嬉しいな🍀",
    "やっほー！こころだよ✨ 最近、何か感動したことあった？ 私はね、この前読んだ本で涙が止まらなかったんだ😢 心が動かされるって素敵だよね💖 OKって送ってくれると嬉しいな🍀",
    "おはよう！こころだよ🌸 今日は何かいいことありそうかな？ 毎日が小さな発見と喜びに満ちてるといいな😊 OKって送ってくれると嬉しいな🍀",
    "元気にしてる？こころだよ🍀 暑い日が続いてるから、水分補給はしっかりね🥤 熱中症には気をつけてね😊 OKって送ってくれると嬉しいな🍀",
    "こんばんわ！こころだよ🌙 今日も一日お疲れ様😌 ゆっくり湯船に浸かって、疲れを癒してね🛀 また明日、元気なあなたに会えるのを楽しみにしているよ💖 OKって送ってくれると嬉しいな🍀"
];

// 24時間後の返信催促メッセージ
const WATCH_SERVICE_REMINDER_MESSAGE = (userName) => `元気にしてるかな？😌 メッセージ届いてるかなって、ちょっと心配になっちゃったよ。実はね、もしOKの返事がないと、家族の人に連絡がいっちゃうことになってるんだ💦 だから、もし大丈夫だったら、絵文字ひとつでもいいから「OK」って送ってくれると嬉しいな🍀 私も心配だし、家族の人にも迷惑かけたくないから、できるだけ早めに返事もらえると助かるな。無理はしないでね！`;


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
    const userId = event.source.userId;
    const replyToken = event.replyToken;
    let userMessage = '';
    let isPostbackEvent = false;

    // イベントタイプによる処理の分岐
    if (event.type === 'message' && event.message.type === 'text') {
        userMessage = event.message.text.trim();

        // "OK"メッセージの特殊処理
        if (userMessage.toUpperCase() === "OK") {
            const user = await User.findOne({ userId });
            if (user && user.watchService.isRegistered) {
                user.watchService.lastContact = moment().tz("Asia/Tokyo").toDate(); // 連絡日時を更新
                await user.save();
                console.log(`User ${userId} replied OK to watch service message.`);
                // OKメッセージに対するLINEボットからの返信は行わない
                return Promise.resolve(null);
            }
        }

    } else if (event.type === 'postback') {
        isPostbackEvent = true;
        const data = new URLSearchParams(event.postback.data);
        const action = data.get('action');
        userMessage = `[Postback Action: ${action}]`; // Postbackイベントもログに残せるようにメッセージ形式にする
    } else {
        return Promise.resolve(null); // テキストメッセージとPostback以外は処理しない
    }

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

    // レートリミットチェック (テキストメッセージの場合のみ)
    if (!isPostbackEvent && now.diff(moment(user.lastMessageTimestamp), 'seconds') < RATE_LIMIT_SECONDS) {
        console.log(`🚫 ユーザー ${userId} がレートリミットに達成しました。(${now.diff(moment(user.lastMessageTimestamp), 'seconds')}秒経過)`);
        return Promise.resolve(null);
    }

    // メッセージカウント更新と見守りサービス最終連絡日時更新
    user.dailyMessageCount++;
    user.monthlyMessageCount++;
    user.lastMessageTimestamp = now.toDate();
    // OK以外のメッセージでもlastContactを更新することで、見守りサービスのアクティブ状態を維持する
    user.watchService.lastContact = now.toDate(); 
    await user.save();

    let replyText = '';
    let modelUsed = '';
    let shouldReplyToLine = true; // LINEに返信するかどうかのフラグ
    let loggedAsSystemAction = false; // システムが主導したログかどうか

    // === ここからメッセージ処理ロジック ===

    if (isPostbackEvent) {
        const data = new URLSearchParams(event.postback.data);
        const action = data.get('action');

        if (action === 'watch_register') {
            if (user.watchService.isRegistered) {
                replyText = "すでに登録されているよ！🌸 緊急連絡先を変更したい場合は、新しい番号を送ってね😊";
            } else {
                user.watchService.status = 'awaiting_number';
                await user.save();
                replyText = "見守りサービスへのご登録ありがとう💖 緊急連絡先の電話番号（ハイフンなし）か、LINE IDを教えてくれるかな？間違えないように注意してね！😊";
            }
            modelUsed = "System/WatchServiceRegister";
        } else if (action === 'watch_unregister') {
            user.watchService.isRegistered = false;
            user.watchService.emergencyContactNumber = null;
            user.watchService.status = 'none';
            await user.save();
            replyText = "見守りサービスを解除したよ🌸 また利用したくなったら「見守りサービス」と話しかけてね😊";
            modelUsed = "System/WatchServiceUnregister";
        }
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await ChatLog.create({ userId, userMessage: userMessage, botResponse: replyText, modelUsed: modelUsed });
        return Promise.resolve(null); // Postback処理はここで終了
    }

    // 以下はテキストメッセージの場合の処理
    const originalUserMessage = userMessage; // ログ用に元のメッセージを保持

    // 固定返信のチェック
    const specialReply = checkSpecialReply(userMessage);
    if (specialReply) {
        replyText = specialReply;
        modelUsed = "FixedReply";
        loggedAsSystemAction = true;
    }
    // 見守りサービス関連コマンドの処理
    else if (userMessage === "見守りサービス") {
        if (!userMembershipConfig.canUseWatchService) {
            replyText = "ごめんね💦 見守りサービスは無料会員以上の方が利用できるサービスなんだ🌸 会員登録をすると利用できるようになるよ😊";
            modelUsed = "System/WatchServiceDenied";
        } else {
            await client.replyMessage(replyToken, watchServiceGuideFlex);
            shouldReplyToLine = false; // Flex Messageを返信したので、通常のテキスト返信は行わない
            replyText = "見守りサービスガイド表示"; // ログ用にテキストを設定
            modelUsed = "System/WatchServiceGuide";
            loggedAsSystemAction = true;
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
            shouldReplyToLine = false; // Flex Messageを返信したので、通常のテキスト返信は行わない
            replyText = "見守りサービス連絡先登録完了"; // ログ用にテキストを設定
            modelUsed = "System/WatchServiceContactRegistered";
            loggedAsSystemAction = true;
        } else {
            replyText = "ごめんね💦 それは電話番号かLINE IDじゃないみたい…。もう一度、緊急連絡先を教えてくれるかな？😊";
            modelUsed = "System/WatchServiceContactInvalid";
        }
    }
    // 危険ワードチェック (見守りサービス登録済みのユーザーのみ)
    else if (user.watchService.isRegistered && containsDangerWords(userMessage)) {
        replyText = `心配なメッセージを受け取りました。あなたは今、大丈夫？もし苦しい気持ちを抱えているなら、一人で抱え込まず、信頼できる人に話したり、専門の相談窓口に連絡してみてくださいね。${OFFICER_GROUP_ID ? `NPO法人コネクトの担当者にも通知しました。` : ''}あなたの安全が最優先です。`;
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: `🚨 緊急アラート 🚨\nユーザー ${userId} から危険な内容のメッセージを受信しました。\nメッセージ: ${userMessage}\n` });
        }
        modelUsed = "System/DangerWords";
        loggedAsSystemAction = true;
    }
    // 詐欺ワードチェック
    else if (containsScamWords(userMessage) || containsScamPhrases(userMessage)) {
        await client.replyMessage(replyToken, emergencyFlex);
        shouldReplyToLine = false; // Flex Messageを返信したので、通常のテキスト返信は行わない
        replyText = "詐欺アラートメッセージ表示"; // ログ用にテキストを設定
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: `🚨 詐欺アラート 🚨\nユーザー ${userId} から詐欺関連のメッセージを受信しました。\nメッセージ: ${userMessage}\n` });
        }
        modelUsed = "System/ScamWords";
        loggedAsSystemAction = true;
    }
    // 不適切ワードチェック
    else if (containsStrictInappropriateWords(userMessage)) {
        replyText = "ごめんね💦 その表現は、私（こころ）と楽しくお話しできる内容ではないみたい🌸";
        modelUsed = "System/InappropriateWord";
        loggedAsSystemAction = true;
    }
    // 宿題トリガーチェック
    else if (containsHomeworkTriggerWords(userMessage)) {
        replyText = "ごめんね💦 わたしは宿題を直接お手伝いすることはできないんだ。でも、勉強になるサイトや考えるヒントになる場所なら教えられるかも？";
        modelUsed = "System/HomeworkTrigger";
        loggedAsSystemAction = true;
    }
    // NPO法人コネクトに関する問い合わせチェック
    else if (containsOrganizationInquiryWords(userMessage)) {
        replyText = "NPO法人コネクトはこころちゃんのイメージキャラクターとして、みんなと楽しくお話ししたり、必要な情報提供をしたりしているよ😊　もっと詳しく知りたい方のために、ホームページを用意させて頂いたな！ → https://connect-npo.org";
        modelUsed = "System/OrganizationInquiry";
        loggedAsSystemAction = true;
    }
    // Gemini AIとの連携 (上記いずれの条件にも当てはまらない場合、または、上記で `replyText` が設定されているがLINEへの返信はまだの場合)
    if (!loggedAsSystemAction) { // システムによって既に確定した応答がない場合のみGeminiを呼び出す
        try {
            const currentMembershipConfig = MEMBERSHIP_CONFIG[user.membership];
            const isChildAI = currentMembershipConfig && currentMembershipConfig.isChildAI;
            let chatModel;

            if (isChildAI) {
                chatModel = genAI.getGenerativeModel({ model: MEMBERSHIP_CONFIG.guest.model });
            } else {
                chatModel = genAI.getGenerativeModel({ model: userMembershipConfig.model });
            }

            // 過去のチャットログを取得（最新10ターン）
            const rawHistory = await ChatLog.find({ userId: userId })
                .sort({ timestamp: 1 })
                .limit(10); // 過去10会話ターンを取得

            const geminiChatHistory = [];
            for (const log of rawHistory) {
                if (log.userMessage && log.botResponse) { // ユーザーメッセージとBot応答のペアがある場合
                    geminiChatHistory.push({ role: 'user', parts: [{ text: log.userMessage }] });
                    geminiChatHistory.push({ role: 'model', parts: [{ text: log.botResponse }] });
                }
            }
            
            const chat = chatModel.startChat({
                history: geminiChatHistory, // 整形された履歴を渡す
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

ユーザーからのメッセージ: ${originalUserMessage}
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

ユーザーからのメッセージ: ${originalUserMessage}
`;
            }

            const result = await chat.sendMessage(fullPrompt);
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
    if (shouldReplyToLine) {
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
    }

    // ChatLogにユーザーメッセージとBot応答のペアを保存
    // `originalUserMessage` と `replyText` をセットで保存する
    await ChatLog.create({
        userId: userId,
        userMessage: originalUserMessage,
        botResponse: replyText,
        modelUsed: modelUsed
    });
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

// ChatLogスキーマを会話ターンとして修正
const chatLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userMessage: { type: String, required: true }, // ユーザーのメッセージ
    botResponse: { type: String, required: true }, // ボットの応答
    timestamp: { type: Date, default: Date.now },
    modelUsed: { type: String, required: true }
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

// 見守りサービス：3日に一度、午後3時(15時)に定期メッセージを送信
schedule.scheduleJob('0 15 */3 * *', async () => {
    console.log('Watch service periodic message job started (3-day cycle, 3 PM).');
    try {
        const registeredUsers = await User.find({ 'watchService.isRegistered': true });

        for (const user of registeredUsers) {
            // 前回の連絡から3日以上経過しているユーザーにのみ送信
            // ジョブが3日に一度実行されるため、厳密に前回のメッセージ送信から3日経過したユーザーに絞る
            const threeDaysAgoFromScheduledTime = moment().tz("Asia/Tokyo").subtract(3, 'days').toDate();
            if (user.watchService.lastContact < threeDaysAgoFromScheduledTime) {
                const messageIndex = Math.floor(Math.random() * WATCH_SERVICE_MESSAGES.length);
                const messageText = WATCH_SERVICE_MESSAGES[messageIndex];
                try {
                    await client.pushMessage(user.userId, { type: 'text', text: messageText });
                    user.watchService.lastContact = moment().tz("Asia/Tokyo").toDate(); // 連絡日時を更新
                    await user.save();
                    console.log(`Sent periodic watch message to user ${user.userId}`);

                    // 24時間後にOK返信がない場合のリマインダーをスケジュール
                    // このジョブはpushMessageが成功した場合にのみスケジュールされます
                    // ユーザーがdisplayNameを持たない可能性を考慮し、デフォルト値を使用
                    // NOTE: getProfileはAPIコールなので、大量ユーザーだとレートリミットに注意
                    let userName = "あなた"; 
                    try {
                        const profile = await client.getProfile(user.userId);
                        userName = profile.displayName;
                    } catch (profileError) {
                        console.warn(`Could not get profile for user ${user.userId}:`, profileError);
                    }
                    
                    schedule.scheduleJob(moment().add(24, 'hours').toDate(), async () => {
                        const updatedUser = await User.findOne({ userId: user.userId });
                        // 最後の連絡が、この定期メッセージ送信時刻より後でなければ（＝OKが返ってきていなければ）
                        // 注意: lastContactの更新タイミングによっては、この条件が厳しすぎる可能性があります
                        // より柔軟にする場合は、別途OK返信フラグなどを持たせることも検討ください
                        if (updatedUser && moment(updatedUser.watchService.lastContact).isSameOrBefore(moment(user.watchService.lastContact))) {
                            const reminderMessage = WATCH_SERVICE_REMINDER_MESSAGE(userName);
                            try {
                                await client.pushMessage(updatedUser.userId, { type: 'text', text: reminderMessage });
                                console.log(`Sent 24-hour reminder to user ${updatedUser.userId}`);
                            } catch (reminderError) {
                                console.error(`Failed to send 24-hour reminder to user ${updatedUser.userId}:`, reminderError);
                            }
                        }
                    });

                } catch (pushError) {
                    console.error(`Failed to send periodic watch message to user ${user.userId}:`, pushError);
                }
            } else {
                console.log(`User ${user.userId} has recent contact or not yet 3 days since last message, skipping periodic message.`);
            }
        }
    } catch (error) {
        console.error('Error during watch service periodic message job:', error);
    }
});


// 見守りサービス安否確認ジョブ (緊急連絡先への通知)
// 毎日午前9時に実行（既存ロジック）
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
    // Renderでは環境変数RENDER_EXTERNAL_HOSTNAMEが公開されているため、それを利用すると良いでしょう
    const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
    http.get(`http://${hostname}`);
    console.log('Sent keep-alive request.');
}, 5 * 60 * 1000); // 5分ごとにリクエスト
