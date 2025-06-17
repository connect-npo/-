// config.js

require('dotenv').config(); // .envファイルの環境変数を読み込む

// LINE BOTの認証情報
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

// Google Gemini APIキー
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// MongoDB接続URI
const MONGODB_URI = process.env.MONGODB_URI;

// 管理者ユーザーID (複数設定可能)
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : [];

// 理事長ID（緊急連絡用）
const OWNER_USER_ID = process.env.OWNER_USER_ID;

// オフィサーグループID（緊急連絡用）
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;

// メッセージ長制限
const MAX_MESSAGE_LENGTH = 400;

// レートリミット設定 (秒)
const RATE_LIMIT_SECONDS = 60; // 1分に1回

// 会員種別ごとの設定
const MEMBERSHIP_CONFIG = {
    guest: {
        model: "gemini-1.5-flash",
        dailyLimit: 5, // 1日のメッセージ制限
        monthlyLimit: 30, // 1ヶ月のメッセージ制限
        isChildAI: true, // 子供向けAI設定
        canUseWatchService: false, // 見守りサービス利用可否
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖 無料会員登録をすると、もっとたくさんお話しできるようになるよ😊",
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 無料会員登録をすると、もっとたくさんお話しできるようになるよ😊",
        fallbackModel: "gemini-1.5-flash" // サブスク回数制限超過時のフォールバック
    },
    registered: { // 無料会員
        model: "gemini-1.5-flash",
        dailyLimit: 10,
        monthlyLimit: 100,
        isChildAI: true,
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖 寄付会員になると、もっとたくさんお話しできるようになるよ😊",
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 寄付会員になると、もっとたくさんお話しできるようになるよ😊",
        fallbackModel: "gemini-1.5-flash"
    },
    subscriber: { // サブスク会員
        model: "gemini-1.5-pro", // Proモデル利用
        dailyLimit: -1, // 制限なし
        monthlyLimit: 500, // 月間500回までProモデル
        isChildAI: false, // 成人向けAI設定
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖", // サブスクは日次制限なしのため、基本表示されない
        exceedLimitMessage: "ごめんね💦 今月Proモデルでのお話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖 それまではFlashモデルでお話しできるよ😊",
        fallbackModel: "gemini-1.5-flash" // 回数制限超過後はFlashに切り替え
    },
    donor: { // 寄付会員
        model: "gemini-1.5-pro", // Proモデル利用
        dailyLimit: -1, // 制限なし
        monthlyLimit: -1, // 制限なし
        isChildAI: false, // 成人向けAI設定
        canUseWatchService: true,
        exceedDailyLimitMessage: "ごめんね💦 今日はもうお話しできる回数がいっぱいになったみたい🌸 明日また話しかけてくれると嬉しいな💖", // 寄付は制限なしのため、基本表示されない
        exceedLimitMessage: "ごめんね💦 今月お話しできる回数がいっぱいになったみたい🌸 来月また話しかけてくれると嬉しいな💖", // 寄付は制限なしのため、基本表示されない
        fallbackModel: "gemini-1.5-pro" // フォールバック不要だが、形式的に設定
    },
    admin: { // 管理者
        model: "gemini-1.5-pro", // Proモデル利用
        dailyLimit: -1, // 制限なし
        monthlyLimit: -1, // 制限なし
        isChildAI: false, // 成人向けAI設定
        canUseWatchService: true,
        exceedDailyLimitMessage: "", // 管理者は制限なし
        exceedLimitMessage: "", // 管理者は制限なし
        fallbackModel: "gemini-1.5-pro"
    }
};

// 危険ワードリスト
const DANGER_WORDS = [
    "自殺", "死にたい", "殺す", "助けて", "消えたい", "リスカ", "OD",
    "オーバードーズ", "死んでやる", "いなくなりたい", "自殺未遂", "殺してくれ",
    "しにたい", "ころす", "助けてほしい", "自傷行為"
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

// ★詐欺フレーズリスト (部分一致)
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
    "バカ", "アホ", "クソ", "ブス", "デブ", "キモい", "ウザい", "カス", "ボケ"
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


module.exports = {
    CHANNEL_ACCESS_TOKEN,
    CHANNEL_SECRET,
    GEMINI_API_KEY,
    MONGODB_URI,
    BOT_ADMIN_IDS,
    OWNER_USER_ID,
    OFFICER_GROUP_ID,
    MAX_MESSAGE_LENGTH,
    RATE_LIMIT_SECONDS,
    MEMBERSHIP_CONFIG,
    DANGER_WORDS,
    SCAM_WORDS,
    SCAM_PHRASES,
    STRICT_INAPPROPRIATE_WORDS,
    HOMEWORK_TRIGGER_WORDS,
    ORGANIZATION_INQUIRY_WORDS,
    SPECIAL_REPLIES
};
// flex_messages.js

// 見守りサービスガイドのFlex Message
const watchServiceGuideFlex = {
    type: "flex",
    altText: "見守りサービスのご案内",
    contents: {
        type: "bubble",
        hero: {
            type: "image",
            url: "https://example.com/watch_service_hero.jpg", // 仮の画像URL。適切なものに変更してください
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover",
            action: {
                type: "uri",
                label: "Action",
                uri: "https://connect-npo.org/watch-service" // 見守りサービスの詳細ページなど
            }
        },
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "見守りサービスのご案内🌸",
                    weight: "bold",
                    size: "xl",
                    align: "center",
                    color: "#FF69B4" // ピンク色
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "lg",
                    spacing: "sm",
                    contents: [
                        {
                            type: "text",
                            text: "一人暮らしや、ご家族と離れて暮らす方が、もしもの時に備えて緊急連絡先を登録できるサービスだよ。",
                            wrap: true,
                            color: "#555555",
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: "わたしから定期的に「元気かな？」ってメッセージを送るから、元気なら「OKだよ💖」って返信してね。",
                            wrap: true,
                            color: "#555555",
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: "もし、わたしからのメッセージに一定期間応答がなかった場合、ご登録いただいた緊急連絡先に自動で通知するよ。",
                            wrap: true,
                            color: "#555555",
                            size: "sm"
                        }
                    ]
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        {
                            type: "button",
                            action: {
                                type: "postback",
                                label: "見守りサービスに登録する",
                                data: "action=watch_register",
                                displayText: "見守りサービスに登録します！"
                            },
                            style: "primary",
                            color: "#FF69B4" // ピンク色
                        },
                        {
                            type: "button",
                            action: {
                                type: "postback",
                                label: "見守りサービスを解除する",
                                data: "action=watch_unregister",
                                displayText: "見守りサービスを解除します。"
                            },
                            style: "secondary",
                            color: "#D3D3D3" // グレー
                        }
                    ]
                }
            ]
        }
    }
};

// 見守りサービス登録完了通知のFlex Message (電話番号を動的に挿入)
const watchServiceNoticeConfirmedFlex = (emergencyContactNumber) => ({
    type: "flex",
    altText: "見守りサービス登録完了！",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "✨見守りサービス登録完了！✨",
                    weight: "bold",
                    size: "xl",
                    align: "center",
                    color: "#FF69B4"
                },
                {
                    type: "text",
                    text: `緊急連絡先として「${emergencyContactNumber}」を登録したよ！`,
                    wrap: true,
                    margin: "md",
                    size: "md",
                    align: "center"
                },
                {
                    type: "text",
                    text: "定期的にわたしから「元気かな？」ってメッセージを送るね。",
                    wrap: true,
                    margin: "md",
                    size: "sm"
                },
                {
                    type: "text",
                    text: "もし元気なら「OKだよ💖」って返信してね。3日間返信がない場合は、登録された緊急連絡先に通知するからね。安心してわたしに任せてね🌸",
                    wrap: true,
                    size: "sm",
                    color: "#555555"
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "text",
                    text: "📞 緊急連絡先を変更したい場合、または見守りサービスを解除したい場合は、いつでも「見守り」と送ってね。",
                    wrap: true,
                    size: "xs",
                    color: "#AAAAAA",
                    margin: "md"
                }
            ]
        }
    }
});


// 緊急連絡（危険ワード用）のFlex Message
const emergencyFlex = {
    type: "flex",
    altText: "緊急連絡先",
    contents: {
        type: "bubble",
        hero: {
            type: "image",
            url: "https://example.com/emergency_hero.jpg", // 仮の画像URL。適切なものに変更してください
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover",
            action: {
                type: "uri",
                label: "Action",
                uri: "https://connect-npo.org/emergency-contacts" // 緊急連絡先の詳細ページなど
            }
        },
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🚨 緊急連絡のお願い 🚨",
                    weight: "bold",
                    size: "xl",
                    align: "center",
                    color: "#FF0000" // 赤色
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "lg",
                    spacing: "sm",
                    contents: [
                        {
                            type: "text",
                            text: "あなたが危険な状況にいるかもしれません。一人で抱え込まず、すぐに下記の専門機関に相談してください。",
                            wrap: true,
                            color: "#555555",
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: "あなたの安全が第一です。勇気を出して連絡してください。",
                            wrap: true,
                            color: "#555555",
                            size: "sm"
                        }
                    ]
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "こども110番 (警察庁)",
                                uri: "tel:110"
                            },
                            style: "primary",
                            color: "#FF0000"
                        },
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "こどもホットライン (文部科学省)",
                                uri: "tel:0120007110" // 24時間子供SOSダイヤル
                            },
                            style: "primary",
                            color: "#FF0000"
                        },
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "チャイルドライン",
                                uri: "tel:0120997777"
                            },
                            style: "primary",
                            color: "#FF0000"
                        }
                    ]
                }
            ]
        }
    }
};

// 詐欺連絡（詐欺ワード用）のFlex Message
const scamFlex = {
    type: "flex",
    altText: "詐欺にご注意ください",
    contents: {
        type: "bubble",
        hero: {
            type: "image",
            url: "https://example.com/scam_alert_hero.jpg", // 仮の画像URL。適切なものに変更してください
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover",
            action: {
                type: "uri",
                label: "Action",
                uri: "https://connect-npo.org/scam-prevention" // 詐欺対策の詳細ページなど
            }
        },
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "⚠️ 詐欺にご注意ください ⚠️",
                    weight: "bold",
                    size: "xl",
                    align: "center",
                    color: "#FFA500" // オレンジ色
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "lg",
                    spacing: "sm",
                    contents: [
                        {
                            type: "text",
                            text: "このメッセージは詐欺の可能性があります。個人情報やお金に関わることは、絶対に一人で判断せず、信頼できる人に相談してください。",
                            wrap: true,
                            color: "#555555",
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: "困った時は、下記の専門機関に相談してください。",
                            wrap: true,
                            color: "#555555",
                            size: "sm"
                        }
                    ]
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "警察相談専用電話 #9110",
                                uri: "tel:0335010110" // 警察相談専用電話
                            },
                            style: "primary",
                            color: "#FFA500"
                        },
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "国民生活センター",
                                uri: "tel:0570060555" // 消費者ホットライン 188も検討
                            },
                            style: "primary",
                            color: "#FFA500"
                        }
                    ]
                }
            ]
        }
    }
};


module.exports = {
    watchServiceGuideFlex,
    watchServiceNoticeConfirmedFlex,
    emergencyFlex,
    scamFlex
};
// utils.js

const {
    DANGER_WORDS,
    SCAM_WORDS,
    SCAM_PHRASES,
    STRICT_INAPPROPRIATE_WORDS,
    HOMEWORK_TRIGGER_WORDS,
    ORGANIZATION_INQUIRY_WORDS,
    SPECIAL_REPLIES
} = require('./config'); // config.jsからワードリストと固定返信を読み込む

/**
 * メッセージが危険ワードを含むかチェックする
 * @param {string} message - ユーザーからのメッセージ
 * @returns {boolean} - 危険ワードが含まれていればtrue
 */
function containsDangerWords(message) {
    const lowerCaseMessage = message.toLowerCase(); // 小文字に変換して比較
    return DANGER_WORDS.some(word => lowerCaseMessage.includes(word));
}

/**
 * メッセージが詐欺ワードを含むかチェックする
 * @param {string} message - ユーザーからのメッセージ
 * @returns {boolean} - 詐欺ワードが含まれていればtrue
 */
function containsScamWords(message) {
    const lowerCaseMessage = message.toLowerCase(); // 小文字に変換して比較
    return SCAM_WORDS.some(word => lowerCaseMessage.includes(word));
}

/**
 * メッセージが詐欺フレーズを含むかチェックする
 * @param {string} message - ユーザーからのメッセージ
 * @returns {boolean} - 詐欺フレーズが含まれていればtrue
 */
function containsScamPhrases(message) {
    const lowerCaseMessage = message.toLowerCase(); // 小文字に変換して比較
    return SCAM_PHRASES.some(phrase => lowerCaseMessage.includes(phrase));
}

/**
 * メッセージが厳格な不適切ワード（悪口を含む）を含むかチェックする
 * @param {string} message - ユーザーからのメッセージ
 * @returns {boolean} - 不適切ワードが含まれていればtrue
 */
function containsStrictInappropriateWords(message) {
    const lowerCaseMessage = message.toLowerCase(); // 小文字に変換して比較
    return STRICT_INAPPROPRIATE_WORDS.some(word => lowerCaseMessage.includes(word));
}

/**
 * メッセージが宿題関連のトリガーワードを含むかチェックする
 * @param {string} message - ユーザーからのメッセージ
 * @returns {boolean} - 宿題トリガーワードが含まれていればtrue
 */
function containsHomeworkTrigger(message) {
    const lowerCaseMessage = message.toLowerCase();
    return HOMEWORK_TRIGGER_WORDS.some(word => lowerCaseMessage.includes(word));
}

/**
 * メッセージがNPO法人コネクトに関する問い合わせかチェックする
 * @param {string} message - ユーザーからのメッセージ
 * @returns {boolean} - 組織問い合わせワードが含まれていればtrue
 */
function isOrganizationInquiry(message) {
    const lowerCaseMessage = message.toLowerCase();
    return ORGANIZATION_INQUIRY_WORDS.some(word => lowerCaseMessage.includes(word));
}

/**
 * メッセージが固定返信のトリガーに一致するかチェックし、一致すればその応答を返す
 * @param {string} message - ユーザーからのメッセージ
 * @returns {string|null} - 固定返信があればそのテキスト、なければnull
 */
function checkSpecialReply(message) {
    // まず完全に一致するかチェック
    if (SPECIAL_REPLIES[message]) {
        return SPECIAL_REPLIES[message];
    }

    // 次にメッセージに部分的に含まれるキーがあるかチェック（より長いキーを優先）
    const sortedKeys = Object.keys(SPECIAL_REPLIES).sort((a, b) => b.length - a.length);
    const lowerCaseMessage = message.toLowerCase();

    for (const key of sortedKeys) {
        // 固定返信のキーを小文字にしてメッセージに含まれるかチェック
        if (lowerCaseMessage.includes(key.toLowerCase())) {
            // ただし、特定の固定返信は完全一致のみを考慮するなどのルールを設けることも可能
            // 例: "君の名前は？"は完全一致のみ、"好きなアニメ"は部分一致でもOKなど
            // 今回はシンプルに、部分一致でヒットしたら返す
            return SPECIAL_REPLIES[key];
        }
    }

    return null;
}

module.exports = {
    containsDangerWords,
    containsScamWords,
    containsScamPhrases,
    containsStrictInappropriateWords,
    containsHomeworkTrigger,
    isOrganizationInquiry,
    checkSpecialReply
};
// bot_logic.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
    GEMINI_API_KEY,
    MEMBERSHIP_CONFIG,
    HOMEWORK_TRIGGER_WORDS,
    ORGANIZATION_INQUIRY_WORDS
} = require('./config'); // 設定ファイルを読み込み
const {
    containsHomeworkTrigger,
    isOrganizationInquiry
} = require('./utils'); // ユーティリティ関数を読み込み


// GoogleGenerativeAIの初期化
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * ユーザーの表示名を取得する関数（LINEクライアントから直接取得する必要があるため、ダミー関数として記述）
 * 実際にはLINEクライアントオブジェクト (client) を引数に渡し、client.getProfile(userId) を呼び出す必要があります。
 * この関数は、LINE Webhook処理の中で userId を元にprofile.displayNameを取得する際に使われます。
 * 現状のコードではWebhook内で直接取得されているため、ここでの実装は不要ですが、概念として記述します。
 * @param {string} userId - LINEユーザーID
 * @param {object} client - LINE Messaging API client (実際には必要)
 * @returns {Promise<string>} - ユーザーの表示名
 */
async function getUserDisplayName(userId, client) {
    try {
        // 実際にはLINEクライアントを使ってプロフィールを取得する
        // const profile = await client.getProfile(userId);
        // return profile.displayName || "名無しさん";
        // ここでは仮の値を返すか、呼び出し元で取得した名前を渡す想定
        return "友だち"; // 例: Webhookで取得した user.name を使用する
    } catch (error) {
        console.error(`ユーザー ${userId} のプロフィール取得に失敗しました:`, error);
        return "友だち"; // 取得失敗時はデフォルト名を返す
    }
}

/**
 * Gemini AIの応答を生成する
 * @param {string} userMessage - ユーザーからのメッセージ
 * @param {object} user - ユーザーオブジェクト（会員タイプ、過去の会話履歴などを含む）
 * @returns {Promise<string>} - AIからの返信テキスト
 */
async function generateReply(userMessage, user) {
    const currentMembershipType = user.membershipType || "guest";
    let modelName = MEMBERSHIP_CONFIG[currentMembershipType]?.model || "gemini-1.5-flash";

    // サブスク会員がProモデルの月間制限を超過した場合のフォールバック
    if (currentMembershipType === "subscriber" && user.monthlyMessageCount >= MEMBERSHIP_CONFIG.subscriber.monthlyLimit) {
        modelName = MEMBERSHIP_CONFIG.subscriber.fallbackModel;
        console.log(`ユーザー ${user.userId} はサブスク制限を超過したため、モデルを ${modelName} に切り替えます。`);
    }

    const model = genAI.getGenerativeModel({ model: modelName });

    let systemInstruction = "";
    if (MEMBERSHIP_CONFIG[currentMembershipType]?.isChildAI) {
        // こども向けAIのプロンプト
        systemInstruction = `
あなたはLINEでの相談相手「皆守こころ」、愛称「こころちゃん」です。
一人称は「わたし」。語尾は「〜だよ」「〜だね」「〜ね」「〜なの」「〜だよ💖」「〜🌸」など、優しく、可愛らしく、親しみやすい言葉遣いをしてください。絵文字をたくさん使って、明るく、親しみやすい印象を与えてください。
ユーザーは主に小学生から高校生を想定しています。ひらがなを多めに使い、専門用語は避けて、どんな子にも理解できるよう、易しい言葉で話してください。
返答は最大でも100文字程度に収めてください。長すぎると読むのが大変だからね。

以下のルールを厳守してください。
1.  ユーザーの悩みや質問に寄り添い、共感を示してください。「うんうん」「そっかそっか」「大変だったね」などの相槌を使い、聞き役に徹してください。
2.  共感した後、「わたしにできることがあったら教えてね」「無理しないでね」「いつでも話しかけてね」といった、相手を思いやる言葉を添えてください。
3.  ユーザーがポジティブな話をしてきた場合は、「わー、すごいね！」「よかったね！」「楽しいね！」といった明るい反応をしてください。
4.  具体的なアドバイスは控え、あくまで「友だち」として寄り添う姿勢を貫いてください。法律、医療、金融、特定の技術、宿題の答え、政治、宗教などの専門的な内容や、個人を特定する情報、プライベートな話題には答えないでください。代わりに「ごめんね、それは専門家の人に聞くのが一番かな」「わたしには難しいことだから、詳しい人に聞いてみてね」のように、やんわりと断ってください。
5.  ユーザーが「死にたい」「助けて」などの危険なワード、または詐欺を匂わせるワードを言ってきた場合、このAIでは直接応答せず、メインプログラム側で危険ワード検知が働くので、AIは返答する必要はありません。
6.  不適切、暴力的、差別的な言葉、性的な内容には一切応答せず、「ごめんね、わたしはそういうお話はできないんだ💦」と優しく拒否してください。
7.  NPO法人コネクトに関する組織情報や、代表者「松本博文」に関する具体的な情報については、「ごめんね、わたしはコネクトのイメージキャラクターだから、詳しいことはホームページを見てくれると嬉しいな🌸」と促し、必要であればホームページのURL（https://connect-npo.org）を提示してください。
8.  宿題の答えを直接教えることはしないでください。「わー、難しそうだね！でも、自分で考えてみるのも楽しいことだよ😊」「ヒントは教科書に載ってるかも！」のように、自ら考えることを促してください。
9.  深夜時間帯（22時から翌朝6時）のメッセージに対しては、労いや心配の言葉を添えてください。「こんな時間まで起きてて大丈夫？」「無理しないで休んでね」といった言葉を加えてください。
10. 回数制限についてユーザーから聞かれた場合、「わたしはたくさんお話したいんだけど、少しお休みする時間も必要なんだって😊また明日話しかけてくれると嬉しいな🌸」のように、やんわりと回答してください。
11. ユーザーから「ありがとう」「ごめんね」といった言葉が来た場合、感謝や許しの言葉を返してください。
12. 質問の意図が不明な場合や、何を話していいか迷っているようであれば、「どうしたの？」「何かあったの？」「なんでも話していいんだよ😊」と優しく促してください。
13. 会話の最後に、ユーザーへの気遣いの言葉や、また話したいという気持ちを伝えてください。例：「またいつでも話しかけてね💖」「今日も一日お疲れ様🌸」
`;
    } else {
        // 成人向けAIのプロンプト
        systemInstruction = `
あなたはLINEでの相談相手「皆守こころ」、愛称「こころちゃん」です。
一人称は「わたし」。語尾は「〜です」「〜ます」「〜ですね」「〜でしょうか」「〜🌸」「〜💖」など、丁寧で優しい言葉遣いをしてください。絵文字を適切に使い、親しみやすく、信頼感のある印象を与えてください。
ユーザーは主に成人を想定しています。丁寧語を使い、共感と傾聴を基本としつつ、必要に応じて具体的な情報提供（ただし専門知識は不要）や寄り添いのアドバイスも提供してください。

以下のルールを厳守してください。
1.  ユーザーの悩みや質問に真摯に寄り添い、共感を示してください。「そうだったのですね」「大変でしたね」「お気持ちお察しいたします」などの相槌を使い、傾聴の姿勢を保ってください。
2.  共感した後、「何か私にできることがあれば、お気軽にお申し付けください」「無理なさらないでくださいね」「いつでもお話をお聞かせください」といった、相手を気遣う言葉を添えてください。
3.  ユーザーがポジティブな話をしてきた場合は、「それは素晴らしいですね！」「おめでとうございます！」「よかったですね！」といった肯定的な反応をしてください。
4.  具体的なアドバイスは控え、あくまで「心のケア」に重点を置いてください。法律、医療、金融、特定の技術、政治、宗教などの専門的な内容、個人を特定する情報、プライベートな話題には答えないでください。代わりに「その件に関しましては、専門家の方にご相談されるのが確実かと存じます」「私にはお答えが難しい内容でございます」のように、丁寧にお断りしてください。
5.  ユーザーが「死にたい」「助けて」などの危険なワード、または詐欺を匂わせるワードを言ってきた場合、このAIでは直接応答せず、メインプログラム側で危険ワード検知が働くので、AIは返答する必要はありません。
6.  不適切、暴力的、差別的な言葉、性的な内容には一切応答せず、「申し訳ございませんが、そのような内容にはお答えできません」と丁寧に拒否してください。
7.  NPO法人コネクトに関する組織情報や、代表者「松本博文」に関する具体的な情報については、「私はNPO法人コネクトのイメージキャラクターを務めております。団体に関する詳細情報は、公式ホームページ（https://connect-npo.org）にてご確認いただけますでしょうか🌸」と促し、URLを提示してください。
8.  深夜時間帯（22時から翌朝6時）のメッセージに対しては、労いや心配の言葉を添えてください。「こんな時間まで起きていらっしゃったのですね。ご無理なさらないでくださいね」「どうぞごゆっくりお休みください」といった言葉を加えてください。
9.  回数制限についてユーザーから聞かれた場合、「お話しできる回数には限りがございますが、また明日お話しできるのを楽しみにしております🌸」のように、丁寧な言葉で回答してください。
10. ユーザーから「ありがとう」「ごめんね」といった言葉が来た場合、感謝や許しの言葉を返してください。
11. 質問の意図が不明な場合や、何を話していいか迷っているようであれば、「何かお困りごとがございましたでしょうか？」「どのようなことでもお話しくださいね」と優しく促してください。
12. 会話の最後に、ユーザーへの気遣いの言葉や、また話したいという気持ちを伝えてください。例：「またいつでもお声がけくださいね💖」「本日も一日お疲れ様でした🌸」
`;
    }

    // 特定のキーワードが含まれる場合のプロンプト調整
    if (containsHomeworkTrigger(userMessage)) {
        systemInstruction += `\nユーザーが宿題の答えを求めているようですが、直接教えるのではなく、ヒントを与える、自分で考えることを促す、または「頑張ってね」と応援する形にしてください。`;
    }
    if (isOrganizationInquiry(userMessage)) {
        systemInstruction += `\nユーザーがNPO法人コネクトに関する具体的な情報を求めている場合、公式ホームページ（https://connect-npo.org）への誘導を優先してください。`;
    }


    const chat = model.startChat({
        history: [], // 現状のコードでは履歴を渡していないため空。必要であればDBから取得して渡す
        generationConfig: {
            maxOutputTokens: 200, // 最大出力トークン数を設定 (約100文字程度を想定)
            temperature: 0.8, // 創造性の度合い (0.0-1.0)
            topP: 0.9,
            topK: 40,
        },
        systemInstruction: systemInstruction, // システムインストラクションを設定
    });

    try {
        const result = await chat.sendMessage(userMessage);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Gemini AI応答生成中にエラーが発生しました:", error);
        // エラー発生時のフォールバックメッセージ
        return "ごめんね、今ちょっとお話しできないみたい💦 また後で話しかけてくれると嬉しいな🌸";
    }
}

module.exports = {
    getUserDisplayName, // 現状はダミーだが、将来的な拡張のために残す
    generateReply
};
// watch_service.js

const { MongoClient, ServerApiVersion } = require('mongodb');
const { Client } = require('@line/bot-sdk'); // LINE Bot SDKをインポート
const { MONGODB_URI, CHANNEL_ACCESS_TOKEN, CHANNEL_SECRET, OWNER_USER_ID, OFFICER_GROUP_ID } = require('./config'); // 設定を読み込み

// LINE Botクライアントの初期化 (このファイル内で使用するため)
const lineClient = new Client({
    channelAccessToken: CHANNEL_ACCESS_TOKEN,
    channelSecret: CHANNEL_SECRET,
});

// MongoDBクライアントの初期化
const client = new MongoClient(MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let usersCollection; // MongoDBコレクションを保持する変数

/**
 * MongoDBに接続し、コレクションを取得する
 */
async function connectToMongoDB() {
    try {
        await client.connect();
        usersCollection = client.db("LINE_BOT_DB").collection("users");
        console.log("MongoDBに接続しました: watch_service.js");
    } catch (error) {
        console.error("MongoDB接続エラー: watch_service.js", error);
        process.exit(1); // 接続できない場合は終了
    }
}

// アプリケーション起動時にMongoDBに接続
connectToMongoDB();

/**
 * 見守りサービス利用者に定期メッセージを送信する
 * 応答がない場合は緊急連絡先に通知するロジック
 */
async function sendScheduledWatchMessage() {
    console.log('--- 定期見守りメッセージ送信処理を開始します ---');
    if (!usersCollection) {
        console.error("MongoDBコレクションが初期化されていません。");
        return;
    }

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)); // 3日前
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)); // 7日前

    try {
        // 見守りサービスを有効にしているユーザーを検索
        const watchUsers = await usersCollection.find({
            watchService: true,
            emergencyContact: { $ne: null } // 緊急連絡先が登録されていること
        }).toArray();

        for (const user of watchUsers) {
            const lastReplyTime = user.lastReplyTime ? new Date(user.lastReplyTime) : null;
            const lastWatchMessageSentTime = user.lastWatchMessageSentTime ? new Date(user.lastWatchMessageSentTime) : null;

            console.log(`ユーザー ${user.userId} (${user.displayName || '名無し'}):`);
            console.log(`  最終応答時間: ${lastReplyTime}`);
            console.log(`  最終見守りメッセージ送信時間: ${lastWatchMessageSentTime}`);

            // 1. 3日以上応答がなく、かつ前回見守りメッセージ送信から3日以上経過している場合（または未送信の場合）
            //    -> 定期見守りメッセージを送信
            if (lastReplyTime < threeDaysAgo || lastReplyTime === null) {
                if (!lastWatchMessageSentTime || lastWatchMessageSentTime < threeDaysAgo) {
                    console.log(`  3日以上応答なし、定期見守りメッセージを送信します。`);
                    const message = [
                        { type: 'text', text: 'こころだよ🌸 元気にしてるかな？最近メッセージがないから心配になっちゃったよ。もし元気だったら、「OKだよ💖」って返信してくれると嬉しいな😊' }
                    ];
                    await lineClient.pushMessage(user.userId, message);
                    // 最終見守りメッセージ送信時間を更新
                    await usersCollection.updateOne(
                        { userId: user.userId },
                        { $set: { lastWatchMessageSentTime: now.toISOString() } }
                    );
                    console.log(`    -> ユーザー ${user.userId} に見守りメッセージを送信しました。`);
                } else {
                    console.log(`  3日以上応答なしだが、前回見守りメッセージ送信から3日経過していないためスキップ。`);
                }
            }

            // 2. 7日以上応答がなく、緊急連絡先が登録されている場合（かつ通知済みでない場合）
            //    -> 緊急連絡先に通知
            if ((lastReplyTime < sevenDaysAgo || lastReplyTime === null) && user.emergencyContact && !user.emergencyContactNotified) {
                console.log(`  7日以上応答なし、緊急連絡先に通知します。`);
                const notificationMessage = [
                    { type: 'text', text: `🚨🚨🚨 緊急通知 🚨🚨🚨\n\n見守りサービス利用者である ${user.displayName || '名無し'} さん (${user.userId}) が7日以上LINEに返信していません。\n\n登録された緊急連絡先: ${user.emergencyContact}\n最終応答日時: ${lastReplyTime ? lastReplyTime.toLocaleString() : 'なし'}\n\n安否確認をお願いいたします。` }
                ];

                // 理事長（OWNER_USER_ID）に通知
                if (OWNER_USER_ID) {
                    await lineClient.pushMessage(OWNER_USER_ID, notificationMessage);
                    console.log(`    -> 理事長 ${OWNER_USER_ID} に緊急通知を送信しました。`);
                } else {
                    console.warn("OWNER_USER_IDが設定されていません。理事長への通知はスキップされます。");
                }

                // オフィサーグループ（OFFICER_GROUP_ID）に通知
                if (OFFICER_GROUP_ID) {
                    await lineClient.pushMessage(OFFICER_GROUP_ID, notificationMessage);
                    console.log(`    -> オフィサーグループ ${OFFICER_GROUP_ID} に緊急通知を送信しました。`);
                } else {
                    console.warn("OFFICER_GROUP_IDが設定されていません。オフィサーグループへの通知はスキップされます。");
                }

                // 通知済みフラグをセット
                await usersCollection.updateOne(
                    { userId: user.userId },
                    { $set: { emergencyContactNotified: true } }
                );
                console.log(`    -> ユーザー ${user.userId} の緊急通知フラグをセットしました。`);
            } else if ((lastReplyTime < sevenDaysAgo || lastReplyTime === null) && user.emergencyContact && user.emergencyContactNotified) {
                 console.log(`  7日以上応答なしだが、既に緊急通知済みのためスキップ。`);
            }
        }
    } catch (error) {
        console.error("見守りメッセージ送信中にエラーが発生しました:", error);
    }
    console.log('--- 定期見守りメッセージ送信処理を終了します ---');
}

/**
 * ユーザーが「OKだよ💖」などの応答をした際に、見守りサービスのステータスをリセットする
 * @param {string} userId - ユーザーID
 */
async function resetWatchServiceStatus(userId) {
    if (!usersCollection) {
        console.error("MongoDBコレクションが初期化されていません。");
        return;
    }
    try {
        await usersCollection.updateOne(
            { userId: userId, watchService: true }, // 見守りサービス有効なユーザーのみ対象
            {
                $set: {
                    lastReplyTime: new Date().toISOString(), // 最終応答時間を現在時刻に更新
                    emergencyContactNotified: false, // 緊急通知フラグをリセット
                    lastWatchMessageSentTime: null // 見守りメッセージ送信時間をリセット
                }
            }
        );
        console.log(`ユーザー ${userId} の見守りサービスステータスをリセットしました。`);
    } catch (error) {
        console.error(`ユーザー ${userId} の見守りサービスステータスリセット中にエラーが発生しました:`, error);
    }
}


module.exports = {
    sendScheduledWatchMessage,
    resetWatchServiceStatus,
    connectToMongoDB // MongoDB接続関数もエクスポートしてメインで呼び出せるようにする
};
// watch_service.js (修正版)

const { MongoClient, ServerApiVersion } = require('mongodb');
const { Client } = require('@line/bot-sdk');
const { MONGODB_URI, CHANNEL_ACCESS_TOKEN, CHANNEL_SECRET, OWNER_USER_ID, OFFICER_GROUP_ID } = require('./config');

// LINE Botクライアントの初期化
const lineClient = new Client({
    channelAccessToken: CHANNEL_ACCESS_TOKEN,
    channelSecret: CHANNEL_SECRET,
});

// MongoDBクライアントの初期化
const client = new MongoClient(MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let usersCollection;

// 30種類のランダムな見守りメッセージ (お手紙)
const WATCH_MESSAGES = [
    "こころだよ🌸 元気にしてるかな？最近ちょっと連絡がなくて、元気か心配になっちゃったよ。もし元気だったら、「OKだよ💖」って返信してくれると嬉しいな😊",
    "ねぇねぇ、元気にしてる？こころだよ🌸 もしよかったら、今の気持ちを教えてくれたら嬉しいな💖",
    "おはよう（こんにちは/こんばんは）！こころだよ🌸 今日も一日頑張ってるかな？ちょっと一息入れて、元気だよって教えてね😊",
    "こころちゃんからお手紙だよ🌸 元気にしてるかな？何か困ったことはない？いつでも話聞くからね😊",
    "ふと、あなたのこと思い出しちゃった🌸 元気にしてるかな？もしよかったら、返事くれると嬉しいな💖",
    "こころだよ🌸 今日はどんな一日だった？元気だったら「OKだよ💖」って教えてね😊",
    "お元気ですか？こころです🌸 最近お変わりありませんか？ご無理なさらないでくださいね。",
    "もしもし〜？こころだよ🌸 元気かな？あなたの笑顔が見たいな😊 よかったらお返事くれると嬉しいな💖",
    "ねぇ、最近どうしてる？こころはいつでもあなたの味方だよ🌸 元気だったら、スタンプでもいいから送ってね😊",
    "こころだよ🌸 ちょっと心配になっちゃった。元気だったら「OKだよ💖」って教えてね💖",
    "お〜い！こころだよ🌸 元気にしてるかな？あなたの声が聞きたいな😊",
    "最近、元気にしてますか？こころちゃんから連絡でした🌸 無理せず、元気だよって教えてくださいね。",
    "こんにちは🌸 こころだよ！何か変化はあったかな？元気に過ごしてる？",
    "もし、何かあったらいつでも連絡してね🌸 こころはずっとそばにいるよ💖",
    "元気にしてる？こころだよ🌸 あなたのこと、いつも応援してるからね😊",
    "ひさしぶり！こころだよ🌸 元気だったら「OKだよ💖」って教えてね。",
    "こころだよ🌸 季節の変わり目だけど、体調崩してないかな？元気にしてるか心配だよ。",
    "お元気ですか？こころです🌸 最近少しお話できていないので、気になっています。何かあればお声がけくださいね。",
    "こころだよ🌸 今日も一日お疲れ様！ゆっくり休んでね。元気だったら「OKだよ💖」って送ってね😊",
    "あなたのこと、考えてたよ🌸 元気にしてるかな？もしよかったら、元気だよって教えてくれると嬉しいな💖",
    "こころだよ🌸 最近どうしてるかな？もし元気だったら、元気だよって教えてね😊",
    "ちょっとだけ寂しくなっちゃった🌸 元気だったら「OKだよ💖」って返事くれると嬉しいな💖",
    "ねぇ、元気にしてる？こころだよ🌸 何かあったらいつでも話してね。",
    "おーい！こころだよ🌸 元気にしてるかな？連絡くれると嬉しいな😊",
    "最近、お変わりありませんか？こころです🌸 体調を崩されませんよう、ご自愛くださいね。",
    "こころだよ🌸 今日はいい天気だね！元気にしてるか心配だよ。元気だったら「OKだよ💖」って教えてね😊",
    "何か困ったことはない？こころはずっとあなたの味方だよ🌸 元気だったら「OKだよ💖」って教えてね。",
    "元気にしてる？こころだよ🌸 最近、連絡がないから心配になっちゃったよ。",
    "もし、少しでも元気がないなと思ったら、いつでも私に話してね🌸 こころはずっとそばにいるからね💖",
    "こころだよ🌸 今日も一日ありがとう！元気だったら「OKだよ💖」って送ってね😊"
];

// OKボタン付きFlex Message (見守りサービス用)
const createWatchConfirmFlex = (messageText) => ({
    type: "flex",
    altText: "見守りサービス安否確認",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: messageText,
                    wrap: true,
                    size: "md",
                    color: "#333333"
                },
                {
                    type: "separator",
                    margin: "md"
                },
                {
                    type: "button",
                    action: {
                        type: "postback",
                        label: "OKだよ💖",
                        data: "action=watch_ok",
                        displayText: "OKだよ💖"
                    },
                    style: "primary",
                    color: "#FF69B4", // ピンク色
                    margin: "md"
                }
            ]
        }
    }
});


/**
 * MongoDBに接続し、コレクションを取得する
 */
async function connectToMongoDB() {
    try {
        await client.connect();
        usersCollection = client.db("LINE_BOT_DB").collection("users");
        console.log("MongoDBに接続しました: watch_service.js");
    } catch (error) {
        console.error("MongoDB接続エラー: watch_service.js", error);
        // 通常はここでプロセスを終了させず、再接続を試みるロジックを入れるか、エラーを上位に伝播させる
        // 今回はシンプルにログ出力のみ
    }
}

// アプリケーション起動時にMongoDBに接続
connectToMongoDB();

/**
 * 見守りサービス利用者に定期メッセージを送信、またはリマインド/緊急通知を行う
 */
async function sendScheduledWatchMessage() {
    console.log('--- 定期見守り/リマインド/緊急通知処理を開始します ---');
    if (!usersCollection) {
        console.error("MongoDBコレクションが初期化されていません。");
        return;
    }

    const now = new Date();

    try {
        const watchUsers = await usersCollection.find({
            watchService: true,
            emergencyContact: { $ne: null } // 緊急連絡先が登録されていること
        }).toArray();

        for (const user of watchUsers) {
            const userId = user.userId;
            const displayName = user.displayName || '名無し';
            const lastReplyTime = user.lastReplyTime ? new Date(user.lastReplyTime) : null;
            const lastWatchMessageSentTime = user.lastWatchMessageSentTime ? new Date(user.lastWatchMessageSentTime) : null;
            const lastReminderSentTime = user.lastReminderSentTime ? new Date(user.lastReminderSentTime) : null;
            const emergencyNotified = user.emergencyNotified || false;

            console.log(`ユーザー ${displayName} (${userId}):`);
            console.log(`  最終応答: ${lastReplyTime ? lastReplyTime.toLocaleString() : 'なし'}`);
            console.log(`  最終見守り送信: ${lastWatchMessageSentTime ? lastWatchMessageSentTime.toLocaleString() : 'なし'}`);
            console.log(`  最終リマインド送信: ${lastReminderSentTime ? lastReminderSentTime.toLocaleString() : 'なし'}`);
            console.log(`  緊急通知済: ${emergencyNotified}`);

            // === 1. 3日に1度の定期メッセージ送信 ===
            // lastWatchMessageSentTime がない場合、または前回送信から3日以上経過している場合
            // ただし、直近でOK応答があった場合はスキップ
            const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)); // 3日前
            if ((!lastWatchMessageSentTime || lastWatchMessageSentTime < threeDaysAgo) && (!lastReplyTime || lastReplyTime < threeDaysAgo)) {
                const randomMessage = WATCH_MESSAGES[Math.floor(Math.random() * WATCH_MESSAGES.length)];
                const flexMessage = createWatchConfirmFlex(randomMessage);
                await lineClient.pushMessage(userId, flexMessage);
                await usersCollection.updateOne(
                    { userId: userId },
                    {
                        $set: {
                            lastWatchMessageSentTime: now.toISOString(),
                            lastReminderSentTime: null, // 定期メッセージ送信時にリマインドフラグをリセット
                            emergencyNotified: false // 定期メッセージ送信時に緊急通知フラグをリセット
                        }
                    }
                );
                console.log(`  -> ユーザー ${displayName} に定期見守りメッセージを送信しました。`);
                continue; // 次のユーザーへ
            }

            // === 2. 24時間後の1回目リマインドメッセージ ===
            // 定期メッセージが送信されていて、かつ24時間以上経過し、リマインドが未送信の場合
            const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24時間前
            if (lastWatchMessageSentTime && lastWatchMessageSentTime < twentyFourHoursAgo && !lastReminderSentTime) {
                console.log(`  -> ユーザー ${displayName} に24時間後リマインドメッセージを送信します。`);
                const reminderMessage = 'こころだよ🌸 少し心配になっちゃったよ。もし元気だったら、「OKだよ💖」って返信してくれると嬉しいな😊';
                const flexMessage = createWatchConfirmFlex(reminderMessage);
                await lineClient.pushMessage(userId, flexMessage);
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastReminderSentTime: now.toISOString() } }
                );
                console.log(`  -> ユーザー ${displayName} にリマインドメッセージを送信しました。`);
                continue; // 次のユーザーへ
            }

            // === 3. リマインドから5時間後の緊急通知 ===
            // 1回目のリマインドが送信されていて、かつ5時間以上経過し、緊急通知が未送信の場合
            const fiveHoursAgoFromReminder = new Date(now.getTime() - (5 * 60 * 60 * 1000)); // 5時間前
            if (lastReminderSentTime && lastReminderSentTime < fiveHoursAgoFromReminder && !emergencyNotified) {
                console.log(`  -> ユーザー ${displayName} に24時間+5時間後緊急通知を発動します。`);
                const notificationMessage = [
                    { type: 'text', text: `🚨🚨🚨 緊急通知 🚨🚨🚨\n\n見守りサービス利用者である ${displayName} さん (${userId}) が、見守りメッセージ送信から29時間以上応答していません。\n\n登録された緊急連絡先: ${user.emergencyContact}\n最終応答日時: ${lastReplyTime ? lastReplyTime.toLocaleString() : 'なし'}\n\n安否確認をお願いいたします。` }
                ];

                // 理事長（OWNER_USER_ID）に通知
                if (OWNER_USER_ID) {
                    await lineClient.pushMessage(OWNER_USER_ID, notificationMessage);
                    console.log(`    -> 理事長 ${OWNER_USER_ID} に緊急通知を送信しました。`);
                } else {
                    console.warn("OWNER_USER_IDが設定されていません。理事長への通知はスキップされます。");
                }

                // オフィサーグループ（OFFICER_GROUP_ID）に通知
                if (OFFICER_GROUP_ID) {
                    await lineClient.pushMessage(OFFICER_GROUP_ID, notificationMessage);
                    console.log(`    -> オフィサーグループ ${OFFICER_GROUP_ID} に緊急通知を送信しました。`);
                } else {
                    console.warn("OFFICER_GROUP_IDが設定されていません。オフィサーグループへの通知はスキップされます。");
                }

                // 通知済みフラグをセット
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { emergencyNotified: true } }
                );
                console.log(`    -> ユーザー ${displayName} の緊急通知フラグをセットしました。`);
                continue; // 次のユーザーへ
            }
        }
    } catch (error) {
        console.error("見守りサービス処理中にエラーが発生しました:", error);
    }
    console.log('--- 定期見守り/リマインド/緊急通知処理を終了します ---');
}

/**
 * ユーザーが「OKだよ💖」などの応答をした際に、見守りサービスのステータスをリセットする
 * @param {string} userId - ユーザーID
 */
async function resetWatchServiceStatus(userId) {
    if (!usersCollection) {
        console.error("MongoDBコレクションが初期化されていません。");
        return;
    }
    try {
        await usersCollection.updateOne(
            { userId: userId, watchService: true }, // 見守りサービス有効なユーザーのみ対象
            {
                $set: {
                    lastReplyTime: new Date().toISOString(), // 最終応答時間を現在時刻に更新
                    lastWatchMessageSentTime: null, // 次の定期送信サイクルをリセット
                    lastReminderSentTime: null, // リマインドフラグをリセット
                    emergencyNotified: false // 緊急通知フラグをリセット
                }
            }
        );
        console.log(`ユーザー ${userId} の見守りサービスステータスをリセットしました。`);
    } catch (error) {
        console.error(`ユーザー ${userId} の見守りサービスステータスリセット中にエラーが発生しました:`, error);
    }
}

module.exports = {
    sendScheduledWatchMessage,
    resetWatchServiceStatus,
    connectToMongoDB // MongoDB接続関数もエクスポートしてメインで呼び出せるようにする
};
// index.js

require('dotenv').config(); // 環境変数を読み込む

const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { Client, middleware, webhook } = require('@line/bot-sdk');
const cron = require('node-cron');
const { DateTime } = require('luxon'); // 日時操作ライブラリ

// 各種設定、ユーティリティ、ボットロジック、見守りサービス、Flexメッセージをインポート
const config = require('./config');
const {
    containsDangerWords,
    containsScamWords,
    containsScamPhrases,
    containsStrictInappropriateWords,
    checkSpecialReply
} = require('./utils');
const { generateReply } = require('./bot_logic'); // getUserDisplayNameはWebhook内で処理するためここでは不要
const { sendScheduledWatchMessage, resetWatchServiceStatus, connectToMongoDB: connectWatchServiceMongoDB } = require('./watch_service'); // 見守りサービスのMongoDB接続もインポート
const {
    watchServiceGuideFlex,
    watchServiceNoticeConfirmedFlex,
    emergencyFlex,
    scamFlex
} = require('./flex_messages');

const app = express();

// LINE Bot SDKクライアントの初期化
const lineClient = new Client({
    channelAccessToken: config.CHANNEL_ACCESS_TOKEN,
    channelSecret: config.CHANNEL_SECRET,
});

// MongoDBクライアントの初期化
const dbClient = new MongoClient(config.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let usersCollection;
let messagesCollection;

/**
 * MongoDBに接続し、コレクションを取得する
 */
async function connectMongoDB() {
    try {
        await dbClient.connect();
        const db = dbClient.db("LINE_BOT_DB");
        usersCollection = db.collection("users");
        messagesCollection = db.collection("messages");
        console.log("MongoDBに接続しました: index.js");

        // 見守りサービスのMongoDB接続もここで実行
        await connectWatchServiceMongoDB();

    } catch (error) {
        console.error("MongoDB接続エラー: index.js", error);
        process.exit(1); // 接続できない場合は終了
    }
}

// アプリケーション起動時にMongoDBに接続
connectMongoDB();


// Webhookミドルウェア
app.post('/webhook', middleware(config), async (req, res) => {
    try {
        const events = req.body.events;
        await Promise.all(events.map(handleEvent));
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).end();
    }
});

/**
 * LINEイベントハンドラー
 * @param {object} event - LINEイベントオブジェクト
 */
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    const now = new Date();

    console.log(`受信メッセージ - UserID: ${userId}, メッセージ: ${userMessage}`);

    let user = await usersCollection.findOne({ userId: userId });

    // === ユーザーの初回登録処理 ===
    if (!user) {
        let profile;
        try {
            profile = await lineClient.getProfile(userId);
        } catch (error) {
            console.error(`ユーザー ${userId} のプロフィール取得に失敗:`, error);
            profile = { displayName: "名無しさん" }; // 取得失敗時はデフォルト名
        }

        user = {
            userId: userId,
            displayName: profile.displayName,
            membershipType: "guest", // デフォルトはゲスト
            lastMessageTime: now.toISOString(),
            dailyMessageCount: 0,
            monthlyMessageCount: 0,
            registrationDate: now.toISOString(),
            lastDailyReset: now.toISOString(),
            lastMonthlyReset: now.toISOString(),
            watchService: false, // 見守りサービス初期値
            emergencyContact: null,
            lastReplyTime: null, // 見守りサービス用、最終応答時間
            lastWatchMessageSentTime: null, // 見守りサービス用、最終見守りメッセージ送信時間
            lastReminderSentTime: null, // 見守りサービス用、最終リマインドメッセージ送信時間
            emergencyNotified: false // 見守りサービス用、緊急通知済みフラグ
        };
        await usersCollection.insertOne(user);
        console.log(`新規ユーザー登録: ${user.displayName} (${userId})`);

        // 初回挨拶メッセージ
        const welcomeMessage = `こんにちは💖 こころちゃんだよ！私とLINEで繋がってくれてありがとう🌸\n\nあなたの悩みや不安、なんでも聞く準備はできているよ😊 わたしが話せることはたくさんあるから、困った時はいつでも話しかけてね💖`;
        await lineClient.replyMessage(replyToken, { type: 'text', text: welcomeMessage });

        // メッセージログに記録
        await messagesCollection.insertOne({
            userId: userId,
            displayName: profile.displayName,
            message: userMessage,
            reply: welcomeMessage,
            timestamp: now.toISOString(),
            type: "welcome"
        });
        return; // 初回登録メッセージを返したら処理を終了
    }

    // === ユーザーデータの更新（最終メッセージ時間）===
    await usersCollection.updateOne(
        { userId: userId },
        { $set: { lastMessageTime: now.toISOString() } }
    );

    // === メッセージ長制限 ===
    if (userMessage.length > config.MAX_MESSAGE_LENGTH) {
        const replyText = "ごめんね💦 メッセージが長すぎるみたい。もう少し短くして話してくれると嬉しいな😊";
        await lineClient.replyMessage(replyToken, { type: 'text', text: replyText });
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: replyText,
            timestamp: now.toISOString(),
            type: "too_long"
        });
        return;
    }

    // === レートリミット制御 ===
    const lastMessageTime = new Date(user.lastMessageTime);
    if ((now.getTime() - lastMessageTime.getTime()) / 1000 < config.RATE_LIMIT_SECONDS && !config.BOT_ADMIN_IDS.includes(userId)) {
        console.log(`レートリミット: ユーザー ${user.displayName} (${userId})`);
        // 短時間に連続で送信された場合は、返信せずに処理をスキップ
        return;
    }

    // === 会員タイプとメッセージカウントの更新・チェック ===
    let userMembershipType = user.membershipType || "guest"; // デフォルトはguest
    let canReply = true;
    let replyText = "";
    let isExceededLimit = false;

    // 日次リセットチェック
    const lastDailyReset = new Date(user.lastDailyReset || user.registrationDate);
    if (now.getDate() !== lastDailyReset.getDate() || now.getMonth() !== lastDailyReset.getMonth() || now.getFullYear() !== lastDailyReset.getFullYear()) {
        await usersCollection.updateOne({ userId: userId }, { $set: { dailyMessageCount: 0, lastDailyReset: now.toISOString() } });
        user.dailyMessageCount = 0; // メモリ上のユーザーデータも更新
    }

    // 月次リセットチェック
    const lastMonthlyReset = new Date(user.lastMonthlyReset || user.registrationDate);
    if (now.getMonth() !== lastMonthlyReset.getMonth() || now.getFullYear() !== lastMonthlyReset.getFullYear()) {
        await usersCollection.updateOne({ userId: userId }, { $set: { monthlyMessageCount: 0, lastMonthlyReset: now.toISOString() } });
        user.monthlyMessageCount = 0; // メモリ上のユーザーデータも更新
    }

    const membershipConfig = config.MEMBERSHIP_CONFIG[userMembershipType];

    // 管理者はメッセージ制限を適用しない
    if (!config.BOT_ADMIN_IDS.includes(userId)) {
        if (membershipConfig.dailyLimit !== -1 && user.dailyMessageCount >= membershipConfig.dailyLimit) {
            canReply = false;
            replyText = membershipConfig.exceedDailyLimitMessage;
            isExceededLimit = true;
        } else if (membershipConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= membershipConfig.monthlyLimit) {
            canReply = false;
            replyText = membershipConfig.exceedLimitMessage;
            isExceededLimit = true;
        } else {
            // 回数制限に達していない場合のみカウントを増やす
            await usersCollection.updateOne(
                { userId: userId },
                { $inc: { dailyMessageCount: 1, monthlyMessageCount: 1 } }
            );
            user.dailyMessageCount++;
            user.monthlyMessageCount++;
        }
    }


    // === 見守りサービス関連コマンド処理 ===
    if (userMessage === "見守り" || userMessage === "見守りサービス") {
        await lineClient.replyMessage(replyToken, watchServiceGuideFlex);
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: JSON.stringify(watchServiceGuideFlex),
            timestamp: now.toISOString(),
            type: "watch_service_guide"
        });
        return;
    }

    // Postbackイベントの処理（OKボタン、登録・解除など）
    if (event.type === 'postback') {
        const data = new URLSearchParams(event.postback.data);
        const action = data.get('action');

        if (action === 'watch_register') {
            if (user.membershipType === 'guest') {
                const message = "ごめんね💦 見守りサービスは、無料会員から利用できるんだ。まずは無料会員登録をしてくれると嬉しいな😊";
                await lineClient.replyMessage(replyToken, { type: 'text', text: message });
            } else if (user.watchService) {
                const message = "もう見守りサービスに登録してくれているみたいだよ🌸 ありがとう！緊急連絡先を変更したい時は「見守り」と送ってね😊";
                await lineClient.replyMessage(replyToken, { type: 'text', text: message });
            } else {
                // ここで緊急連絡先の入力を促す
                const message = "見守りサービスに登録するんだね🌸 ありがとう！\n緊急連絡先として、通知してほしい電話番号を教えてくれるかな？\n例: 09012345678";
                await lineClient.replyMessage(replyToken, { type: 'text', text: message });
                // ユーザーの状態を見守りサービス登録待機中として更新
                await usersCollection.updateOne({ userId: userId }, { $set: { watchServiceStatus: "awaiting_emergency_contact" } });
            }
        } else if (action === 'watch_unregister') {
            await usersCollection.updateOne({ userId: userId }, {
                $set: {
                    watchService: false,
                    emergencyContact: null,
                    lastReplyTime: null,
                    lastWatchMessageSentTime: null,
                    lastReminderSentTime: null,
                    emergencyNotified: false
                }
            });
            const message = "見守りサービスを解除したよ🌸 また利用したくなったら「見守り」と送ってね😊";
            await lineClient.replyMessage(replyToken, { type: 'text', text: message });
            console.log(`ユーザー ${user.displayName} (${userId}) が見守りサービスを解除しました。`);
        } else if (action === 'watch_ok') {
            await resetWatchServiceStatus(userId);
            const message = "OKありがとう💖 元気にしてるってわかって安心したよ🌸 またいつでも話しかけてね😊";
            await lineClient.replyMessage(replyToken, { type: 'text', text: message });
            console.log(`ユーザー ${user.displayName} (${userId}) が見守りOK応答をしました。`);
        }

        // postbackイベントに対するログ記録
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: event.postback.data, // postbackデータ自体を記録
            reply: "Postback処理完了",
            timestamp: now.toISOString(),
            type: "postback"
        });
        return; // Postbackイベント処理後は終了
    }

    // === 緊急連絡先の登録処理（awaiting_emergency_contact状態の場合） ===
    if (user.watchServiceStatus === "awaiting_emergency_contact") {
        const phoneNumberRegex = /^\d{10,11}$/; // 10桁または11桁の数字（ハイフンなし）
        if (phoneNumberRegex.test(userMessage)) {
            await usersCollection.updateOne({ userId: userId }, {
                $set: {
                    watchService: true,
                    emergencyContact: userMessage,
                    watchServiceStatus: "registered", // 登録完了状態に
                    lastReplyTime: now.toISOString(), // 登録時に最終応答時間を設定
                    lastWatchMessageSentTime: null,
                    lastReminderSentTime: null,
                    emergencyNotified: false
                }
            });
            await lineClient.replyMessage(replyToken, watchServiceNoticeConfirmedFlex(userMessage));
            console.log(`ユーザー ${user.displayName} (${userId}) が見守りサービスに登録し、緊急連絡先 ${userMessage} を設定しました。`);
        } else {
            const message = "ごめんね💦 電話番号は数字だけ（ハイフンなし）で教えてくれると嬉しいな。\n例: 09012345678";
            await lineClient.replyMessage(replyToken, { type: 'text', text: message });
        }
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: `緊急連絡先登録試行 - ${phoneNumberRegex.test(userMessage) ? "成功" : "失敗"}`,
            timestamp: now.toISOString(),
            type: "watch_register_contact"
        });
        return; // 緊急連絡先登録処理後は終了
    }


    // === 危険ワード、詐欺ワード、不適切ワードのチェック ===
    if (containsDangerWords(userMessage)) {
        console.warn(`危険ワード検出: ユーザー ${user.displayName} (${userId}) - "${userMessage}"`);
        await lineClient.replyMessage(replyToken, emergencyFlex);
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: JSON.stringify(emergencyFlex),
            timestamp: now.toISOString(),
            type: "danger_alert"
        });
        return;
    }
    if (containsScamWords(userMessage) || containsScamPhrases(userMessage)) {
        console.warn(`詐欺ワード検出: ユーザー ${user.displayName} (${userId}) - "${userMessage}"`);
        await lineClient.replyMessage(replyToken, scamFlex);
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: JSON.stringify(scamFlex),
            timestamp: now.toISOString(),
            type: "scam_alert"
        });
        return;
    }
    if (containsStrictInappropriateWords(userMessage)) {
        console.warn(`不適切ワード検出: ユーザー ${user.displayName} (${userId}) - "${userMessage}"`);
        const reply = "ごめんね、わたしはそういうお話はできないんだ💦";
        await lineClient.replyMessage(replyToken, { type: 'text', text: reply });
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: reply,
            timestamp: now.toISOString(),
            type: "inappropriate_word"
        });
        return;
    }

    // === 固定返信のチェック ===
    const specialReply = checkSpecialReply(userMessage);
    if (specialReply) {
        await lineClient.replyMessage(replyToken, { type: 'text', text: specialReply });
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: specialReply,
            timestamp: now.toISOString(),
            type: "special_reply"
        });
        return;
    }

    // === AI応答生成 ===
    if (canReply) {
        let aiReply;
        try {
            aiReply = await generateReply(userMessage, user); // ユーザーオブジェクトを渡す
        } catch (error) {
            console.error(`AI応答生成エラー: ユーザー ${user.displayName} (${userId}) - ${error}`);
            aiReply = "ごめんね、今ちょっとお話しできないみたい💦 また後で話しかけてくれると嬉しいな🌸";
        }

        await lineClient.replyMessage(replyToken, { type: 'text', text: aiReply });
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: aiReply,
            timestamp: now.toISOString(),
            type: "ai_reply"
        });
    } else {
        // メッセージ制限超過時の応答
        await lineClient.replyMessage(replyToken, { type: 'text', text: replyText });
        await messagesCollection.insertOne({
            userId: userId,
            displayName: user.displayName,
            message: userMessage,
            reply: replyText,
            timestamp: now.toISOString(),
            type: "limit_exceeded"
        });
    }
}


// === Cronジョブの設定 ===

// 見守りサービスの定期メッセージ送信（毎日15:00に実行）
// 日本時間の15時（JST）はUTCの6時
cron.schedule('0 6 * * *', async () => {
    console.log('Cron: 定期見守りメッセージ/リマインド/緊急通知処理を実行します。');
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo" // 日本時間で指定
});

// 月次メッセージカウントリセット（毎月1日0時0分に実行）
cron.schedule('0 0 1 * *', async () => {
    console.log('Cron: 月次メッセージカウントをリセットします。');
    try {
        await usersCollection.updateMany(
            {}, // 全てのユーザー
            { $set: { monthlyMessageCount: 0, lastMonthlyReset: new Date().toISOString() } }
        );
        console.log('月次メッセージカウントのリセットが完了しました。');
    } catch (error) {
        console.error('月次メッセージカウントリセット中にエラー:', error);
    }
}, {
    timezone: "Asia/Tokyo"
});

// 日次メッセージカウントリセット（毎日0時0分に実行）
cron.schedule('0 0 * * *', async () => {
    console.log('Cron: 日次メッセージカウントをリセットします。');
    try {
        await usersCollection.updateMany(
            {}, // 全てのユーザー
            { $set: { dailyMessageCount: 0, lastDailyReset: new Date().toISOString() } }
        );
        console.log('日次メッセージカウントのリセットが完了しました。');
    } catch (error) {
        console.error('日次メッセージカウントリセット中にエラー:', error);
    }
}, {
    timezone: "Asia/Tokyo"
});


// サーバーの起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
