import { getFrontMatterInfo, parseYaml, requestUrl } from 'obsidian';

/**
 * NoteAtom 文本标记接口
 * 用于表示文本的格式化标记（加粗、链接等）
 */
export interface NoteAtomMark {
  type: string; // 'bold', 'link' 等
  attrs?: Record<string, any>; // 例如链接的 href 属性
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
  attrs?: Record<string, any>; // 属性，如 uuid, align, alt 等
}

/**
 * 发布隐私设置接口
 */
export interface PublishPrivacy {
  type: 'private' | 'public' | 'rule';
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
}

/**
 * 文件上传响应接口
 */
export interface FileUploadResponse {
  success: boolean;
  data?: {
    file: {
      fileId: string;
    };
  } | null;
  message?: string;
}

export interface PublishNoteParams {
  noteId?: string | null;
  apiKey: string;
  title: string;
  content: string;
  tags?: string[];
  autoPublish?: boolean;
  settings?: PublishSettings;
  body: NoteAtomNode[];
}

export interface PublishNoteResult {
  success: boolean;
  message: string;
  data?: any;
}
// 
const baseUrl = "https://open.mowen.cn/api/open/api/v1";
export async function publishNoteToMowen(params: PublishNoteParams): Promise<PublishNoteResult> {
  const { noteId, apiKey, title, content, tags, autoPublish, settings, body } = params;
  let url;
  if (noteId) {
    // 更新笔记 path 为 /api/open/api/v1/note/edit
    url = `${baseUrl}/note/edit`;
  } else {
    // 创建笔记 path 为 /api/open/api/v1/note/create
    url = `${baseUrl}/note/create`;
  }
  try {

    let bb = JSON.stringify({
      "noteId": noteId,
      "body": {
        "type": "doc",
        "content": body,
      },
      "settings": settings
    });
    const response = await requestUrl({
      url: url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: bb
    });

    const result = response.json;

    //  result.noteId 不等于空时发布成功
    if (response.status === 200 && result.noteId !== "") {
      // 发布成功的情况下，根据 settings 的内容进行笔记的隐私设置
      if (settings.section === 1) {
        // 调用更新 settings path /api/open/api/v1/note/set
        let settingResponse = await requestUrl({
          url: baseUrl + `/note/set`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            "noteId": result.noteId,
            "section": settings.section,
            "settings": {
              "privacy": settings.privacy
            }
          })
        });
        const settingResult = settingResponse.json;
      }
      return {
        success: true,
        message: "发布成功",
        data: result.noteId,
      };
    } else {
      return {
        success: false,
        message: result.msg || "发布失败",
        data: result,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || "网络错误",
    };
  }
}

/**
 * 获取文件上传授权信息
 * @param {string} apiKey - 墨问 API Key
 * @param {number} fileType - 文件类型：1-图片 2-音频 3-PDF
 * @returns {Promise<UploadAuthResponse>} 上传授权信息
 */
export async function getUploadAuthorization(apiKey: string, fileType: number): Promise<UploadAuthResponse> {
  try {
    const response = await requestUrl({
      url: `${baseUrl}/upload/prepare`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        fileType: fileType
        // 根据文档，这里可能需要传入文件类型、文件名等，但目前文档中没有明确要求，先留空
      }),
    });
    const result = response.json;
    if (response.status === 200 && result.form) {
      return { success: true, data: result.form };
    } else {
      return { success: false, message: result.msg || "获取上传授权失败", data: null };
    }
  } catch (error: any) {
    return { success: false, message: error.message || "网络错误" };
  }
}

/**
 * 执行文件投递上传
 * @param {string} endpoint - 上传端点
 * @param {Record<string, string>} authInfo - 授权信息
 * @param {Blob} fileBlob - 文件内容的 Blob
 * @param {string} fileName - 文件名
 * @returns {Promise<FileUploadResponse>} 上传结果
 */
export async function deliverFile(endpoint: string, authInfo: Record<string, string>, fileBlob: Blob, fileName: string): Promise<FileUploadResponse> {
  const formData = new FormData();
  // 根据文档，将授权信息添加到 formData
  for (const key in authInfo) {
    formData.append(key, authInfo[key]);
  }
  formData.append('file', fileBlob, fileName); // 投递文件

  try {
    // 对于 FormData，我们需要继续使用 fetch，因为 requestUrl 可能不完全支持 FormData
    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      // 注意：这里不需要设置 Content-Type，FormData 会自动设置
    });
    const result = await response.json();
    if (response.ok && result.file) { // 假设成功返回 uuid
      return { success: true, data: result.file };
    } else {
      return { success: false, message: result.msg || "文件上传失败", data: null };
    }
  } catch (error: any) {
    return { success: false, message: error.message || "网络错误" };
  }
}

/**
 * 将 Markdown 文本中的 tags 提取出来
 * @param {string} markdown
 * @returns {string[]}
 */
export function markdownTagsToNoteAtomTags(markdown: string, defaultTag: string = 'Obsidian'): { tags: string[] } {
  let tags: string[] = [];

  // 使用 Obsidian 的 getFrontMatterInfo 获取 frontmatter 信息
  const frontMatterInfo = getFrontMatterInfo(markdown);

  if (frontMatterInfo.exists) {
    try {
      // 使用 parseYaml 解析 frontmatter
      const frontmatterObj = parseYaml(frontMatterInfo.frontmatter);
      
      if (frontmatterObj && typeof frontmatterObj === 'object' && frontmatterObj.tags) {
        if (Array.isArray(frontmatterObj.tags)) {
          // 数组形式的标签
          tags = frontmatterObj.tags.map((tag: any) => String(tag).trim()).filter(Boolean);
        } else if (typeof frontmatterObj.tags === 'string') {
          // 字符串形式的标签，用逗号分隔
          tags = frontmatterObj.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
        }
      }
    } catch (e) {
      console.error('解析 frontmatter 中的标签失败:', e);
    }
  }

  // 在 tags 中添加 defaultTag
  tags.push(defaultTag);
  return {
    tags: tags
  };
}

/**
 * 根据文件扩展名获取文件类型
 * @param {string} extension - 文件扩展名
 * @returns {number} 文件类型：1-图片 2-音频 3-PDF
 */
export function getFileType(extension: string): number {
  return {
    'png': 1,
    'jpg': 1,
    'jpeg': 1,
    'gif': 1,
    'wav': 2,
    'mp3': 2,
    'mp4': 2,
    'pdf': 3
  }[extension.toLowerCase()] || 1;
}

/**
 * 根据文件扩展名获取 MIME 类型
 * @param {string} extension - 文件扩展名
 * @returns {string} MIME 类型
 */
export function getMimeType(extension: string): string {
  const mimeTypes: { [key: string]: string } = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'mp3': 'audio/mpeg',
    'wav': 'audio/mpeg',
    'mp4': 'audio/mp4',
    'pdf': 'application/pdf',
  };
  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * 根据文件类型获取文件名
 * @param {number} fileType - 文件类型
 * @returns {string} 文件名
 */
export function getFileTypeName(fileType: number): string { 
  return {
    1: 'image',
    2: 'audio',
    3: 'pdf'
  }[fileType] || '未知';
}