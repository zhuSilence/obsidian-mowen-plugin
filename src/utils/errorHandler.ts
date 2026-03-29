/**
 * 错误处理工具模块
 * 提供统一的错误分类、重试机制和用户友好提示
 */

import { Notice } from 'obsidian';

/**
 * 错误类型枚举
 */
export enum MowenErrorCode {
  // 网络相关
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',
  NETWORK_CONNECTION_FAILED = 'NETWORK_CONNECTION_FAILED',
  
  // API 相关
  API_UNAUTHORIZED = 'API_UNAUTHORIZED',        // 401 - API Key 无效
  API_FORBIDDEN = 'API_FORBIDDEN',              // 403 - 权限不足
  API_NOT_FOUND = 'API_NOT_FOUND',              // 404 - 资源不存在
  API_RATE_LIMIT = 'API_RATE_LIMIT',            // 429 - 请求频率限制
  API_SERVER_ERROR = 'API_SERVER_ERROR',        // 500-599 - 服务器错误
  API_INVALID_RESPONSE = 'API_INVALID_RESPONSE', // 返回数据格式错误
  API_BUSINESS_ERROR = 'API_BUSINESS_ERROR',    // 业务逻辑错误（如发布失败）
  
  // 文件相关
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_UPLOAD_FAILED = 'FILE_UPLOAD_FAILED',
  FILE_AUTH_FAILED = 'FILE_AUTH_FAILED',
  
  // 配置相关
  CONFIG_API_KEY_MISSING = 'CONFIG_API_KEY_MISSING',
  CONFIG_INVALID = 'CONFIG_INVALID',
  
  // 未知错误
  UNKNOWN = 'UNKNOWN'
}

/**
 * 错误信息映射表 - 用户友好提示
 */
const ERROR_MESSAGES: Record<MowenErrorCode, { title: string; detail: string; action?: string }> = {
  [MowenErrorCode.NETWORK_TIMEOUT]: {
    title: '请求超时',
    detail: '服务器响应时间过长，可能是网络不稳定或服务器繁忙',
    action: '请检查网络连接后重试'
  },
  [MowenErrorCode.NETWORK_OFFLINE]: {
    title: '网络断开',
    detail: '当前无法连接到网络',
    action: '请检查网络连接'
  },
  [MowenErrorCode.NETWORK_CONNECTION_FAILED]: {
    title: '连接失败',
    detail: '无法连接到墨问服务器',
    action: '请检查网络或稍后重试'
  },
  [MowenErrorCode.API_UNAUTHORIZED]: {
    title: 'API Key 无效',
    detail: '您的 API Key 可能已过期或无效',
    action: '请在设置中更新 API Key'
  },
  [MowenErrorCode.API_FORBIDDEN]: {
    title: '权限不足',
    detail: '您没有执行此操作的权限',
    action: '请检查账户权限或联系客服'
  },
  [MowenErrorCode.API_NOT_FOUND]: {
    title: '资源不存在',
    detail: '请求的笔记或资源可能已被删除',
    action: '请刷新后重试'
  },
  [MowenErrorCode.API_RATE_LIMIT]: {
    title: '请求过于频繁',
    detail: '您的请求次数已达到限制',
    action: '请等待几分钟后再试'
  },
  [MowenErrorCode.API_SERVER_ERROR]: {
    title: '服务器错误',
    detail: '墨问服务器暂时出现问题',
    action: '请稍后重试，如持续出现请联系客服'
  },
  [MowenErrorCode.API_INVALID_RESPONSE]: {
    title: '响应格式错误',
    detail: '服务器返回了异常的数据格式',
    action: '请联系开发者反馈此问题'
  },
  [MowenErrorCode.API_BUSINESS_ERROR]: {
    title: '操作失败',
    detail: '服务器返回业务错误',
    action: '请根据提示检查内容'
  },
  [MowenErrorCode.FILE_TOO_LARGE]: {
    title: '文件过大',
    detail: '上传的文件超过了大小限制',
    action: '请压缩文件或选择较小的文件'
  },
  [MowenErrorCode.FILE_UPLOAD_FAILED]: {
    title: '文件上传失败',
    detail: '文件上传过程中出现问题',
    action: '请重试上传'
  },
  [MowenErrorCode.FILE_AUTH_FAILED]: {
    title: '上传授权失败',
    detail: '无法获取文件上传授权',
    action: '请检查 API Key 配置'
  },
  [MowenErrorCode.CONFIG_API_KEY_MISSING]: {
    title: '缺少 API Key',
    detail: '请先在插件设置中配置 API Key',
    action: '前往设置页面配置'
  },
  [MowenErrorCode.CONFIG_INVALID]: {
    title: '配置无效',
    detail: '当前配置存在问题',
    action: '请检查设置项'
  },
  [MowenErrorCode.UNKNOWN]: {
    title: '未知错误',
    detail: '发生了预期之外的错误',
    action: '请重试或联系开发者'
  }
};

/**
 * 墨问错误类
 */
export class MowenError extends Error {
  code: MowenErrorCode;
  detail?: string;
  originalError?: Error;
  httpStatus?: number;
  
  constructor(code: MowenErrorCode, detail?: string, originalError?: Error, httpStatus?: number) {
    const messageInfo = ERROR_MESSAGES[code];
    super(detail ? `${messageInfo.title}: ${detail}` : messageInfo.title);
    this.code = code;
    this.detail = detail;
    this.originalError = originalError;
    this.httpStatus = httpStatus;
    this.name = 'MowenError';
  }
  
  /**
   * 获取用户友好的错误提示
   */
  getUserMessage(): { title: string; detail: string; action?: string } {
    const base = ERROR_MESSAGES[this.code];
    return {
      title: base.title,
      detail: this.detail || base.detail,
      action: base.action
    };
  }
  
  /**
   * 显示 Notice 提示
   */
  showNotice(duration?: number): void {
    const msg = this.getUserMessage();
    const text = `${msg.title}${msg.action ? ` - ${msg.action}` : ''}`;
    new Notice(text, duration || 5000);
  }
}

/**
 * 根据 HTTP 状态码和响应内容分类错误
 */
export function classifyApiError(status: number, responseBody: any, originalError?: Error): MowenError {
  // HTTP 状态码分类
  if (status === 401) {
    return new MowenError(MowenErrorCode.API_UNAUTHORIZED, responseBody?.msg || '认证失败', originalError, status);
  }
  if (status === 403) {
    return new MowenError(MowenErrorCode.API_FORBIDDEN, responseBody?.msg || '无权限', originalError, status);
  }
  if (status === 404) {
    return new MowenError(MowenErrorCode.API_NOT_FOUND, responseBody?.msg || '资源不存在', originalError, status);
  }
  if (status === 429) {
    return new MowenError(MowenErrorCode.API_RATE_LIMIT, responseBody?.msg || '请求频率限制', originalError, status);
  }
  if (status >= 500 && status < 600) {
    return new MowenError(MowenErrorCode.API_SERVER_ERROR, responseBody?.msg || `服务器错误(${status})`, originalError, status);
  }
  
  // 业务错误（状态码 200 但返回错误）
  if (status === 200 && responseBody && responseBody.noteId === '' || responseBody?.success === false) {
    return new MowenError(MowenErrorCode.API_BUSINESS_ERROR, responseBody?.msg || '操作失败', originalError, status);
  }
  
  // 其他情况
  return new MowenError(MowenErrorCode.UNKNOWN, responseBody?.msg || `未知错误(${status})`, originalError, status);
}

/**
 * 分类网络错误
 */
export function classifyNetworkError(error: Error): MowenError {
  const message = error.message.toLowerCase();
  
  // 超时
  if (message.includes('timeout') || message.includes('timed out')) {
    return new MowenError(MowenErrorCode.NETWORK_TIMEOUT, undefined, error);
  }
  
  // 断网
  if (message.includes('offline') || message.includes('network') || navigator?.onLine === false) {
    return new MowenError(MowenErrorCode.NETWORK_OFFLINE, undefined, error);
  }
  
  // 连接失败
  if (message.includes('connection') || message.includes('failed') || message.includes('econnrefused')) {
    return new MowenError(MowenErrorCode.NETWORK_CONNECTION_FAILED, undefined, error);
  }
  
  // 默认为网络错误
  return new MowenError(MowenErrorCode.NETWORK_CONNECTION_FAILED, error.message, error);
}

/**
 * 重试配置
 */
export interface RetryConfig {
  maxRetries: number;        // 最大重试次数
  initialDelayMs: number;    // 初始延迟（毫秒）
  maxDelayMs: number;        // 最大延迟（毫秒）
  backoffMultiplier: number; // 退避倍数
  retryableErrors: MowenErrorCode[]; // 可重试的错误类型
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    MowenErrorCode.NETWORK_TIMEOUT,
    MowenErrorCode.NETWORK_CONNECTION_FAILED,
    MowenErrorCode.API_SERVER_ERROR,
    MowenErrorCode.API_RATE_LIMIT
  ]
};

/**
 * 带重试的异步执行器
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (attempt: number, error: MowenError) => void
): Promise<T> {
  let lastError: MowenError | null = null;
  let delay = config.initialDelayMs;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // 转换为 MowenError
      if (error instanceof MowenError) {
        lastError = error;
      } else {
        // 尝试分类原始错误
        const err = error as any;
        if (err.status) {
          lastError = classifyApiError(err.status, err.json || {}, error);
        } else {
          lastError = classifyNetworkError(error as Error);
        }
      }
      
      // 检查是否可重试
      if (!config.retryableErrors.includes(lastError.code)) {
        throw lastError;
      }
      
      // 已达到最大重试次数
      if (attempt >= config.maxRetries) {
        throw lastError;
      }
      
      // 调用重试回调
      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }
      
      // 等待后重试
      await sleep(delay);
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }
  
  throw lastError;
}

/**
 * 简单的 sleep 函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 批量操作错误聚合器
 */
export class BatchErrorCollector {
  private errors: Array<{ index: number; error: MowenError; context?: string }> = [];
  
  add(index: number, error: Error | MowenError, context?: string): void {
    const mowenError = error instanceof MowenError 
      ? error 
      : classifyNetworkError(error as Error);
    this.errors.push({ index, error: mowenError, context });
  }
  
  hasErrors(): boolean {
    return this.errors.length > 0;
  }
  
  getErrors(): Array<{ index: number; error: MowenError; context?: string }> {
    return this.errors;
  }
  
  /**
   * 生成汇总报告
   */
  getSummary(): string {
    if (this.errors.length === 0) return '无错误';
    
    const grouped = new Map<MowenErrorCode, number>();
    this.errors.forEach(e => {
      grouped.set(e.error.code, (grouped.get(e.error.code) || 0) + 1);
    });
    
    const parts: string[] = [];
    grouped.forEach((count, code) => {
      const msg = ERROR_MESSAGES[code];
      parts.push(`${msg.title}: ${count}个`);
    });
    
    return `批量操作完成，失败 ${this.errors.length} 项：${parts.join(', ')}`;
  }
  
  /**
   * 显示汇总 Notice
   */
  showSummaryNotice(): void {
    if (this.hasErrors()) {
      new Notice(this.getSummary(), 8000);
    }
  }
}