import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();

app.post('/webhook', middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const messageText = event.message.text;
  let responseText = '';

  if (messageText.includes('ありがとう')) {
    responseText = 'こちらこそ、いつでもご相談くださいね。';
  } else if (messageText.includes('しんどい')) {
    responseText = 'つらい気持ちを話してくれてありがとう。無理しないでくださいね。';
  } else if (messageText.includes('こんにちは')) {
    responseText = 'こんにちは！ご相談ありがとうございます。';
  } else {
    responseText = 'メッセージを受け取りました。お話ありがとうございます。';
  }

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: responseText,
  });
}
