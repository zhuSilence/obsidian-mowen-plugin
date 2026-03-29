import { requestUrl, Notice } from 'obsidian';
import { MowenPluginSettings } from './settings';
import { 
  MowenError, 
  MowenErrorCode, 
  classifyApiError, 
  classifyNetworkError,
  withRetry,
  DEFAULT_RETRY_CONFIG
} from './utils/errorHandler';

/**
 * AI 服务返回的数据结构
 */
export interface AIGeneratedContent {
  title: string;
  tags: string[];
  summary?: string;
}

/**
 * AI 服务错误类
 */
export class AIServiceError extends MowenError {
  provider: string;
  
  constructor(code: MowenErrorCode, detail?: string, provider?: string, originalError?: Error) {
    super(code, detail, originalError);
    this.provider = provider || 'unknown';
    this.name = 'AIServiceError';
  }
  
  getUserMessage(): { title: string; detail: string; action?: string } {
    const base = super.getUserMessage();
    return {
      ...base,
      title: `AI 服务(${this.provider}): ${base.title}`
    };
  }
}

/**
 * LLM 服务商接口
 */
interface LLMProvider {
  name: string;
  generate(
    apiKey: string, 
    model: string, 
    content: string, 
    generateSummary: boolean, 
    tagsCount: number
  ): Promise<AIGeneratedContent>;
}

/**
 * 默认 AI 请求超时时间（毫秒）
 */
const AI_DEFAULT_TIMEOUT = 60000; // AI 生成通常需要较长时间

/**
 * DeepSeek 服务商实现
 */
class DeepSeekProvider implements LLMProvider {
  name = 'deepseek';
  
  async generate(
    apiKey: string, 
    model: string, 
    content: string, 
    generateSummary: boolean, 
    tagsCount: number
  ): Promise<AIGeneratedContent> {
    const url = 'https://api.deepseek.com/chat/completions';
    
    // 构建系统提示
    const summaryInstruction = generateSummary
      ? "3. 生成一段不超过200字的中文内容摘要。"
      : "";
    const jsonKeys = generateSummary
      ? "'title' (字符串), 'tags' (字符串数组), 和 'summary' (字符串)"
      : "'title' (字符串) 和 'tags' (字符串数组)";
    const example = generateSummary
      ? '{"title": "笔记标题", "tags": ["标签1", "标签2"], "summary": "这是摘要内容..."}'
      : '{"title": "笔记标题", "tags": ["标签1", "标签2"]}';

    const systemPrompt = `你是一位专业的笔记处理助手。请根据用户提供的笔记内容，完成以下任务：
1. 生成一个简洁、精炼的笔记标题。
2. 提取${tagsCount}个最相关的关键词作为标签。
${summaryInstruction}

请将结果以一个纯粹的、不含任何额外解释和 markdown 格式的 JSON 对象形式返回，该对象必须包含以下键：${jsonKeys}。
例如: ${example}`;

    const requestBody = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content }
      ],
      stream: false,
      response_format: { type: "json_object" }
    };

    try {
      // Obsidian requestUrl 不支持 timeout 参数，使用 Promise.race 实现超时
      const responsePromise = requestUrl({
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
      
      // 超时处理
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new AIServiceError(
            MowenErrorCode.NETWORK_TIMEOUT,
            `AI 请求超时(${AI_DEFAULT_TIMEOUT}ms)`,
            this.name
          ));
        }, AI_DEFAULT_TIMEOUT);
      });
      
      const response = await Promise.race([responsePromise, timeoutPromise]);
      
      const data = response.json;
      
      // 检查响应格式
      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        throw new AIServiceError(
          MowenErrorCode.API_INVALID_RESPONSE,
          'API 返回格式异常：缺少 choices',
          this.name
        );
      }
      
      const resultText = data.choices[0].message?.content;
      if (!resultText) {
        throw new AIServiceError(
          MowenErrorCode.API_INVALID_RESPONSE,
          'API 返回内容为空',
          this.name
        );
      }
      
      // 安全解析 JSON
      try {
        const parsedResult: AIGeneratedContent = JSON.parse(resultText);
        
        // 验证返回字段
        if (!parsedResult.title || typeof parsedResult.title !== 'string') {
          throw new AIServiceError(
            MowenErrorCode.API_INVALID_RESPONSE,
            '返回的标题格式错误',
            this.name
          );
        }
        
        if (!parsedResult.tags || !Array.isArray(parsedResult.tags)) {
          throw new AIServiceError(
            MowenErrorCode.API_INVALID_RESPONSE,
            '返回的标签格式错误',
            this.name
          );
        }
        
        return parsedResult;
        
      } catch (parseError) {
        throw new AIServiceError(
          MowenErrorCode.API_INVALID_RESPONSE,
          `JSON 解析失败: ${parseError.message}`,
          this.name,
          parseError as Error
        );
      }
      
    } catch (error: any) {
      // 处理 requestUrl 抛出的错误
      const err = error as any;
      
      // HTTP 错误
      if (err.status) {
        // DeepSeek 特殊错误处理
        if (err.status === 401) {
          throw new AIServiceError(
            MowenErrorCode.API_UNAUTHORIZED,
            'DeepSeek API Key 无效或已过期',
            this.name,
            error
          );
        }
        if (err.status === 429) {
          throw new AIServiceError(
            MowenErrorCode.API_RATE_LIMIT,
            'DeepSeek API 请求频率限制，请稍后重试',
            this.name,
            error
          );
        }
        
        throw new AIServiceError(
          classifyApiError(err.status, err.json || {}, error).code,
          `DeepSeek API 错误 (${err.status})`,
          this.name,
          error
        );
      }
      
      // 网络错误
      throw new AIServiceError(
        classifyNetworkError(error as Error).code,
        'DeepSeek API 网络请求失败',
        this.name,
        error
      );
    }
  }
}

/**
 * Kimi 服务商实现（预留扩展）
 */
// class KimiProvider implements LLMProvider {
//   name = 'kimi';
//   async generate(...) { ... }
// }

/**
 * 服务商工厂函数
 */
function getProvider(providerName: string): LLMProvider {
  switch (providerName) {
    case 'deepseek':
      return new DeepSeekProvider();
    
    // 扩展其他服务商
    // case 'kimi':
    //   return new KimiProvider();
    // case 'openai':
    //   return new OpenAIProvider();
    
    default:
      throw new AIServiceError(
        MowenErrorCode.CONFIG_INVALID,
        `不支持的 AI 服务商: ${providerName}`,
        providerName
      );
  }
}

/**
 * AI 生成配置
 */
export interface AIGenerateOptions {
  enableRetry?: boolean;
  maxRetries?: number;
  timeout?: number;
}

/**
 * 生成笔记元数据（标题、标签、摘要）
 * 
 * 改进：
 * 1. 添加超时设置
 * 2. 完善的错误处理和分类
 * 3. 可选重试机制
 * 4. JSON 解析安全处理
 */
export async function generateNoteMetadata(
  settings: MowenPluginSettings, 
  content: string,
  options?: AIGenerateOptions
): Promise<AIGeneratedContent | null> {
  const { provider, apiKey, model, generateSummary, tagsCount } = settings.llmSettings || {};
  const enableRetry = options?.enableRetry ?? true;

  // 配置验证
  if (!provider) {
    const error = new AIServiceError(
      MowenErrorCode.CONFIG_INVALID,
      '未配置 AI 服务商'
    );
    error.showNotice();
    return null;
  }
  
  if (!apiKey || apiKey.trim() === '') {
    const error = new AIServiceError(
      MowenErrorCode.CONFIG_API_KEY_MISSING,
      '未配置 AI API Key'
    );
    error.showNotice();
    return null;
  }
  
  if (!model) {
    const error = new AIServiceError(
      MowenErrorCode.CONFIG_INVALID,
      '未配置 AI 模型'
    );
    error.showNotice();
    return null;
  }
  
  // 内容验证
  if (!content || content.trim().length < 50) {
    new Notice('内容过短，无法生成有效的标题和标签');
    return null;
  }

  try {
    const llmProvider = getProvider(provider);
    
    // 带重试的生成
    const generateOperation = () => llmProvider.generate(
      apiKey, 
      model, 
      content, 
      generateSummary ?? false, 
      tagsCount ?? 3
    );
    
    const result = enableRetry 
      ? await withRetry(generateOperation, {
          ...DEFAULT_RETRY_CONFIG,
          // AI 生成重试间隔更长
          initialDelayMs: 2000,
          maxDelayMs: 15000,
          maxRetries: options?.maxRetries ?? 2 // AI 生成只重试2次
        }, (attempt, err) => {
          console.log(`[Mowen AI] 第 ${attempt} 次重试，原因: ${err.getUserMessage().title}`);
          new Notice(`AI 生成失败，正在重试(${attempt})...`, 3000);
        })
      : await generateOperation();
    
    return result;
    
  } catch (error: any) {
    // 统一错误处理
    const aiError = error instanceof AIServiceError 
      ? error 
      : new AIServiceError(
          classifyNetworkError(error as Error).code,
          'AI 生成失败',
          provider,
          error
        );
    
    aiError.showNotice(6000);
    console.error('[Mowen AI] 生成失败:', {
      provider,
      error: aiError.getUserMessage(),
      originalError: error
    });
    
    return null;
  }
}

/**
 * 检查 AI 服务是否可用（健康检查）
 */
export async function checkAIServiceHealth(
  settings: MowenPluginSettings
): Promise<{ valid: boolean; error?: AIServiceError }> {
  const { provider, apiKey, model } = settings.llmSettings || {};
  
  if (!provider || !apiKey || !model) {
    return { 
      valid: false, 
      error: new AIServiceError(
        MowenErrorCode.CONFIG_INVALID,
        'AI 服务配置不完整'
      ) 
    };
  }
  
  try {
    const llmProvider = getProvider(provider);
    
    // 发送一个简单的测试请求
    const testResult = await llmProvider.generate(
      apiKey,
      model,
      '测试内容',
      false,
      1
    );
    
    return { valid: true };
    
  } catch (error: any) {
    return { 
      valid: false, 
      error: error instanceof AIServiceError 
        ? error 
        : new AIServiceError(
            MowenErrorCode.UNKNOWN,
            '健康检查失败',
            provider,
            error
          )
    };
  }
}