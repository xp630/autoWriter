// 富文本编辑器（TipTap）
// 功能：所见即所得 + toolbar（加粗/斜体/标题/列表/链接/代码）
// 双向：HTML ↔ Markdown

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TurndownService from 'turndown';
import { marked } from 'marked';
import { useEffect, useState, useMemo } from 'react';
import { getImageSettings } from '../utils/storage';

const td = new TurndownService({
  headingStyle: 'atx',          // # ## ###
  codeBlockStyle: 'fenced',    // ```
  bulletListMarker: '-',
  emDelimiter: '*',
});

// 简单的 markdown → HTML 转换（用 marked）
function md2html(md: string): string {
  if (!md) return '<p></p>';
  return marked.parse(md, { async: false, breaks: true, gfm: true }) as string;
}

interface Props {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
}

export function RichEditor({ initialMarkdown, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: true, allowBase64: true }),
    ],
    content: md2html(initialMarkdown),
    editorProps: {
      attributes: { class: 'rich-editor', spellCheck: 'false' },
      handlePaste(view, event) {
        // 粘贴图片 → 转 base64 → 调 saveImageFile → 插入 file:// URL
        const items = Array.from(event.clipboardData?.items || []);
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onload = async () => {
                try {
                  const dataUrl = reader.result as string;
                  const r = await (window as any).electronAPI.saveImageFile({
                    dataUrl, filename: `pasted-${Date.now()}.png`,
                  });
                  if (r?.url) {
                    editor?.chain().focus().setImage({ src: r.url }).run();
                  }
                } catch (err) {
                  console.error('[RichEditor] paste image failed:', err);
                }
              };
              reader.readAsDataURL(file);
            }
            return true;
          }
        }
        // HTML 粘贴（含 <img>）— 比如从其他网页复制富文本
        const html = event.clipboardData?.getData('text/html');
        if (html && /<img/i.test(html)) {
          // 让 TipTap 自己处理 HTML（保留 <img>），不拦截
          return false;
        }
        return false;
      },
      handleDrop(view, event) {
        // 拖拽图片
        const files = Array.from(event.dataTransfer?.files || []);
        const imageFile = files.find(f => f.type.startsWith('image/'));
        if (imageFile) {
          event.preventDefault();
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const dataUrl = reader.result as string;
              const r = await (window as any).electronAPI.saveImageFile({
                dataUrl, filename: `dropped-${Date.now()}.${imageFile.name.split('.').pop() || 'png'}`,
              });
              if (r?.url) editor?.chain().focus().setImage({ src: r.url }).run();
            } catch (err) { console.error(err); }
          };
          reader.readAsDataURL(imageFile);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(td.turndown(editor.getHTML())),
  });

  if (!editor) return <div style={{ padding: 16, color: 'var(--muted)' }}>加载编辑器...</div>;

  const insertImage = async () => {
    // 读取当前生图设置
    let provider = '', model = '';
    try {
      const s = getImageSettings();
      provider = s.provider || '';
      model = s.model || '';
    } catch {}
    
    // 显示选项
    const choice = confirm(
      '选择图片来源：\n\n' +
      '【确定】AI 生成图片\n' +
      `  Provider: ${provider || '自动（Pollinations）'}\n` +
      `  模型: ${model || '默认'}\n\n` +
      '【取消】从图库选择或上传文件'
    );
    
    if (choice) {
      // AI 生成
      const prompt = prompt('输入图片描述：');
      if (!prompt) return;
      
      // TODO: 调用 AI 生成并插入
      alert('AI 生图功能开发中，请先用「图库」页面生成图片后选择插入');
    } else {
      // 从图库选择或上传
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const r = await (window as any).electronAPI.saveImageFile({
            dataUrl: reader.result,
            filename: `manual-${Date.now()}.${file.name.split('.').pop() || 'png'}`,
          });
          if (r?.url) editor.chain().focus().setImage({ src: r.url }).run();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="rich-toolbar" style={{
        display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8,
        borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)',
        borderRadius: '6px 6px 0 0', alignItems: 'center',
      }}>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}><b>B</b></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}><i>I</i></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')}><s>S</s></ToolbarButton>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px', height: 18 }} />
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}>H1</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>H2</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>H3</ToolbarButton>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px', height: 18 }} />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>• 列表</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}>1. 列表</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')}>❝ 引用</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')}>{'</>'}</ToolbarButton>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px', height: 18 }} />
        <ToolbarButton onClick={insertImage}>🖼️ 图片</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()}>— 分隔</ToolbarButton>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px', height: 18 }} />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>↶</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>↷</ToolbarButton>
      </div>

      {/* 编辑区 */}
      <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 6px 6px', minHeight: 400, padding: '12px 16px', background: 'var(--card)' }}>
        <EditorContent editor={editor} className="rich-editor-content" />
      </div>
    </div>
  );
}

function ToolbarButton({ onClick, active, disabled, children }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px', fontSize: 12, border: '1px solid transparent',
        borderRadius: 4, background: active ? 'var(--line-light)' : 'transparent',
        color: active ? 'var(--line-2)' : 'var(--ink-2)', fontWeight: active ? 600 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}