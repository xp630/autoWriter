# Flux 模型图片提示词优化模板

本模板基于 standard 扩写结果，针对 **Flux** 模型进行二次优化。

## Flux 风格特点

### Flux 喜欢的词
- `photorealistic, realistic photo, hyperrealistic`
- `cinematic, cinematic lighting, dramatic lighting`
- `highly detailed, extremely detailed, intricate details`
- `sharp focus, crisp, clean`
- `professional photography, award-winning photography`
- `beautiful, stunning, breathtaking`
- `8k, 4k, ultra high definition`
- `natural lighting, soft lighting, studio lighting`
- `vibrant colors, rich colors, vivid`
- `masterpiece, best quality`

### Flux 不喜欢的词（避免使用）
- 相机/镜头型号（如 `shot on Canon, shot on Sony`）
- Midjourney 特有参数（如 `--ar, --style, --v`）
- `anime, cartoon, illustration`（除非明确要插画风格）
- 过于艺术化的描述

### Flux 构图偏好
- `wide angle shot` / `close-up shot` / `medium shot`
- `front view` / `side view` / `bird's eye view` / `worm's eye view`
- `portrait orientation` / `landscape orientation`
- `shallow depth of field` / `deep focus`
- `centered composition` / `off-center composition`
- `symmetrical` / `asymmetrical`

### Flux 光线表达
- `natural light, soft natural light`
- `dramatic lighting, dramatic shadows`
- `backlit, side-lit, front-lit`
- `golden hour lighting, blue hour`
- `neon lights, warm lights, cool lights`
- `volumetric lighting, god rays`
- `bokeh, bokeh background`

## 优化规则

### 规则 1：强化质量词
在 standard 结果基础上，增加 2-3 个质量强化词：
```
standard 输出 → 末尾加 "photorealistic, highly detailed, sharp focus"
```

### 规则 2：替换不适配词
将 standard 中可能不适配的词替换：
| 替换 | 成为 |
|------|------|
| `shot on Sony A7IV` | `professional photography` |
| `85mm lens` | `portrait lens effect` |
| `anamorphic lens flare` | `cinematic lens flare, film grain` |
| `Vogue style` | `high fashion editorial photography` |

### 规则 3：保持简洁
Flux 偏好**清晰直接的描述**，避免过长堆砌。
- 如果 standard 输出超过 120 词，精简次要修饰
- 优先保留：主体 + 光线 + 氛围 + 风格

### 规则 4：负面词固定格式
```
--no cartoon, anime, low quality, watermark, text, blurry, distorted, oversaturated, deformed, bad anatomy, cropped, frame, border, signature, illustration
```

## Flux 专用示例

**standard 输出**：cinematic medium shot, young programmer coding late night, dark office, multiple monitors glowing, coffee cup, depth of field, moody atmosphere...

**flux 优化后**：
```
cinematic medium shot of young programmer coding late night in dark modern office, multiple monitors with glowing blue light, warm desk lamp mixed with cool screen light, coffee cup on desk, shallow depth of field, moody and focused atmosphere, photorealistic, highly detailed, sharp focus --no cartoon, anime, low quality, watermark, text, blurry
```

**standard 输出**：aerial view of modern skyscrapers at night, city skyline glowing, bokeh car lights...

**flux 优化后**：
```
aerial view of modern glass skyscrapers at night in Shenzhen, city skyline glowing with blue and warm yellow lights, wet streets reflecting neon signs, bokeh car lights in distance, dramatic lighting, stunning cityscape, photorealistic, highly detailed, 4k, cinematic --no cartoon, watermark, text, blurry, low quality
```

## 输出格式

直接输出**一行英文提示词**，经过 Flux 优化后：
- 长度：100-140 词
- 逗号分隔
- 末尾带负面词
- **不要任何解释、编号、注释**
