export interface PublishNoteParams {
  noteId?: string | null;
  apiKey: string;
  title: string;
  content: string;
  tags?: string[];
  autoPublish?: boolean;
  settings?: any
}

export interface PublishNoteResult {
  success: boolean;
  message: string;
  data?: any;
}
// 
const baseUrl = "https://open.mowen.cn/api/open/api/v1";
export async function publishNoteToMowen(params: PublishNoteParams): Promise<PublishNoteResult> {
  const { noteId, apiKey, title, content, tags, autoPublish, settings } = params;
  let url;
  if (noteId) {
    // 更新笔记 path 为 /api/open/api/v1/note/edit
    url = `${baseUrl}/note/edit`;
  } else {
    // 创建笔记 path 为 /api/open/api/v1/note/create
    url = `${baseUrl}/note/create`;
  }
  const newObject = markdownToNoteAtom(title, content);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        "noteId": noteId,
        "body": {
          "type": "doc",
          "content": newObject.content,
        },
        "settings": {
          "autoPublish": autoPublish,
          "tags": tags
        }
      }),
    });

    const result = await response.json();

    //  result.noteId 不等于空时发布成功
    if (response.ok && result.noteId !== "") {
      // 发布成功的情况下，根据 settings 的内容进行笔记的隐私设置
      console.log(settings)
      if (settings.section === 1) {
        // 调用更新 settings path /api/open/api/v1/note/set
        let settingResponse = await fetch(baseUrl + `/note/set`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            "noteId": noteId,
            "section": settings.section,
            "settings": {
              "privacy": settings.privacy
            }
          })
        });
        const settingResult = await settingResponse.json();
        console.log("setting Result " + settingResult);
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
 * 将 Markdown 文本转换为 NoteAtom 结构
 * @param {string} markdown
 * @returns {{ noteAtom: object}}
 */
export function markdownToNoteAtom(title: string, markdown: string): { content: any[] } {
  const lines = markdown.split('\n');
  const content = [];
  content.push({
    type: 'paragraph',
    content: [
      { type: 'text', text: title, marks: [{ type: 'bold' }] }
    ]
  });
  let inQuote = false;
  let quoteBuffer = [];
  let inFrontmatter = false;
  let inCode = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // 处理 frontmatter
    if (line === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) {
      continue;
    }
    if (line === '```') {
      inCode = !inCode;
    }

    // 1. 引用块
    if (line.startsWith('>')) {
      //  引用前加个空行
      // content.push({type: 'paragraph'});
      inQuote = true;
      quoteBuffer.push(line.replace(/^>/, '').trim());
      continue;
    }
    if (inQuote && !line.startsWith('>')) {
      // 结束引用
      content.push({
        type: 'quote',
        content: [
          {
            type: 'text',
            text: quoteBuffer.join('\n')
          }
        ]
      });
      // 引用后添加空行
      content.push({type: 'paragraph'});
      quoteBuffer = [];
      inQuote = false;
    }

    // 2. 图片
    const imgMatch = line.match(/^!\[\[(.+?)\]\]/);
    if (imgMatch) {
      content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: imgMatch[1],
            marks: [{ type: 'image', attrs: { src: imgMatch[1] } }]
          }
        ]
      });
      continue;
    }

    // 3. 标题
    const headingMatch = line.match(/^(#+)\s*(.+)$/);
    if (headingMatch) {
      content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '\n' + headingMatch[2] + '\n',
            marks: [{ type: 'bold' }]
          }
        ]
      });
      continue;
    }

    // 4. 处理普通文本（包括加粗和链接）
    if (line !== '') {
      const parts = [];
      
      // 处理链接的正则表达式
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let lastIndex = 0;
      let match;
      
      while ((match = linkRegex.exec(line)) !== null) {
        // 处理链接前的普通文本
        if (match.index > lastIndex) {
          const textBeforeLink = line.slice(lastIndex, match.index);
          // 处理加粗
          let textParts = [];
          let currentBoldText = '';
          let inBoldSection = false;
          
          for (let j = 0; j < textBeforeLink.length; j++) {
            if (textBeforeLink[j] === '*' && textBeforeLink[j + 1] === '*') {
              if (currentBoldText) {
                textParts.push({
                  type: 'text',
                  text: currentBoldText,
                  marks: inBoldSection ? [{ type: 'bold' }] : []
                });
                currentBoldText = '';
              }
              inBoldSection = !inBoldSection;
              j++;
            } else {
              currentBoldText += textBeforeLink[j];
            }
          }
          
          if (currentBoldText) {
            textParts.push({
              type: 'text',
              text: currentBoldText,
              marks: inBoldSection ? [{ type: 'bold' }] : []
            });
            // textParts.push({ type: 'paragraph' });
          }
          
          parts.push(...textParts);
        }
        // 处理链接
        parts.push({
          type: 'text',
          text: match[1],
          marks: [{ type: 'link', attrs: { href: match[2] } },{type: 'bold'} ,{type: 'highlight'}]
        });
        
        lastIndex = match.index + match[0].length;
      }
      
      // 处理链接后的剩余文本
      if (lastIndex < line.length) {
        const remainingText = line.slice(lastIndex);
        // 处理加粗
        let textParts = [];
        let currentBoldText = '';
        let inBoldSection = false;
        
        for (let j = 0; j < remainingText.length; j++) {
          if (remainingText[j] === '*' && remainingText[j + 1] === '*') {
            if (currentBoldText) {
              textParts.push({
                type: 'text',
                text: currentBoldText,
                marks: inBoldSection ? [{ type: 'bold' }] : []
              });
              currentBoldText = '';
            }
            inBoldSection = !inBoldSection;
            j++;
          } else {
            currentBoldText += remainingText[j];
          }
        }
        
        if (currentBoldText) {
          textParts.push({
            type: 'text',
            text: currentBoldText,
            marks: inBoldSection ? [{ type: 'bold' }] : []
          });
        }
        
        parts.push(...textParts);
      }

      if (parts.length > 0) {
        // 添加段落换行，但不在代码块内添加
        if (!inCode) {
          parts.push({ type: 'paragraph' });
        }
        content.push({
          type: 'paragraph',
          content: parts
        });
      }
    }
  }

  return {
    content: content
  };
}

/**
 * 将 Markdown 文本中的 tags 提取出来
 * @param {string} markdown
 * @returns {string[]}
 */
export function markdownTagsToNoteAtomTags(markdown: string): { tags: string[] } {
  const lines = markdown.split('\n');
  let inYaml = false;
  let yamlLines = [];
  let tags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // 1. YAML头部
    if (line === '---') {
      inYaml = !inYaml;
      continue;
    }
    if (inYaml) {
      yamlLines.push(line);
      continue;
    }
  }
  // 处理 YAML
  if (yamlLines.length > 0) {
    for (let idx = 0; idx < yamlLines.length; idx++) {
      const yamlLine = yamlLines[idx];
      if (yamlLine.startsWith('tags:')) {
        // tags 多行合并
        let tagLine = yamlLine.replace('tags:', '').trim();
        if (tagLine === '') {
          let j = idx + 1;
          let tagArr = [];
          while (j < yamlLines.length && yamlLines[j].startsWith('-')) {
            tagArr.push(yamlLines[j].replace('-', '').trim());
            j++;
          }
          tags = tagArr;
        } else {
          // 单行 tags: tag1, tag2
          tags = tagLine.split(',').map(t => t.trim()).filter(Boolean);
        }
        // 不再将 tags 作为 paragraph 插入 content
      }
    }
  }
  // 在 tags 中添加 Obsidian
  tags.push('Obsidian');
  return {
    tags: tags
  };
}