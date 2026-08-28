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

  // 1. Pollinations（免费，无需 API Key）
  db.prepare(`
    INSERT INTO image_providers (provider_id, name, base_url, priority, extra_config)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'pollinations',
    'Pollinations.ai（免费）',
    'https://image.pollinations.ai',
    1,
    JSON.stringify({ timeout: 120000 })
  );

  // Pollinations 模型
  db.prepare(`
    INSERT INTO image_models (provider_id, model_id, name, is_default, extra_params)
    VALUES (?, ?, ?, ?, ?)
  `).run('pollinations', 'flux', 'Flux（质量优先）', 1, JSON.stringify({ width: 1200, height: 800 }));

  db.prepare(`
    INSERT INTO image_models (provider_id, model_id, name, is_default, extra_params)
    VALUES (?, ?, ?, ?, ?)
  `).run('pollinations', 'flux-schnell', 'Flux Schnell（速度优先）', 0, JSON.stringify({ width: 1200, height: 800 }));

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
  console.log('  1. Pollinations（免费，无需配置）');
  console.log('  2. Tensor.art（需在设置页填写 Access Token）');
}

// 如果直接运行此脚本
if (require.main === module) {
  initImageProviders();
}

module.exports = { initImageProviders };
