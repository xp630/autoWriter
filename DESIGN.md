# AutoWriter Desktop - Design Specification

## 1. Design System Overview

### Brand Identity
- **Product Name**: AutoWriter Desktop
- **Tagline**: AI 文章生成助手
- **Core Values**: 简洁、高效、专业

---

## 2. Color System

### Primary Colors (翡翠绿)
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--line` | `#10b981` | rgb(16, 185, 129) | 主色调、按钮、强调 |
| `--line-2` | `#059669` | rgb(5, 150, 105) | 悬停状态、active |
| `--line-soft` | `#d1fae5` | rgb(209, 250, 229) | 浅色背景 |
| `--line-light` | `#ecfdf5` | rgb(236, 253, 245) | 背景高亮 |
| `--line-glow` | `rgba(16, 185, 129, 0.25)` | - | 发光效果 |

### Background Colors
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--bg` | `#f8fafb` | rgb(248, 250, 251) | 主背景 |
| `--bg-soft` | `#f1f5f4` | rgb(241, 245, 244) | 卡片背景、hover |
| `--bg2` | `#e8f0ee` | rgb(232, 240, 238) | 代码块背景 |
| `--bg3` | `#dfe7e4` | rgb(223, 231, 228) | 输入框禁用 |
| `--card` | `#ffffff` | rgb(255, 255, 255) | 卡片、模态框 |

### Border Colors
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--border` | `#e2ebe7` | rgb(226, 235, 231) | 默认边框 |
| `--border-strong` | `#c8d9d3` | rgb(200, 217, 211) | 强调边框 |

### Accent Colors
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--accent` | `#f59e0b` | rgb(245, 158, 11) | 次要强调 |
| `--accent-soft` | `#fef3c7` | rgb(254, 243, 199) | 警告背景 |

### Danger/Error Colors
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--danger` | `#ef4444` | rgb(239, 68, 68) | 危险操作 |
| `--danger-soft` | `#fee2e2` | rgb(254, 226, 226) | 错误背景 |

### Text Colors
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--ink` | `#111827` | rgb(17, 24, 39) | 主文字 |
| `--ink-2` | `#374151` | rgb(55, 65, 81) | 次要文字 |
| `--ink-3` | `#6b7280` | rgb(107, 114, 128) | 三级文字 |
| `--muted` | `#64748b` | rgb(100, 116, 139) | 占位符、禁用、次要文字 |

### Code Block
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--code-bg` | `#1e293b` | rgb(30, 41, 59) | 代码块背景（深色） |

---

## 3. Typography

### Font Families
| Token | Font Stack | Usage |
|-------|------------|-------|
| `--font-sans` | `'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif` | 界面文字 |
| `--font-serif` | `'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif` | 正文、Markdown |
| `--font-mono` | `'JetBrains Mono', 'SF Mono', Consolas, monospace` | 代码、数字 |

### Type Scale
| Token | Size | Line Height | Weight | Usage |
|-------|------|-------------|--------|-------|
| `--text-xs` | 11px | 1.4 | 400 | 辅助文字、标签 |
| `--text-sm` | 12px | 1.5 | 400-500 | 按钮、次要 |
| `--text-base` | 14px | 1.6 | 400 | 正文 |
| `--text-md` | 15px | 1.7 | 400 | Markdown 正文 |
| `--text-lg` | 16px | 1.6 | 600 | 小标题 |
| `--text-xl` | 18px | 1.5 | 700 | 页面标题 |
| `--text-2xl` | 22px | 1.4 | 700 | 大标题 |
| `--text-3xl` | 24px | 1.3 | 700 | Hero 标题 |

### Markdown Typography
| Element | Font | Size | Weight | Line Height | Margin |
|---------|------|------|--------|-------------|--------|
| H1 | font-sans | 1.8rem | 700 | 1.3 | 0 0 20px |
| H2 | font-sans | 1.4rem | 700 | 1.4 | 32px 0 16px |
| H3 | font-sans | 1.15rem | 600 | 1.5 | 24px 0 12px |
| P | font-serif | 15px | 400 | 1.9 | 0 0 16px |
| Blockquote | font-serif | 15px | 400 | 1.9 | 20px 0 |
| Code (inline) | font-mono | 0.9em | 400 | - | 2px 6px |
| Pre | font-mono | 13px | 400 | 1.6 | 20px 0 |

---

## 4. Spacing System

### Base Unit: 4px

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | 紧凑间距 |
| `--space-2` | 8px | 元素内间距 |
| `--space-3` | 12px | 组件内间距 |
| `--space-4` | 16px | 卡片内间距 |
| `--space-5` | 20px | 中等间距 |
| `--space-6` | 24px | 区块间距 |
| `--space-8` | 32px | 大区块间距 |
| `--space-10` | 40px | 页面内大间距 |
| `--space-12` | 48px | 页边距 |

### Component Spacing
| Component | Padding | Gap |
|-----------|---------|-----|
| Card | 24px | - |
| Button (default) | 9px 18px | 6px |
| Button (small) | 6px 12px | 4px |
| Input | 10px 14px | - |
| Nav item | 10px 12px | 10px |

---

## 5. Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--r-xs` | 4px | 小圆角 |
| `--r-sm` | 6px | 按钮、输入框 |
| `--r` | 10px | 卡片、模态框 |
| `--r-lg` | 16px | 大卡片 |
| `--r-xl` | 20px | 特殊卡片 |
| `--r-pill` | 999px | 胶囊按钮 |

---

## 6. Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` | 轻微浮起 |
| `--shadow` | `0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` | 卡片默认 |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)` | 悬停 |
| `--shadow-lg` | `0 8px 32px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06)` | 模态框 |
| `--shadow-xl` | `0 16px 48px rgba(0,0,0,0.16), 0 8px 16px rgba(0,0,0,0.08)` | 弹窗 |

---

## 7. Layout System

### App Layout
```
┌──────────────────────────────────────────────────────┐
│ Sidebar (200px)  │  Main Content Area               │
│                  │                                    │
│ ┌──────────────┐ │  ┌────────────────────────────┐  │
│ │ Brand        │ │  │ Page Header                │  │
│ └──────────────┘ │  └────────────────────────────┘  │
│                  │                                    │
│ ┌──────────────┐ │  ┌────────────────────────────┐  │
│ │ Nav Group 1  │ │  │ Content Card              │  │
│ │  • Item 1    │ │  │ (margin: 24px 32px)      │  │
│ │  • Item 2    │ │  │                            │  │
│ │  • Item 3    │ │  │                            │  │
│ └──────────────┘ │  └────────────────────────────┘  │
│                  │                                    │
│ ┌──────────────┐ │                                    │
│ │ Nav Group 2  │ │                                    │
│ │  • Item 4    │ │                                    │
│ └──────────────┘ │                                    │
└──────────────────────────────────────────────────────┘
```

### Sidebar
- **Width**: 200px
- **Background**: `#ffffff`
- **Border Right**: 1px solid `#e2ebe7`
- **Header**: padding 20px 16px 16px
- **Nav Group**: padding 16px 8px 8px
- **Nav Item**: margin 2px 8px, padding 10px 12px

### Main Content
- **Padding**: 0 (full bleed)
- **Page Header**: padding 32px 32px 24px, border-bottom
- **Card Margin**: 24px 32px
- **Tab Bar**: padding 24px 32px 0

---

## 8. Components

### Button

#### Primary Button
```
Default:
  Background: #10b981
  Color: #ffffff
  Border: none
  Shadow: 0 2px 8px rgba(16,185,129,0.25)
  
Hover:
  Background: #059669
  Transform: translateY(-1px)
  Shadow: 0 4px 12px rgba(16,185,129,0.25)

Active:
  Transform: translateY(0)
```

#### Outline Button
```
Default:
  Background: transparent
  Color: #374151
  Border: 1px solid #e2ebe7
  
Hover:
  Color: #10b981
  Border: 1px solid #10b981
  Background: #ecfdf5
```

#### Button Sizes
| Size | Padding | Font Size | Usage |
|------|---------|-----------|-------|
| Small | 6px 12px | 12px | 工具栏、紧凑区域 |
| Default | 9px 18px | 13px | 通用 |
| Large | 12px 24px | 15px | 主要操作 |

### Card
```
Background: #ffffff
Border: 1px solid #e2ebe7
Border Radius: 16px
Padding: 24px
Shadow: 0 2px 8px rgba(0,0,0,0.06)
Margin: 24px 32px
```

### Input
```
Background: #f8fafb
Border: 1px solid #e2ebe7
Border Radius: 6px
Padding: 10px 14px
Font Size: 14px

Focus:
  Border: 1px solid #10b981
  Box Shadow: 0 0 0 3px rgba(16,185,129,0.25)
  Background: #ffffff
```

### Tab Pills
```
Default:
  Background: transparent
  Border: 1px solid #e2ebe7
  Color: #6b7280
  Padding: 8px 16px
  
Active:
  Background: #10b981
  Color: #ffffff
  Border: 1px solid #10b981
  Box Shadow: 0 2px 8px rgba(16,185,129,0.25)
```

### Stepper
```
Container:
  Background: #ffffff
  Border: 1px solid #e2ebe7
  Border Radius: 16px
  Padding: 16px 20px

Step Number:
  Size: 28px x 28px
  Border Radius: 50%
  Background: #f1f5f4
  Border: 2px solid #e2ebe7
  
Active/Done:
  Background: #10b981
  Color: #ffffff
  Border: #10b981
  Box Shadow: 0 0 0 4px rgba(16,185,129,0.25)
```

### Modal
```
Backdrop:
  Background: rgba(0,0,0,0.4)
  Filter: blur(4px)

Container:
  Background: #ffffff
  Border Radius: 16px
  Max Width: min(800px, 92vw)
  Max Height: 88vh
  Box Shadow: 0 8px 32px rgba(0,0,0,0.12)
```

---

## 9. Navigation

### Sidebar Nav Item
```
Default:
  Background: transparent
  Color: #374151
  Border: 1px solid transparent
  
Hover:
  Background: #f1f5f4
  Color: #111827

Active:
  Background: #ecfdf5
  Color: #059669
  Font Weight: 600
  Border: 1px solid #d1fae5
  
Active Indicator:
  Left: 3px solid #10b981
  Height: 20px
```

### Nav Label
```
Font Size: 10px
Font Weight: 600
Color: #64748b
Text Transform: uppercase
Letter Spacing: 0.1em
```

---

## 10. Animations & Transitions

### Timing
| Token | Value | Usage |
|-------|-------|-------|
| `--t-fast` | 120ms | 微交互 |
| `--t` | 200ms | 默认过渡 |
| `--t-slow` | 360ms | 大动画 |

### Easing
| Token | Value | Usage |
|-------|-------|-------|
| `--ease` | `cubic-bezier(0.4, 0, 0.2, 1)` | 默认 |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性 |

### Animations
```css
/* Fade Up */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

/* Shimmer (Loading) */
@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

/* Pulse */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

## 11. Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile | < 640px | Single column, sidebar hidden |
| Tablet | 640px - 1024px | Narrow sidebar (180px) |
| Desktop | > 1024px | Full layout (200px sidebar) |

---

## 12. Iconography

### Icon Style
- **Type**: Outline icons
- **Size**: 18px x 18px (nav), 16px (inline)
- **Stroke**: 1.5px - 2px
- **Color**: Inherit from text color

### Icon Usage
| Context | Size | Example |
|---------|------|---------|
| Navigation | 18px | Sidebar icons |
| Button | 16px | Button icon + text |
| Inline | 14px | List markers |

---

## 13. States

### Empty State
```
Background: linear-gradient(135deg, #ecfdf5 0%, #f1f5f4 100%)
Icon:
  Size: 80px x 80px
  Border Radius: 50%
  Shadow: var(--shadow-md)
```

### Loading State
```
Skeleton:
  Background: linear-gradient(90deg, #f1f5f4 0%, #e8f0ee 50%, #f1f5f4 100%)
  Background Size: 200% 100%
  Animation: shimmer 1.4s ease-in-out infinite
```

### Error State
```
Border: 1px solid #ef4444
Background: #fee2e2
Text: #ef4444
```

---

## 14. Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--z-base` | 0 | Default |
| `--z-dropdown` | 100 | Dropdown menus |
| `--z-modal` | 1000 | Modal backdrop |
| `--z-toast` | 2000 | Toast notifications |

---

## 15. Figma Tokens Format

```json
{
  "colors": {
    "primary": {
      "50": { "value": "#ecfdf5", "type": "color" },
      "100": { "value": "#d1fae5", "type": "color" },
      "500": { "value": "#10b981", "type": "color" },
      "600": { "value": "#059669", "type": "color" },
      "700": { "value": "#047857", "type": "color" }
    },
    "background": {
      "primary": { "value": "#f8fafb", "type": "color" },
      "card": { "value": "#ffffff", "type": "color" },
      "soft": { "value": "#f1f5f4", "type": "color" }
    },
    "text": {
      "primary": { "value": "#111827", "type": "color" },
      "secondary": { "value": "#374151", "type": "color" },
      "muted": { "value": "#64748b", "type": "color" }
    },
    "border": {
      "default": { "value": "#e2ebe7", "type": "color" },
      "strong": { "value": "#c8d9d3", "type": "color" }
    }
  },
  "typography": {
    "fontFamilies": {
      "sans": { "value": "Inter, system-ui, sans-serif", "type": "fontFamily" },
      "serif": { "value": "Noto Serif SC, Georgia, serif", "type": "fontFamily" },
      "mono": { "value": "JetBrains Mono, monospace", "type": "fontFamily" }
    },
    "fontSizes": {
      "xs": { "value": "11px", "type": "fontSize" },
      "sm": { "value": "12px", "type": "fontSize" },
      "base": { "value": "14px", "type": "fontSize" },
      "md": { "value": "15px", "type": "fontSize" },
      "lg": { "value": "16px", "type": "fontSize" },
      "xl": { "value": "18px", "type": "fontSize" },
      "2xl": { "value": "22px", "type": "fontSize" },
      "3xl": { "value": "24px", "type": "fontSize" }
    },
    "fontWeights": {
      "normal": { "value": "400", "type": "fontWeight" },
      "medium": { "value": "500", "type": "fontWeight" },
      "semibold": { "value": "600", "type": "fontWeight" },
      "bold": { "value": "700", "type": "fontWeight" }
    },
    "lineHeights": {
      "tight": { "value": "1.3", "type": "lineHeight" },
      "normal": { "value": "1.5", "type": "lineHeight" },
      "relaxed": { "value": "1.7", "type": "lineHeight" }
    }
  },
  "spacing": {
    "1": { "value": "4px", "type": "spacing" },
    "2": { "value": "8px", "type": "spacing" },
    "3": { "value": "12px", "type": "spacing" },
    "4": { "value": "16px", "type": "spacing" },
    "5": { "value": "20px", "type": "spacing" },
    "6": { "value": "24px", "type": "spacing" },
    "8": { "value": "32px", "type": "spacing" }
  },
  "radii": {
    "xs": { "value": "4px", "type": "borderRadius" },
    "sm": { "value": "6px", "type": "borderRadius" },
    "md": { "value": "10px", "type": "borderRadius" },
    "lg": { "value": "16px", "type": "borderRadius" },
    "pill": { "value": "999px", "type": "borderRadius" }
  },
  "shadows": {
    "sm": { "value": "0 1px 2px rgba(0,0,0,0.04)", "type": "shadow" },
    "md": { "value": "0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)", "type": "shadow" },
    "lg": { "value": "0 8px 32px rgba(0,0,0,0.12)", "type": "shadow" }
  }
}
```

---

## 16. Component Checklist

### Buttons
- [ ] Primary button with hover/active states
- [ ] Outline button with hover state
- [ ] Small/Default/Large sizes
- [ ] Disabled state
- [ ] Loading state (spinner)

### Form Elements
- [ ] Input with focus state
- [ ] Textarea
- [ ] Select dropdown
- [ ] Checkbox
- [ ] Radio

### Navigation
- [ ] Sidebar with nav items
- [ ] Active state indicator
- [ ] Group labels
- [ ] Tab bar with pills

### Cards
- [ ] Default card
- [ ] Card with header
- [ ] Card with footer

### Feedback
- [ ] Toast notifications
- [ ] Loading spinner
- [ ] Skeleton loading
- [ ] Empty state
- [ ] Error state

### Layout
- [ ] Modal/Dialog
- [ ] Dropdown menu
- [ ] Tooltip
- [ ] Popover

---

## 17. Accessibility

### Color Contrast
- Text on background: minimum 4.5:1 (AA standard)
- Large text: minimum 3:1
- Interactive elements: minimum 3:1

### Focus States
- All interactive elements must have visible focus state
- Focus ring: 2px solid #10b981 with 2px offset

### Screen Reader
- All icons must have aria-label or alt text
- Buttons must have accessible names
- Form inputs must have labels

---

*Document Version: 1.0*
*Last Updated: Auto-generated from AutoWriter Desktop CSS*
