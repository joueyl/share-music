import { expect, it } from 'vitest';
import { parseChangelog } from '../src/release-history';
import { APP_VERSION, RELEASE_HISTORY } from '../src/version-info';
it('parses version dates, pending entries and categories without rendering HTML',()=>{
 expect(parseChangelog('# 更新日志\r\n## [未发布]\r\n### 新增\r\n- <script>alert(1)</script>\r\n## [1.2.3] - 2026-10-27\r\n- 修复问题')).toEqual([
  {version:'未发布',date:'',groups:[{title:'新增',items:['<script>alert(1)</script>']}]},
  {version:'1.2.3',date:'2026-10-27',groups:[{title:'更新内容',items:['修复问题']}]},
 ]);
 expect(parseChangelog('## [未发布]\n\n## [1.0.0]\n### 修复\n- 问题')).toHaveLength(1);
});
it('loads the same version and changelog used for packaging',()=>{
 expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
 expect(RELEASE_HISTORY.some(entry=>entry.version===APP_VERSION)).toBe(true);
});
