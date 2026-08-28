/**
 * 平台排版工具 - 各平台内容适配
 */

// ===== 平台定义 =====
export type Platform = 'wechat' | 'xiaohongshu' | 'weibo' | 'zhihu' | 'toutiao';

export interface PlatformInfo {
  id: Platform;
  name: string;
  icon: string;
  desc: string;
  color: string;
}

export const PLATFORMS: PlatformInfo[] = [
  {
    id: 'wechat',
    name: '微信公众号',
    icon: '💚',
    desc: '2.35:1封面 · 正文14-16pt · 配图900px内',
    color: '#07c160',
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    icon: '🔴',
    desc: '短段落 · emoji · #标签 · 1:1封面',
    color: '#ff2442',
  },
  {
    id: 'weibo',
    name: '微博',
    icon: '🧡',
    desc: '短内容 · #话题# · 9图排版',
    color: '#ff9d00',
  },
  {
    id: 'zhihu',
    name: '知乎',
    icon: '💡',
    desc: '深度内容 · 代码块 · 引用格式',
    color: '#0066ff',
  },
  {
    id: 'toutiao',
    name: '今日头条',
    icon: '📰',
    desc: '标题党 · 3段式 · 2:1封面',
    color: '#f85959',
  },
];

// ===== 平台内容转换 =====
function stripMarkdown(md: string): string {
  return md
    // 移除代码块标记内的内容（保留原文）
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    // 移除标题标记但保留内容
    .replace(/^#{1,6}\s+/gm, '')
    // 移除加粗标记
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    // 移除斜体
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    // 移除删除线
    .replace(/~~(.*?)~~/g, '$1')
    // 移除链接但保留文字
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 移除水平线
    .replace(/^[-*_]{3,}$/gm, '')
    // 清理多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter(p => p.trim().length > 0);
}

// ===== 微信公众号适配 =====
function adaptWechat(title: string, content: string): string {
  const clean = stripMarkdown(content);
  const paragraphs = splitParagraphs(clean);

  // 微信公众号格式：标题 + 正文段落 + 配图提示
  let result = `【${title}】\n\n`;

  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    // 微信公众号段落不要太长
    if (trimmed.length > 200) {
      // 长段落拆成短句
      const sentences = trimmed.match(/[^.!?。！？]+[.!?。！？]+/g) || [trimmed];
      result += sentences.join('\n') + '\n\n';
    } else {
      result += trimmed + '\n\n';
    }
  }

  result += '\n---\n作者 | autoWriter';

  return result;
}

// ===== 小红书适配 =====
function adaptXiaohongshu(title: string, content: string): string {
  const clean = stripMarkdown(content);
  const paragraphs = splitParagraphs(clean);

  // 小红书：emoji + 短段落 + 标签
  let result = `✨ ${title}\n\n`;

  // 提取关键词作为标签
  const words = title.split(/[\s,，,、]/).filter(w => w.length >= 2 && w.length <= 6);
  const tags = words.slice(0, 5).map(w => `#${w}`);
  if (tags.length > 0) {
    result += tags.join(' ') + '\n\n';
  }

  result += '───────────\n\n';

  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    // 小红书每段要短
    const shortParas = trimmed.match(/.{1,80}/g) || [trimmed];
    for (const sp of shortParas) {
      result += '📍 ' + sp + '\n\n';
    }
  }

  result += '\n───────────\n';
  result += '👍 觉得有用就点个赞吧～\n';
  result += '❤️ 关注我，更多干货持续更新\n';
  result += '#autoWriter #AI写作 #内容创作';

  return result;
}

// ===== 微博适配 =====
function adaptWeibo(title: string, content: string): string {
  const clean = stripMarkdown(content);
  const paragraphs = splitParagraphs(clean);

  // 微博：2000字限制，#话题#，短内容
  const MAX_CHARS = 2000;
  let result = `#${title}#\n\n`;

  const words = title.split(/[\s,，]/).filter(w => w.length >= 2);
  if (words.length > 0) {
    result += '#' + words.slice(0, 3).join('# #') + '#\n\n';
  }

  let totalChars = result.length;

  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;

    // 短句用 · 连接
    const sentences = trimmed.match(/[^.!?。！？,，；;]+[.!?。！？,，；;]?/g) || [trimmed];
    for (const s of sentences) {
      const sTrim = s.trim();
      if (!sTrim) continue;
      if (totalChars + sTrim.length + 2 > MAX_CHARS) {
        result += '\n…\n\n#AI写作#';
        return result;
      }
      result += sTrim + ' · ';
      totalChars += sTrim.length + 3;
    }
    result += '\n\n';
  }

  // 截断太长时加话题
  if (result.length > MAX_CHARS) {
    result = result.slice(0, MAX_CHARS - 20) + '\n…\n#AI写作#';
  } else {
    result += '#AI写作#';
  }

  return result;
}

// ===== 知乎适配 =====
function adaptZhihu(title: string, content: string): string {
  const clean = content;
  const lines = clean.split('\n');

  // 知乎：保留 Markdown 格式，重点加粗，引用保留
  let result = `# ${title}\n\n`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { result += '\n'; continue; }

    // 标题
    if (trimmed.startsWith('# ')) {
      result += '\n## ' + trimmed.slice(2) + '\n\n';
      continue;
    }
    if (trimmed.startsWith('## ')) {
      result += '\n### ' + trimmed.slice(3) + '\n\n';
      continue;
    }

    // 引用保留
    if (trimmed.startsWith('> ')) {
      result += trimmed + '\n\n';
      continue;
    }

    // 列表保留
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      result += trimmed + '\n';
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      result += trimmed + '\n';
      continue;
    }

    // 代码块保留
    if (trimmed.startsWith('```')) {
      result += trimmed + '\n';
      continue;
    }

    // 普通段落：知乎可以稍长
    result += trimmed + '\n\n';
  }

  result += '\n---\n';
  result += '**作者：autoWriter**';

  return result;
}

// ===== 今日头条适配 =====
function adaptToutiao(title: string, content: string): string {
  const clean = stripMarkdown(content);
  const paragraphs = splitParagraphs(clean);

  // 头条：3段式爆款结构，引言+正文+结尾
  let result = `📌 ${title}\n\n`;

  // 引言（第一段）
  if (paragraphs.length > 0) {
    result += '「' + paragraphs[0].trim().slice(0, 100) + '」\n\n';
  }

  result += '───────────\n\n';

  // 正文（中间段落）
  const bodyParas = paragraphs.slice(1);
  for (const p of bodyParas) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    // 头条段落可以稍长
    if (trimmed.length > 150) {
      const parts = trimmed.match(/.{1,150}/g) || [trimmed];
      result += parts.join('\n') + '\n\n';
    } else {
      result += trimmed + '\n\n';
    }
  }

  result += '───────────\n\n';

  // 结尾引导
  result += `👉 关注我，了解更多${title.split(/[，,]/)[0] || '相关'}内容\n`;
  result += '#头条搜索 #AI写作 #内容创作';

  return result;
}

// ===== 主函数：平台适配 =====
export function adaptForPlatform(
  platform: Platform,
  title: string,
  content: string
): string {
  switch (platform) {
    case 'wechat':
      return adaptWechat(title, content);
    case 'xiaohongshu':
      return adaptXiaohongshu(title, content);
    case 'weibo':
      return adaptWeibo(title, content);
    case 'zhihu':
      return adaptZhihu(title, content);
    case 'toutiao':
      return adaptToutiao(title, content);
    default:
      return stripMarkdown(content);
  }
}

// ===== 平台预览标题 =====
export function getPlatformPreview(content: string, platform: Platform): string {
  const lines = content.split('\n').filter(l => l.trim());
  const firstLine = lines[0] || '';
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
}
