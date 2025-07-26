import { requestUrl, Notice } from 'obsidian';
import { MowenPluginSettings } from './settings';

// 定义AI服务返回的数据结构
export interface AIGeneratedContent {
    title: string;
    tags: string[]; // 标签数组
    summary?: string; // 摘要是可选的
}

// 定义不同AI服务商的配置
interface LLMProvider {
    generate(apiKey: string, model: string, content: string, generateSummary: boolean, tagsCount: number): Promise<AIGeneratedContent>;
}

// DeepSeek的实现
class DeepSeekProvider implements LLMProvider {
    async generate(apiKey: string, model: string, content: string, generateSummary: boolean, tagsCount: number): Promise<AIGeneratedContent> {
        const url = 'https://api.deepseek.com/chat/completions';
        
        // 根据是否需要摘要，动态构建系统提示
        const summaryInstruction = generateSummary
            ? "3. 生成一段不超过200字的中文内容摘要。"
            : "";
        const jsonKeys = generateSummary
            ? "'title' (字符串), 'tags' (字符串数组), 和 'summary' (字符串)"
            : "'title' (字符串) 和 'tags' (字符串数组)";
        const example = generateSummary
            ? `{"title": "笔记标题", "tags": ["标签1", "标签2"], "summary": "这是摘要内容..."}`
            : `{"title": "笔记标题", "tags": ["标签1", "标签2"]}`;

        const system_prompt = `你是一位专业的笔记处理助手。请根据用户提供的笔记内容，完成以下任务：
1.  生成一个简洁、精炼的笔记标题。
2.  提取${tagsCount}个最相关的关键词作为标签。
${summaryInstruction}

请将结果以一个纯粹的、不含任何额外解释和 markdown 格式的 JSON 对象形式返回，该对象必须包含以下键：${jsonKeys}。
例如: ${example}`;

        const requestBody = {
            model: model,
            messages: [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": content }
            ],
            stream: false,
            response_format: { type: "json_object" }
        };

        try {
            const response = await requestUrl({
                url: url,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(requestBody),
            });
            const data = response.json;
            if (data.choices && data.choices.length > 0) {
                const resultText = data.choices[0].message.content;
                // 尝试解析返回的JSON字符串
                const parsedResult: AIGeneratedContent = JSON.parse(resultText);
                return parsedResult;
            } else {
                throw new Error('API未返回有效内容');
            }
        } catch (error) {
            console.error('DeepSeek API 请求失败:', error);
            new Notice(`AI 生成失败: ${error.message}`);
            throw error;
        }
    }
}

// 工厂函数，根据provider选择对应的实现
function getProvider(providerName: string): LLMProvider {
    switch (providerName) {
        case 'deepseek':
            return new DeepSeekProvider();
        // 在这里可以扩展其他服务商，例如:
        // case 'kimi':
        //     return new KimiProvider();
        default:
            throw new Error(`不支持的 AI 服务商: ${providerName}`);
    }
}

export async function generateNoteMetadata(settings: MowenPluginSettings, content: string): Promise<AIGeneratedContent | null> {
    const { provider, apiKey, model, generateSummary, tagsCount } = settings.llmSettings;

    if (!provider || !apiKey || !model) {
        new Notice('请先在设置中完成 AI 配置');
        return null;
    }

    try {
        const llmProvider = getProvider(provider);
        const result = await llmProvider.generate(apiKey, model, content, generateSummary, tagsCount);
        return result;
    } catch (error) {
        // 错误已在具体实现中处理和通知
        return null;
    }
} 