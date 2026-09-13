/**
 * 启动期迁移幂等性回归（2026-09-09，owner 实抓的现行 bug）
 *
 * 症状：electron/db.cjs 里「2026-08-31 观察卡/EP 分离迁移」没有一次性闸门，
 * 每次启动都会把 episodes 上 observation/question/insight 抄成一张观察卡、再把 EP 清空。
 * 而 card:grow（64b41dd 修"EP 出生即空壳"）本来就会正常写这三列 ——
 * 于是「长成的 EP」每次重启都被剥一层：多一张假卡 + EP 原料消失。
 * 实测污染：13 张假观察卡 + Season 2 的 11 条计划位命题被洗成空。
 *
 * 修法：PRAGMA user_version 当水位，跑过即永久跳过。
 * 这条测试只有在"同一 userData 重启"下才可能抓到，所以专门给它加了 harness 能力。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchAutoWriter, type LaunchedApp } from './_electron-app';

test('重启不把 EP 原料抄成假卡——观察卡/EP 分离迁移必须只跑一次', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mig-restart-'));
  let first: LaunchedApp | null = null;
  let second: LaunchedApp | null = null;

  try {
    // ── 第一次启动：建库 + 跑一次迁移（此时没有任何 EP，迁移应为空操作） ──
    first = await launchAutoWriter({ userDataDir: dir, resetDb: true });

    const made = await first.window.evaluate(async () => {
      // @ts-ignore
      const card = await window.electronAPI.saveCard({
        observation: '重启回归卡：电梯里两个人聊 AI 替代编剧，聊得特别兴奋',
        question: '他们兴奋的是成片，还是"能聊这事"本身？',
        insight: '没看过成片也能聊得很兴奋',
      });
      // @ts-ignore
      const grown = await window.electronAPI.growCard(card.id);
      // @ts-ignore
      const cards = await window.electronAPI.listCards({});
      return { cardId: card.id, epId: grown.episodeId, cardsAfterGrow: cards.length };
    });
    expect(made.epId).toBeTruthy();
    expect(made.cardsAfterGrow).toBe(1);

    // 第一次启动时 EP 上是带着原料的（card:grow 的既定行为）
    const beforeRestart = await first.window.evaluate(async (id) => {
      // @ts-ignore
      const ep = await window.electronAPI.getEpisode(id);
      return { insight: ep?.insight || '', question: ep?.question || '' };
    }, made.epId);
    expect(beforeRestart.insight).toContain('没看过成片');

    await first.app.close();
    first = null;

    // ── 第二次启动同一份 userData：旧实现会在这里把 EP 三字段抄成第二张卡并清空 ──
    second = await launchAutoWriter({ userDataDir: dir, resetDb: false });

    const after = await second.window.evaluate(async (id) => {
      // @ts-ignore
      const ep = await window.electronAPI.getEpisode(id);
      // @ts-ignore
      const cards = await window.electronAPI.listCards({});
      return {
        insight: ep?.insight || '',
        question: ep?.question || '',
        observation: ep?.observation || '',
        cardCount: cards.length,
      };
    }, made.epId);

    // EP 原料必须原样还在
    expect(after.insight).toContain('没看过成片');
    expect(after.question).toContain('兴奋的是成片');
    expect(after.observation).toContain('电梯里两个人');
    // 卡流里不能凭空多出一张"复制品"
    expect(after.cardCount).toBe(1);
  } finally {
    if (first) { try { await first.app.close(); } catch { /* 已关 */ } }
    if (second) { try { await second.app.close(); } catch { /* 已关 */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
