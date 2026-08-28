// Fetcher — 用 Electron 内置 BrowserWindow 抓取网页正文
// 0 依赖，自动适配公众号 / 知乎 / 头条 / 通用网页

const { BrowserWindow } = require('electron');

/**
 * @param {string} url
 * @returns {Promise<{ title: string; text: string; byline: string; url: string; wordCount: number }>}
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const TIMEOUT = 20_000; // 20s 超时
    let win = null;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { if (win && !win.isDestroyed()) win.close(); } catch {}
    };

    try {
      win = new BrowserWindow({
        show: false,         // 隐藏窗口
        width: 1280,
        height: 800,
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: false,
          // 用现有用户 session（关键：能复用浏览器 cookie，公众号登录态）
          // 注：这要求你的桌面 App 用同样的 userData 目录
        },
      });

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('抓取超时（20s）'));
      }, TIMEOUT);

      win.webContents.on('did-finish-load', async () => {
        try {
          // 等一下让 JS 渲染完成
          await new Promise(r => setTimeout(r, 800));
          const result = await win.webContents.executeJavaScript(`
            (function() {
              const title = document.title || '';
              // 平台特定选择器（按优先级试）
              const SELECTORS = [
                // 公众号
                '#js_content',
                // 知乎
                '.Post-RichTextContainer',
                '.RichText.ztext',
                // 知乎专栏
                '.Post-RichText',
                // 头条
                'article',
                '.article-content',
                // 通用
                'article',
                'main',
                '[role="main"]',
                '.post-content',
                '.entry-content',
                '.article-body',
                '.content',
                '#content',
              ];
              let bodyEl = null;
              let usedSelector = '';
              for (const sel of SELECTORS) {
                bodyEl = document.querySelector(sel);
                if (bodyEl && bodyEl.innerText.length > 200) {
                  usedSelector = sel;
                  break;
                }
              }
              if (!bodyEl) {
                // 兜底：用 body 全文
                bodyEl = document.body;
                usedSelector = 'body (fallback)';
              }
              // 提取文本（粗略保留段落）
              const paragraphs = Array.from(bodyEl.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, pre'))
                .map(p => p.innerText.trim())
                .filter(t => t.length > 10);
              const text = paragraphs.length > 0
                ? paragraphs.join('\\n\\n')
                : bodyEl.innerText;
              const byline =
                document.querySelector('meta[name="author"]')?.content ||
                document.querySelector('.author')?.innerText ||
                '';
              return {
                title,
                text: text.slice(0, 30000),  // 限制 30KB
                byline: byline.trim(),
                url: location.href,
                wordCount: text.length,
                usedSelector,
              };
            })();
          `);
          cleanup();
          resolve(result);
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      win.webContents.on('did-fail-load', (_e, code, desc) => {
        cleanup();
        reject(new Error(`加载失败 (${code}): ${desc}`));
      });

      win.loadURL(url).catch(err => {
        cleanup();
        reject(new Error(`loadURL 失败: ${err.message}`));
      });
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

module.exports = { fetchUrl };