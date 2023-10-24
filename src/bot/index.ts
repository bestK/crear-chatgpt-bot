import { autoChatAction } from '@grammyjs/auto-chat-action';
import { conversations } from '@grammyjs/conversations';
import { hydrate } from '@grammyjs/hydrate';
import { hydrateReply, parseMode } from '@grammyjs/parse-mode';
import { BotConfig, StorageAdapter, Bot as TelegramBot, session } from 'grammy';

import { drawCommand, questionCommand, startCommand, translationCommand } from '@/bot/commands';
import { Context, SessionData, createContextConstructor } from '@/bot/context';
import { drawConversation } from '@/bot/conversations/draw.conversation';
import { questionToOpenaiConversation } from '@/bot/conversations/question.openai';
import { translationConversation } from '@/bot/conversations/translation.conversation';
import { errorHandler } from '@/bot/handlers';
import { i18n, updateLogger } from '@/bot/middlewares';
import { Container } from '@/container';
import { openai } from '@/services/openai';

type Dependencies = {
    container: Container;
    sessionStorage: StorageAdapter<unknown>;
};

export const createBot = (
    token: string,
    { container, sessionStorage }: Dependencies,
    botConfig?: Omit<BotConfig<Context>, 'ContextConstructor'>
) => {
    const { config } = container.items;

    const bot = new TelegramBot(token, {
        ...botConfig,
        client: {
            timeoutSeconds: 30000
        },
        ContextConstructor: createContextConstructor(container)
    });

    bot.api.config.use(parseMode('HTML'));

    bot.api.setMyCommands([
        { command: 'start', description: 'Start the bot' },
        { command: 'question', description: 'Ask question OpenAI' },
        { command: 'draw', description: 'Draw images' },
        { command: 'translation', description: 'Translation' }
    ]);

    if (config.isDev) {
        bot.use(updateLogger());
    }

    bot.use(autoChatAction());
    bot.use(hydrateReply);
    bot.use(hydrate());
    bot.use(i18n());
    bot.use(
        session({
            initial: (): SessionData => ({}),
            getSessionKey: (ctx) => ctx.chat?.id?.toString()
        })
    );
    bot.use(conversations());

    // conversations
    bot.use(questionToOpenaiConversation(container));
    bot.use(drawConversation(container));
    bot.use(translationConversation(container));

    bot.use(startCommand);
    bot.use(questionCommand);
    bot.use(drawCommand);
    bot.use(translationCommand);

    if (config.isDev) {
        bot.catch(errorHandler);
    }

    bot.on('message:text', async (ctx: Context) => {
        const text = ctx.msg?.text;

        if (ctx.chat?.type === 'private' && text) {
            await ctx.replyWithChatAction('typing');
            const chat_id = ctx.chat.id;
            const prev_message = '⌛';
            const prev_reply = await ctx.api.sendMessage(chat_id, prev_message);
            const reply_id = prev_reply.message_id;

            try {
                const res: any = await openai.createChatCompletion(
                    {
                        model: 'gpt-3.5-turbo',
                        max_tokens: 4000,
                        messages: [{ role: 'user', content: text }],
                        stream: true
                    },
                    { responseType: 'stream' }
                );

                let complete_message = '';
                let edit_message_size = 0;

                res.data.on('data', async (data: { toString: () => string }) => {
                    const lines = data
                        .toString()
                        .split('\n')
                        .filter((line: string) => line.trim() !== '');

                    const promises = [];

                    for (const line of lines) {
                        const message = line.replace(/^data: /, '');
                        if (message === '[DONE]') {
                            return; // Stream finished
                        }
                        try {
                            const parsed = JSON.parse(message);
                            const chunk = parsed?.choices[0]?.delta?.content;
                            if (chunk) {
                                complete_message = `${complete_message}${chunk}`;
                                const complete_message_size = complete_message.length;
                                if (complete_message_size < 10 || complete_message_size - edit_message_size > 10) {
                                    edit_message_size = complete_message.length;
                                    promises.push(ctx.api.editMessageText(chat_id, reply_id, complete_message));
                                }
                            }
                        } catch (error) {
                            console.error('Could not JSON parse stream message', message, error);
                        }
                    }

                    await Promise.all(promises);
                });
            } catch (error: any) {
                if (error.response?.status) {
                    console.error(error.response.status, error.message);
                    error.response.data.on('data', (data: { toString: () => any }) => {
                        const message = data.toString();
                        try {
                            const parsed = JSON.parse(message);
                            console.error('An error occurred during OpenAI request: ', parsed);
                        } catch (error) {
                            console.error('An error occurred during OpenAI request: ', message);
                        }
                    });
                } else {
                    console.error('An error occurred during OpenAI request', error);
                }
            }
        }
    });

    return bot;
};
function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Bot = ReturnType<typeof createBot>;
