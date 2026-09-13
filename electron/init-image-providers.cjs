/**
 * 初始化图片 Provider 数据
 */
const { getDb } = require('./db.cjs');

function initImageProviders() {
  const db = getDb();

  // 检查是否已初始化
  const existing = db.prepare('SELECT COUNT(*) as count FROM image_providers').get();
  if (existing.count > 0) {
    console.log('✅ Provider 已初始化，跳过');
    return;
  }

  console.log('📦 初始化图片 Provider...');

  // Pollinations（免费通道）已于 2026-08-31 从默认配置中移除：
  // owner 实测质量不可接受（"简直就是垃圾"）。
  // 架构仍支持免费 provider——以后出现高质量免费源，在这里加 provider 行 +
  // image-providers.cjs dispatch case 即可回来，无需其他改动。

  // 2. Tensor.art（使用 OpenAPI）
  db.prepare(`
    INSERT INTO image_providers (provider_id, name, base_url, priority, extra_config)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'tensorart',
    'Tensor.art（需 Access Token）',
    'https://openapi.tensor.art/openworks/v1',
    2,
    JSON.stringify({ accessToken: '', timeout: 180000 })
  );

  // Tensor.art 模型（工具名称映射）
  // 注意：这些是 tool_name，不是模型 ID
  const tensorartModels = [
    { id: 'photoreal_studio_z_image', name: 'Z Image 写实风格（推荐）', default: true, params: { width: 1024, height: 1024 } },
    { id: 'anime_lab_wai_illustrious', name: 'Wai Illustrious 动漫风格', default: false, params: { width: 1024, height: 1024 } },
    { id: 'stable_diffusion_xl', name: 'SDXL 通用', default: false, params: { width: 1024, height: 1024 } },
    { id: 'oc_character_illustration', name: 'OC 角色插画', default: false, params: { width: 1024, height: 1024 } },
  ];

  for (const m of tensorartModels) {
    db.prepare(`
      INSERT INTO image_models (provider_id, model_id, name, is_default, extra_params)
      VALUES (?, ?, ?, ?, ?)
    `).run('tensorart', m.id, m.name, m.default ? 1 : 0, JSON.stringify(m.params));
  }

  console.log('✅ Provider 初始化完成');
  console.log('\n支持的 Provider:');
  console.log('  1. Tensor.art（需在设置页填写 Access Token）');
  console.log('  （免费通道按需添加：曾有 Pollinations，因质量下线）');
}

// 如果直接运行此脚本
if (require.main === module) {
  initImageProviders();
}

module.exports = { initImageProviders };
