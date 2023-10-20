import dotenv from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';

dotenv.config();

const configuration = new Configuration({
    apiKey: process.env.CHATGPT_API_KEY,
    // accessToken: process.env.CHATGPT_ACCESS_TOKEN,
    basePath: 'https://ai.fakeopen.com/v1'
});
export const openai = new OpenAIApi(configuration);
