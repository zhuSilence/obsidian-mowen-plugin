import { getFrontMatterInfo, parseYaml, requestUrl, Notice } from 'obsidian';
import {
  MowenError,
  MowenErrorCode,
  classifyApiError,
  classifyNetworkError,
  withRetry,
  DEFAULT_RETRY_CONFIG,
  BatchErrorCollector
} from './utils/errorHandler';

/**
 * NoteAtom 文本标记类型
 * 支持多种 mark 类型组合
 */
export type MarkType = 'bold' | 'link' | 'highlight'; // 墨问 NoteAtom 只支持 bold/highlight/link 三种 marks

/**
 * NoteAtom 文本标记接口
 * 用于表示文本的格式化标记（加粗、链接、高亮等）
 */
export interface NoteAtomMark {
  type: MarkType; // 移除 | string，严格类型约束
  attrs?: Record<string, unknown>; // 移除 any，使用 unknown
}

/**
 * NoteAtom 节点接口
 * 用于表示墨问笔记的内容节点结构
 */
export interface NoteAtomNode {
  type: string; // 节点类型：'paragraph', 'text', 'quote', 'note', 'image', 'audio' 等
  content?: NoteAtomNode[]; // 嵌套子节点
  text?: string; // 文本内容（仅 text 类型节点）
  marks?: NoteAtomMark[]; // 文本标记
  attrs?: Record<string, unknown>; // 属性，如 uuid, align, alt 等
}

/**
 * 发布隐私设置接口
 */
export interface PublishPrivacy {
  type:  'public' | 'private' | 'rule';
  rule?: {
    noShare?: boolean;
    expireAt?: number;
  };
}

/**
 * 发布设置接口
 */
export interface PublishSettings {
  auto_publish?: boolean;
  tags?: string[];
  privacy?: PublishPrivacy;
  section?: number;
}

/**
 * 上传授权响应接口
 */
export interface UploadAuthResponse {
  success: boolean;
  data?: {
    endpoint: string;
    [key: string]: string; // 其他表单字段
  } | null;
  message?: string;
  error?: MowenError; // 结构化错误对象
}

/**
 * 文件上传响应接口
 * 实际 API 返回字段：uid, fileId, name, path, type, format, extra, size, mime, hash, url, scale, risky
 */
export interface FileUploadResponse {
  success: boolean;
  data?: {
    file: {
      uid?: string;
      fileId: string;  // 实际 API 返回的文件ID字段名为 fileId
      name?: string;
      path?: string;
      type?: number;
      format?: string;
      size?: string;
      mime?: string;
      url?: string;
    };
  } | null;
  message?: string;
  error?: MowenError;
}

export interface PublishNoteParams {
  noteId?: string | null;
  apiKey: string;
  tags?: string[];
  autoPublish?: boolean;
  settings?: PublishSettings;
  body: NoteAtomNode[];
  enableRetry?: boolean;
}

export interface PublishNoteResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: MowenError; // 结构化错误对象
}

/** API 基础地址 */
const baseUrl = "https://open.mowen.cn/api/open/api/v1";

/** 默认请求超时时间（毫秒） */
const DEFAULT_TIMEOUT = 30000;

/** 文件上传超时时间（毫秒） */
const UPLOAD_TIMEOUT = 60000;

/**
 * 安全的 requestUrl 包装函数
 * 提供统一的超时、错误处理和日志记录
 */
async function safeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<{ status: number; json: any }> {
  try {
    const response = await requestUrl({
      url,
      method,
      headers,
      body,
      timeout
    } as any);
    
    return {
      status: response.status,
      json: response.json
    };
  } catch (error: any) {
    // requestUrl 可能抛出多种错误格式
    const err = error as any;
    
    // 如果有 status 属性，说明是 HTTP 错误
    if (err.status) {
      throw classifyApiError(err.status, err.json || {}, error);
    }
    
    // 否则是网络错误
    throw classifyNetworkError(error);
  }
}

/**
 * 发布/更新笔记到墨问
 *
 * 修复：按官方文档区分创建和编辑的请求体结构
 * - 创建 POST /note/create: { body, settings: { autoPublish, tags } }
 * - 编辑 POST /note/edit:   { noteId, body }
 * - 隐私设置走独立的 POST /note/set 接口
 */
export async function publishNoteToMowen(params: PublishNoteParams): Promise<PublishNoteResult> {
  const { 
    noteId, 
    apiKey, 
    tags, 
    autoPublish, 
    settings, 
    body, 
    enableRetry = true 
  } = params;
  
  // 验证 API Key
  if (!apiKey || apiKey.trim() === '') {
    const error = new MowenError(MowenErrorCode.CONFIG_API_KEY_MISSING);
    return {
      success: false,
      message: error.getUserMessage().title,
      error
    };
  }
  
  const isEdit = !!noteId;
  const url = isEdit 
    ? `${baseUrl}/note/edit` 
    : `${baseUrl}/note/create`;
  
  // 按官方文档构建不同的请求体
  const requestBody = isEdit
    ? JSON.stringify({
        // 编辑接口：只需要 noteId + body
        noteId,
        body: {
          type: "doc",
          content: body,
        },
      })
    : JSON.stringify({
        // 创建接口：body + settings（只有 autoPublish 和 tags）
        body: {
          type: "doc",
          content: body,
        },
        settings: {
          autoPublish: autoPublish ?? false,
          tags: tags ?? [],
        }
      });

  // 主请求操作
  const mainOperation = async () => {
    const response = await safeRequest(
      url,
      "POST",
      {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      requestBody
    );
    
    const result = response.json;
    
    // 检查 HTTP 状态和业务返回
    if (response.status !== 200) {
      throw classifyApiError(response.status, result, undefined);
    }
    
    // 业务成功检查
    if (!result.noteId || result.noteId === "") {
      throw new MowenError(
        MowenErrorCode.API_BUSINESS_ERROR,
        result.msg || result.message || "发布失败，未获取到笔记ID"
      );
    }
    
    return result;
  };
  
  try {
    // 执行主请求（可选重试）
    const result = enableRetry 
      ? await withRetry(mainOperation, DEFAULT_RETRY_CONFIG, (attempt, err) => {
          console.log(`[Mowen] 发布请求第 ${attempt} 次重试，原因: ${err.getUserMessage().title}`);
        })
      : await mainOperation();
    
    // === 二次 API 调用：设置隐私（独立接口） ===
    // 官方文档：隐私设置走 /note/set，不在创建/编辑接口中
    // 默认创建的笔记是 public，只有非 public 时才需要调用 /note/set
    if (settings && settings.section === 1 && settings.privacy && settings.privacy.type !== 'public') {
      try {
        await updateNotePrivacy(result.noteId, apiKey, settings);
      } catch (privacyError) {
        // 隐私设置失败不应影响整体发布结果，但需记录警告
        console.warn('[Mowen] 隐私设置更新失败:', privacyError);
        if (privacyError instanceof MowenError) {
          new Notice(`笔记已发布，但隐私设置更新失败: ${privacyError.getUserMessage().title}`, 5000);
        } else {
          new Notice('笔记已发布，但隐私设置更新失败', 5000);
        }
      }
    }
    
    return {
      success: true,
      message: "发布成功",
      data: result.noteId,
    };
    
  } catch (error: any) {
    const mowenError = error instanceof MowenError 
      ? error 
      : classifyNetworkError(error as Error);
    
    return {
      success: false,
      message: mowenError.getUserMessage().title,
      error: mowenError,
      data: error
    };
  }
}

/**
 * 更新笔记隐私设置（内部函数）
 */
async function updateNotePrivacy(
  noteId: string, 
  apiKey: string, 
  settings: PublishSettings
): Promise<void> {
  // 按官方文档构建 /note/set 请求体
  const privacy = settings.privacy;
  if (!privacy) return;
  const privacyPayload: Record<string, unknown> = {
    type: privacy.type,
  };
  // 仅当 type 为 'rule' 时才发送 rule 字段，避免 API 误解 expireAt: '0' 导致隐私不生效
  if (privacy.type === 'rule' && privacy.rule) {
    privacyPayload.rule = {
      noShare: privacy.rule.noShare ?? false,
      // 官方文档 expireAt 类型为 string（时间戳秒的字符串形式）
      expireAt: String(privacy.rule.expireAt ?? 0),
    };
  }

  const response = await safeRequest(
    `${baseUrl}/note/set`,
    "POST",
    {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    JSON.stringify({
      noteId,
      section: 1,
      settings: {
        privacy: privacyPayload
      }
    })
  );
  
  if (response.status !== 200) {
    throw classifyApiError(response.status, response.json, undefined);
  }
}

/**
 * 获取文件上传授权信息
 * 
 * 改进：
 * 1. 添加超时参数
 * 2. 完善错误处理
 * 3. 返回结构化错误
 */
export async function getUploadAuthorization(
  apiKey: string, 
  fileType: number,
  options?: { timeout?: number; enableRetry?: boolean; fileName?: string }
): Promise<UploadAuthResponse> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const enableRetry = options?.enableRetry ?? true;
  const fileName = options?.fileName;
  
  // 验证 API Key
  if (!apiKey || apiKey.trim() === '') {
    return {
      success: false,
      message: '缺少 API Key',
      error: new MowenError(MowenErrorCode.CONFIG_API_KEY_MISSING)
    };
  }
  
  const operation = async () => {
    const response = await safeRequest(
      `${baseUrl}/upload/prepare`,
      "POST",
      {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      JSON.stringify({ fileType, ...(fileName ? { fileName } : {}) }),
      timeout
    );
    
    if (response.status !== 200 || !response.json.form) {
      throw classifyApiError(
        response.status,
        response.json,
        undefined
      );
    }
    
    return response.json.form;
  };
  
  try {
    const form = enableRetry 
      ? await withRetry(operation)
      : await operation();
    
    return { 
      success: true, 
      data: form 
    };
  } catch (error: any) {
    const mowenError = error instanceof MowenError 
      ? error 
      : classifyNetworkError(error as Error);
    
    return { 
      success: false, 
      message: mowenError.getUserMessage().title,
      error: mowenError
    };
  }
}

/**
 * 执行文件投递上传
 * 
 * 改进：
 * 1. 统一使用 requestUrl 替代 fetch（支持超时）
 * 2. 完善错误处理和重试
 * 3. 返回结构化错误
 * 
 * 注意：FormData 上传需要特殊处理，requestUrl 不完全支持
 * 因此保留 fetch 但添加超时 AbortController
 */
export async function deliverFile(
  endpoint: string, 
  authInfo: Record<string, string>, 
  fileBlob: Blob, 
  fileName: string,
  options?: { timeout?: number; enableRetry?: boolean }
): Promise<FileUploadResponse> {
  const timeout = options?.timeout ?? UPLOAD_TIMEOUT;
  const enableRetry = options?.enableRetry ?? true;
  
  const operation = async (): Promise<FileUploadResponse> => {
    // 构建 FormData
    const formData = new FormData();
    for (const key in authInfo) {
      formData.append(key, authInfo[key]);
    }
    // 修复 #15: 文件投递必须带 x:file_name，否则 PDF 等文件名缺失
    formData.append('x:file_name', fileName);
    formData.append('file', fileBlob, fileName);
    
    // 使用 AbortController 实现超时
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeout);
    
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
        signal: abortController.signal
      });
      
      clearTimeout(timeoutId);
      
      const result = await response.json();
      
      if (!response.ok) {
        // 分类 HTTP 错误
        throw classifyApiError(response.status, result, undefined);
      }
      
      if (!result.file) {
        throw new MowenError(
          MowenErrorCode.FILE_UPLOAD_FAILED,
          result.msg || result.message || "上传响应格式错误"
        );
      }
      
      return { 
        success: true, 
        data: { file: result.file }
      };
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      // 处理 AbortError（超时）
      if (error.name === 'AbortError') {
        throw new MowenError(MowenErrorCode.NETWORK_TIMEOUT, `上传超时(${timeout}ms)`);
      }
      
      // 其他错误
      if (error instanceof MowenError) {
        throw error;
      }
      
      throw classifyNetworkError(error as Error);
    }
  };
  
  try {
    if (enableRetry) {
      // 文件上传重试需要重新获取授权信息，这里只做简单重试
      return await withRetry(operation, {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 1 // 文件上传只重试一次，避免重复消耗带宽
      });
    }
    return await operation();
  } catch (error: any) {
    const mowenError = error instanceof MowenError 
      ? error 
      : classifyNetworkError(error as Error);
    
    return { 
      success: false, 
      message: mowenError.getUserMessage().title,
      error: mowenError
    };
  }
}

/**
 * 批量文件上传（带错误聚合，并发上传）
 * 修复 #16: 使用 Promise.allSettled 并发上传
 */
export async function batchUploadFiles(
  apiKey: string,
  files: Array<{ blob: Blob; name: string; fileType: number }>
): Promise<Array<{ success: boolean; fileId?: string; error?: MowenError }>> {
  const errorCollector = new BatchErrorCollector();
  
  // 并发上传所有文件
  const uploadPromises = files.map(async (file, i) => {
    // 获取上传授权
    const authRes = await getUploadAuthorization(apiKey, file.fileType, { fileName: file.name });
    if (!authRes.success || !authRes.data) {
      errorCollector.add(i, authRes.error!, file.name);
      return { success: false, error: authRes.error! };
    }
    
    // 执行上传
    const uploadRes = await deliverFile(
      authRes.data.endpoint,
      authRes.data as Record<string, string>,
      file.blob,
      file.name
    );
    
    if (uploadRes.success && uploadRes.data) {
      return { 
        success: true, 
        fileId: uploadRes.data.file?.fileId || ''
      };
    } else {
      errorCollector.add(i, uploadRes.error!, file.name);
      return { success: false, error: uploadRes.error! };
    }
  });
  
  const results = await Promise.allSettled(uploadPromises);
  
  // 处理结果
  const finalResults = results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      const error = classifyNetworkError(result.reason as Error);
      errorCollector.add(i, error, files[i].name);
      return { success: false, error };
    }
  });
  
  // 显示汇总提示
  if (errorCollector.hasErrors()) {
    errorCollector.showSummaryNotice();
  }
  
  return finalResults;
}

/**
 * 将 Markdown 文本中的 tags 提取出来
 */
export function markdownTagsToNoteAtomTags(markdown: string, defaultTag: string = 'Obsidian'): { tags: string[] } {
  let tags: string[] = [];
  
  const frontMatterInfo = getFrontMatterInfo(markdown);
  
  if (frontMatterInfo.exists) {
    try {
      const frontmatterObj = parseYaml(frontMatterInfo.frontmatter);
      
      if (frontmatterObj && typeof frontmatterObj === 'object' && frontmatterObj.tags) {
        if (Array.isArray(frontmatterObj.tags)) {
          tags = frontmatterObj.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean);
        } else if (typeof frontmatterObj.tags === 'string') {
          tags = frontmatterObj.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
        }
      }
    } catch (e) {
      // frontmatter 解析失败不阻止标签提取，使用默认标签
      console.warn('解析 frontmatter 中的标签失败:', e);
    }
  }
  
  tags.push(defaultTag);
  return { tags };
}

/**
 * 根据文件扩展名获取文件类型
 * @param extension - 文件扩展名
 * @returns 文件类型：1-图片 2-音频 3-PDF
 */
export function getFileType(extension: string): number {
  const typeMap: { [key: string]: number } = {
    // 图片格式
    'png': 1, 'jpg': 1, 'jpeg': 1, 'gif': 1,
    'webp': 1, 'svg': 1, 'bmp': 1, 'ico': 1,
    // 音频格式
    'wav': 2, 'mp3': 2, 'mp4': 2, 'm4a': 2,
    'aac': 2, 'webm': 2, 'ogg': 2, 'flac': 2,
    // PDF
    'pdf': 3
  };
  return typeMap[extension.toLowerCase()] || 1; // 默认当作图片处理
}

/**
 * 根据文件扩展名获取 MIME 类型
 * @param extension - 文件扩展名
 * @returns MIME 类型字符串
 */
export function getMimeType(extension: string): string {
  const mimeTypes: { [key: string]: string } = {
    // 图片
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'ico': 'image/x-icon',
    // 音频
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'm4a': 'audio/mp4',
    'mp4': 'audio/mp4',
    'aac': 'audio/aac',
    'webm': 'audio/webm',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    // PDF
    'pdf': 'application/pdf',
  };
  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * 根据文件类型获取文件名
 */
export function getFileTypeName(fileType: number): string { 
  return {
    1: 'image',
    2: 'audio',
    3: 'pdf'
  }[fileType] || 'unknown';
}

/**
 * 检查 API Key 是否有效（健康检查）
 * 通过调用一个轻量级 API 来验证
 */
export async function checkApiKeyHealth(apiKey: string): Promise<{ valid: boolean; error?: MowenError }> {
  if (!apiKey || apiKey.trim() === '') {
    return { 
      valid: false, 
      error: new MowenError(MowenErrorCode.CONFIG_API_KEY_MISSING) 
    };
  }
  
  try {
    // 尝试获取上传授权作为健康检查（轻量级操作）
    const response = await safeRequest(
      `${baseUrl}/upload/prepare`,
      "POST",
      {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      JSON.stringify({ fileType: 1 }),
      10000 // 10秒超时
    );
    
    if (response.status === 401) {
      return { 
        valid: false, 
        error: new MowenError(MowenErrorCode.API_UNAUTHORIZED, 'API Key 无效或已过期') 
      };
    }
    
    if (response.status === 200) {
      return { valid: true };
    }
    
    // 其他状态码
    return { 
      valid: false, 
      error: classifyApiError(response.status, response.json, undefined) 
    };
  } catch (error: any) {
    return { 
      valid: false, 
      error: error instanceof MowenError ? error : classifyNetworkError(error as Error) 
    };
  }
}