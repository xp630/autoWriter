// Preload — 安全的 contextBridge 暴露
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),

  // Agent CLI 检测
  detectAgents: () => ipcRenderer.invoke('agent:detect'),
  listModels: (cli) => ipcRenderer.invoke('agent:list-models', cli),

  // 网页抓取
  fetchUrl: (url) => ipcRenderer.invoke('web:fetch', url),

  // 图片 Provider
  listImageProviders: () => ipcRenderer.invoke('image:provider:list'),
  getImageProvider: (id) => ipcRenderer.invoke('image:provider:get', id),
  saveImageProvider: (data) => ipcRenderer.invoke('image:provider:save', data),
  deleteImageProvider: (id) => ipcRenderer.invoke('image:provider:delete', id),
  getActiveImageProviders: () => ipcRenderer.invoke('image:provider:get-active'),
  listImageModels: (providerId) => ipcRenderer.invoke('image:model:list', providerId),
  saveImageModel: (data) => ipcRenderer.invoke('image:model:save', data),

  // Skills
  listSkills: () => ipcRenderer.invoke('skills:list'),

  // 文章
  generateOutline: (params) => ipcRenderer.invoke('article:outline', params),
  generateArticle: (params) => ipcRenderer.invoke('article:article', params),
  polishArticle: (params) => ipcRenderer.invoke('article:polish', params),
  saveMarkdownFile: (params) => ipcRenderer.invoke('file:save-md', params),
  saveImageFile: (params) => ipcRenderer.invoke('file:save-image', params),
  generateImage: (params) => ipcRenderer.invoke('image:generate', params),
  listArticleImages: (articleId) => ipcRenderer.invoke('article:images', articleId),
  generateImageFor: (params) => ipcRenderer.invoke('image:generate-for', params),
  uploadImageFor: (params) => ipcRenderer.invoke('image:upload-for', params),
  listAllImages: () => ipcRenderer.invoke('images:list'),
  deleteImage: (id) => ipcRenderer.invoke('images:delete', id),
  readImageDataUrl: (path_or_id) => ipcRenderer.invoke('image:read-dataurl', { path_or_id }),
  updateImage: (params) => ipcRenderer.invoke('images:update', params),
  getImageRefs: (id) => ipcRenderer.invoke('images:refs', id),
  linkImageToArticle: (params) => ipcRenderer.invoke('image:link-to-article', params),
  listPrompts: () => ipcRenderer.invoke('prompts:list'),
  getPrompt: (name) => ipcRenderer.invoke('prompts:get', name),
  savePrompt: (params) => ipcRenderer.invoke('prompts:save', params),
  updateArticle: (params) => ipcRenderer.invoke('article:update', params),
  listArticles: (params) => ipcRenderer.invoke('article:list', params),
  getArticle: (id) => ipcRenderer.invoke('article:get', id),
  scheduleArticle: (params) => ipcRenderer.invoke('article:schedule', params),
  unscheduleArticle: (id) => ipcRenderer.invoke('article:unschedule', id),
  publishArticle: (id) => ipcRenderer.invoke('article:publish', id),
  unpublishArticle: (id) => ipcRenderer.invoke('article:unpublish', id),
  deleteArticle: (id) => ipcRenderer.invoke('article:delete', id),

  // Agent 实时进度（subscribe / unsubscribe）
  onAgentChunk: (cb) => {
    const listener = (_e, chunk) => cb(chunk);
    ipcRenderer.on('agent:chunk', listener);
    return () => ipcRenderer.removeListener('agent:chunk', listener);
  },

  // 任务队列
  queueList: () => ipcRenderer.invoke('queue:list'),
  queueCancel: (taskId) => ipcRenderer.invoke('queue:cancel', taskId),
  queueClearCompleted: () => ipcRenderer.invoke('queue:clear-completed'),
  onQueueState: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('queue:state', listener);
    return () => ipcRenderer.removeListener('queue:state', listener);
  },

  // 调度器
  schedulerSnapshot: () => ipcRenderer.invoke('scheduler:snapshot'),
  schedulerEnable: () => ipcRenderer.invoke('scheduler:enable'),
  schedulerDisable: () => ipcRenderer.invoke('scheduler:disable'),
  schedulerRunNow: (name) => ipcRenderer.invoke('scheduler:run-now', name),
  schedulerSetInterval: (ms) => ipcRenderer.invoke('scheduler:set-interval', ms),

  // 测试钩子 —— main.cjs 在 AUTOWRITER_TEST_MODE=1 时注册对应的 test:* handler
  // preload 始终暴露这些方法（不检查 env，避免 preload process.env 不可靠的问题）
  // 在生产模式下，main.cjs 不会注册 test:* handler，这里调用会得到"未注册"错误
  _test: {
    listChannels: () => ipcRenderer.invoke('test:list-channels'),
    invoke: (channel, ...args) => ipcRenderer.invoke('test:invoke', channel, ...args),
    resetDb: () => ipcRenderer.invoke('test:reset-db'),
    getUserDataDir: () => ipcRenderer.invoke('test:userdata'),
    execSql: (sql, params) => ipcRenderer.invoke('test:exec-sql', sql, params),
  },
});