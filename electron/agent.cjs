// Agent CLI 客户端 — 把文章生成任务派给 pi / claude / opencode / codex
// 流式推送 stdout/stderr 到 renderer（实时进度）
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

/**
 * @typedef {Object} AgentConfig
 * @property {'pi' | 'claude' | 'opencode' | 'codex'} cli
 * @property {string} [model]
 * @property {string} [articleId]  - 用于 IPC 通道标识
 */

/**
 * 调用 Agent CLI 生成文章，**流式推送**日志
 * @param {AgentConfig} cfg
 * @param {string} prompt
 * @param {(chunk: {type: 'stdout' | 'stderr' | 'info' | 'error' | 'done', text: string}) => void} onChunk
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal] - 取消信号：触发后立即 SIGTERM 子进程，2 秒未退再 SIGKILL
 * @returns {Promise<{content: string, elapsedMs: number}>}
 */
function runAgent(cfg, prompt, onChunk, opts) {
  const signal = opts?.signal;
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agent-'));
    const outFile = path.join(tmpDir, 'output.md');

    // 外部已 abort，立即拒绝
    if (signal?.aborted) {
      cleanup(tmpDir);
      const err = new Error('cancelled by user');
      err.code = 'ABORTED';
      return reject(err);
    }

    let cmd, args;
    switch (cfg.cli) {
      case 'pi':
        cmd = 'pi';
        args = ['-p', prompt, '--output', outFile];
        if (cfg.model) args.push('--model', cfg.model);
        onChunk?.({ type: 'info', text: `🚀 启动 ${cmd}（带 --output 文件）...` });
        break;
      case 'claude':
        cmd = 'claude';
        args = ['-p', prompt, '--output-format', 'text'];
        if (cfg.model) args.push('--model', cfg.model);
        onChunk?.({ type: 'info', text: `🚀 启动 ${cmd}（输出到 stdout）...` });
        break;
      case 'opencode':
        cmd = 'opencode';
        args = ['run', prompt];
        if (cfg.model) args.push('--model', cfg.model);
        onChunk?.({ type: 'info', text: `🚀 启动 ${cmd} run...` });
        break;
      case 'codex':
        cmd = 'codex';
        args = ['exec', prompt];
        if (cfg.model) args.push('--model', cfg.model);
        onChunk?.({ type: 'info', text: `🚀 启动 ${cmd} exec...` });
        break;
      default:
        return reject(new Error(`未知 CLI: ${cfg.cli}`));
    }

    let stdout = '';
    let stderr = '';
    let lastChunkAt = Date.now();

    const child = spawn(cmd, args, {
      env: { ...process.env, NO_COLOR: '1' },
      shell: process.platform === 'win32',
    });

    // 把 abort 信号转成子进程终止：先 SIGTERM 给机会清理，2s 后 SIGKILL 兜底
    let killTimer = null;
    const onAbort = () => {
      onChunk?.({ type: 'info', text: `⛔ 收到取消信号，终止 ${cmd} 子进程...` });
      try { child.kill('SIGTERM'); } catch {}
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 2000);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    onChunk?.({ type: 'info', text: `📍 命令: ${cmd} ${args[0]} <prompt> ${args.length > 2 ? args.slice(2).join(' ') : ''}` });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      lastChunkAt = Date.now();
      // 按行切割推送
      for (const line of text.split('\n')) {
        if (line.trim()) onChunk?.({ type: 'stdout', text: line });
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split('\n')) {
        if (line.trim()) onChunk?.({ type: 'stderr', text: line });
      }
    });

    child.on('error', (err) => {
      if (killTimer) { clearTimeout(killTimer); killTimer = null; }
      onChunk?.({ type: 'error', text: `启动 ${cmd} 失败: ${err.message}` });
      onChunk?.({ type: 'error', text: `提示：先在终端跑 \`${cfg.cli} -p "hi"\` 确认 CLI 已安装并登录` });
      cleanup(tmpDir);
      reject(new Error(`${cmd} 启动失败: ${err.message}`));
    });

    child.on('close', (code, sig) => {
      const elapsedMs = Date.now() - start;
      if (killTimer) { clearTimeout(killTimer); killTimer = null; }
      onChunk?.({ type: 'info', text: `⏱️ ${cmd} 退出 ${sig ? `信号 ${sig}` : `码 ${code}`}，用时 ${(elapsedMs / 1000).toFixed(1)}s` });

      // 被信号杀掉 → 视为取消
      if (sig === 'SIGTERM' || sig === 'SIGKILL' || code === null) {
        cleanup(tmpDir);
        const err = new Error(`cancelled (signal=${sig || 'null'})`);
        err.code = 'ABORTED';
        return reject(err);
      }

      if (code !== 0) {
        onChunk?.({ type: 'error', text: `❌ ${cmd} 退出码 ${code}` });
        cleanup(tmpDir);
        return reject(new Error(`${cmd} 退出码 ${code}\nstderr: ${stderr.slice(0, 500)}`));
      }

      let content = '';
      if (fs.existsSync(outFile)) {
        content = fs.readFileSync(outFile, 'utf-8').trim();
        onChunk?.({ type: 'info', text: `📄 从 --output 文件读取 ${content.length} 字符` });
      } else {
        content = stdout.trim();
        onChunk?.({ type: 'info', text: `📄 从 stdout 读取 ${content.length} 字符` });
      }

      onChunk?.({ type: 'done', text: `✅ 完成` });
      cleanup(tmpDir);
      resolve({ content, elapsedMs });
    });
  });
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/** 检测本机装了哪些 CLI */
function detectAvailableClis() {
  const clis = ['pi', 'claude', 'opencode', 'codex'];
  const result = {};
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const pathDirs = (process.env.PATH || '').split(pathSep);
  for (const cli of clis) {
    result[cli] = pathDirs.some(dir => {
      try {
        return fs.existsSync(path.join(dir, cli)) || fs.existsSync(path.join(dir, cli + '.exe'));
      } catch { return false; }
    });
  }
  return result;
}

/** 列出 CLI 可用模型
 * 只对 opencode 工作（它有 `opencode models` 命令）。
 * 其他 CLI（claude / pi / codex）官方都不提供列模型命令 → 返回空，让用户手填。
 * 不硬编码，硬编码很快过期。
 */
function listModels(cli) {
  if (cli !== 'opencode') return Promise.resolve([]);

  return new Promise((resolve) => {
    const child = spawn('opencode', ['models'], {
      env: { ...process.env, NO_COLOR: '1' },
      shell: process.platform === 'win32',
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 10000);
    let out = '';
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { out += c.toString(); });
    child.on('close', () => {
      clearTimeout(timer);
      const list = out.split('\n').map(s => s.trim()).filter(Boolean);
      resolve([...new Set(list)].slice(0, 50));
    });
    child.on('error', () => resolve([]));
  });
}

module.exports = { runAgent, detectAvailableClis, listModels };
