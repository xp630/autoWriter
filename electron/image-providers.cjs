/**
 * 图片生成 Provider 抽象层
 * 支持 Pollinations / Tensor.art
 */
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDb } = require('./db.cjs');

// ============ Pollinations ============
async function generateWithPollinations(prompt, params = {}) {
  const { width = 1200, height = 800, model = 'flux', seed } = params;
  const w = Math.min(width, 1500);
  const h = Math.min(height, 1500);
  const seedParam = seed && seed > 0 ? `&seed=${seed}` : '';
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&model=${model}&nologo=true${seedParam}`;
  
  const buf = await fetchBuffer(url, 120000);
  return buf;
}

// ============ Tensor.art OpenAPI ============
async function generateWithTensorart(prompt, params = {}) {
  const db = getDb();
  
  // 获取配置
  const provider = db.prepare(`SELECT * FROM image_providers WHERE provider_id='tensorart'`).get();
  if (!provider) throw new Error('Tensor.art Provider 未配置');
  
  let config = {};
  if (typeof provider.extra_config === 'string') {
    try { config = JSON.parse(provider.extra_config); } catch (e) {}
  } else if (typeof provider.extra_config === 'object') {
    config = provider.extra_config;
  }
  const { accessToken } = config;
  
  if (!accessToken) throw new Error('Tensor.art Access Token 未配置，请先在设置页填写');
  
  const { 
    width = 1024, 
    height = 1024, 
    model = 'photoreal_studio_z_image',  // 默认用写实风格
    toolName,
    steps = 25, 
    seed 
  } = params;
  
  // 1. 获取工具列表
  const tools = await tensorartListTools(accessToken);
  
  // 2. 选择工具（优先用指定的 model，否则用 photoreal 写实风格）
  const selectedTool = toolName 
    ? tools.find(t => t.name === toolName)
    : tools.find(t => 
        t.name?.includes('photoreal') || 
        t.description?.includes('photoreal') ||
        t.name?.includes('stable_diffusion')
      ) || tools[0];
  
  if (!selectedTool) throw new Error('未找到可用的图片生成工具');
  
  // 3. 构建输入参数
  const inputs = [];
  selectedTool.inputs?.forEach(input => {
    if (input.type === 'STRING' && (input.description?.includes('prompt') || input.name === 'prompt')) {
      inputs.push({ name: input.name, type: input.type, value: prompt });
    } else if (input.type === 'INTEGER' && input.description?.includes('width')) {
      inputs.push({ name: input.name, type: input.type, value: width });
    } else if (input.type === 'INTEGER' && input.description?.includes('height')) {
      inputs.push({ name: input.name, type: input.type, value: height });
    } else if (input.type === 'INTEGER' && input.description?.includes('count')) {
      inputs.push({ name: input.name, type: input.type, value: 1 });
    }
  });
  
  // 4. 创建任务
  const taskId = await tensorartCreateTask(accessToken, selectedTool.name, inputs);
  
  // 5. 轮询等待完成
  const task = await tensorartWaitForFinish(accessToken, taskId, 180000);
  
  // 6. 获取图片 URL
  const outputs = task?.outputs || [];
  if (outputs.length === 0) throw new Error('Tensor.art 未返回图片');
  
  const imageUrl = outputs[0]?.url || outputs[0]?.value;
  if (!imageUrl) throw new Error('Tensor.art 输出格式异常');
  
  // 7. 下载图片
  const buf = await fetchBuffer(imageUrl, 60000);
  return buf;
}

function tensorartRequest(method, apiPath, body, accessToken) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers = {
      'Content-Type': 'application/json',
      'Echo-Access-Key': accessToken,
    };
    
    const options = {
      hostname: 'openapi.tensor.art',
      path: `/openworks/v1${apiPath}`,
      method,
      headers,
    };
    
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error(`API 响应解析失败: ${d.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function tensorartListTools(accessToken) {
  const result = await tensorartRequest('POST', '/tool/list', {}, accessToken);
  if (result?.code !== '0') throw new Error(`获取工具列表失败: ${result?.message}`);
  return result?.data?.tools || [];
}

async function tensorartCreateTask(accessToken, toolName, inputs) {
  const result = await tensorartRequest('POST', '/task', { toolName, inputs }, accessToken);
  if (result?.code !== '0') throw new Error(`创建任务失败: ${result?.message}`);
  return result?.data?.task?.id;
}

async function tensorartQueryTask(accessToken, taskId) {
  const result = await tensorartRequest('POST', '/task/query', { taskIds: [taskId] }, accessToken);
  if (result?.code !== '0') throw new Error(`查询任务失败: ${result?.message}`);
  return result?.data?.tasks?.[0];
}

async function tensorartWaitForFinish(accessToken, taskId, maxWait = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const task = await tensorartQueryTask(accessToken, taskId);
    const status = task?.status;
    
    if (status === 'FINISH') return task;
    if (status === 'EXCEPTION' || status === 'CANCELED') {
      throw new Error(`任务异常: ${status}`);
    }
    

    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('任务超时');
}

// ============ 通用工具 ============
function fetchBuffer(url, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        fetchBuffer(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

// ============ 统一生图接口 ============
/**
 * 根据 provider_id 和 model 生成图片
 * @param {string} providerId - Provider ID (pollinations, tensorart...)
 * @param {string} prompt - 图片描述
 * @param {object} params - 参数 { model, toolName, width, height, seed... }
 * @returns {Promise<Buffer>} - 图片二进制数据
 */
async function generateImage(providerId, prompt, params = {}) {
  switch (providerId) {
    case 'pollinations':
      return generateWithPollinations(prompt, params);
    
    case 'tensorart':
      return generateWithTensorart(prompt, params);
    
    default:
      throw new Error(`不支持的图片 Provider: ${providerId}`);
  }
}

module.exports = { generateImage };
