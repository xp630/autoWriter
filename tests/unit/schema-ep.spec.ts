import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import path from 'node:path'; import Database from 'better-sqlite3';
const schema = fs.readFileSync(path.resolve(__dirname, '../../electron/schema.sql'), 'utf-8');
describe('EP V1 schema', () => {
  const db = new Database(':memory:'); db.exec(schema);
  it('四张新表存在', () => {
    for (const t of ['interview_messages','evidence','insights','article_plans'])
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)).toBeTruthy();
  });
  it('episodes 六槽位列存在且默认空串', () => {
    const r: any = db.prepare("SELECT event,reaction,development,shift,unknown,next FROM episodes LIMIT 0;").raw();
    for (const c of ['event','reaction','development','shift','unknown','next'])
      expect(schema).toMatch(new RegExp('\\n  ' + c + '\\s+TEXT DEFAULT \'\''));
  });
  it('evidence.kind 默认 fact', () => { expect(schema).toMatch(/kind\s+TEXT DEFAULT 'fact'/); });
});