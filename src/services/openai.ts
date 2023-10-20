import dotenv from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';

dotenv.config();

const configuration = new Configuration({
    apiKey: process.env.CHATGPT_API_KEY,
    basePath: process.env.CHATGPT_BASE_URL
});
export const openai = new OpenAIApi(configuration);
