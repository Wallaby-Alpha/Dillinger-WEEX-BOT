import TelegramBot from 'node-telegram-bot-api';

import { TelegramIngestionService } from './telegram_client.js';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class TelegramBotListener {
  private bot: any = null;
  private ingestionService: TelegramIngestionService;

  constructor(ingestionService: TelegramIngestionService) {
    this.ingestionService = ingestionService;
  }

  start() {
    if (!ENV.TELEGRAM_BOT_TOKEN) {
      logger.warn("No TELEGRAM_BOT_TOKEN configured. Telegram bot listener will not start.");
      return;
    }

    if (!ENV.TELEGRAM_CHANNEL_ID) {
      logger.fatal("TELEGRAM_CHANNEL_ID is not configured. Failing closed to prevent unauthorized alerts.");
      process.exit(1);
    }

    this.bot = new TelegramBot(ENV.TELEGRAM_BOT_TOKEN, { polling: true });

    logger.info("Telegram Bot Listener started. Waiting for messages...");

    this.bot.on('message', async (msg: any) => {
      // If a channel ID is configured, filter messages by that ID
      if (ENV.TELEGRAM_CHANNEL_ID) {
        const chatId = String(msg.chat.id);
        if (chatId !== ENV.TELEGRAM_CHANNEL_ID) {
          logger.debug({ chatId, expected: ENV.TELEGRAM_CHANNEL_ID }, "Ignoring message from non-target chat.");
          return;
        }
      }

      if (msg.text) {
        logger.info({ chatId: msg.chat.id, text: msg.text }, "Received Telegram message.");
        // Process message through our pipeline
        await this.ingestionService.processRawMessage(msg.text, 'TELEGRAM', msg.date * 1000);
      }
    });

    this.bot.on('channel_post', async (msg: any) => {
       if (ENV.TELEGRAM_CHANNEL_ID) {
        const chatId = String(msg.chat.id);
        if (chatId !== ENV.TELEGRAM_CHANNEL_ID) {
          logger.debug({ chatId, expected: ENV.TELEGRAM_CHANNEL_ID }, "Ignoring channel post from non-target chat.");
          return;
        }
      }

      if (msg.text) {
        logger.info({ chatId: msg.chat.id, text: msg.text }, "Received Telegram channel post.");
        await this.ingestionService.processRawMessage(msg.text, 'TELEGRAM', msg.date * 1000);
      }
    });

    this.bot.on('polling_error', (error: Error) => {
      logger.error({ err: error.message }, "Telegram Bot Polling Error.");
    });
  }

  stop() {
    if (this.bot) {
      this.bot.stopPolling();
      logger.info("Telegram Bot Listener stopped.");
    }
  }
}
