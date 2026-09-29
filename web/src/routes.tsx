/* 路由表
 *
 * 单独放一个文件，因为它要同时被两处用：
 *   · AppShell 渲染页面（KeepAlivePages 按这张表保活）
 *   · 顶栏面包屑反查当前在哪一层
 * 两处各写一份迟早会漂移 —— 加了个页面，面包屑里没有它，
 * 顶栏就退回显示「库课」，而且没人会注意到。
 *
 * ★ 元素写在这里而不是在使用处 new：React 元素的身份要稳定，
 *   每次渲染都新建一个 <Dashboard /> 会让保活的页面被当成新节点重建，
 *   状态照样丢。模块级常量保证它整个会话里是同一个对象。
 */
import type { PageDef } from '@/components/layout/KeepAlivePages';

import Dashboard from '@/pages/Dashboard';
import Knowledge from '@/pages/Knowledge';
import KnowledgeDetail from '@/pages/KnowledgeDetail';
import SqlLab from '@/pages/SqlLab';
import { Levels, LevelDetail } from '@/pages/Levels';
import Practice from '@/pages/Practice';
import Normalize from '@/pages/Normalize';
import Labs from '@/pages/Labs';
import Mistakes from '@/pages/Mistakes';
import Review from '@/pages/Review';
import Stats from '@/pages/Stats';
import Achievements from '@/pages/Achievements';
import { Assignments, AssignmentDetail } from '@/pages/Assignments';
import Classes from '@/pages/Classes';
import Settings from '@/pages/Settings';
import { Admin, StudentDetail } from '@/pages/Admin';

export const APP_PAGES: PageDef[] = [
  { path: '/', node: <Dashboard /> },
  { path: '/learn', node: <Knowledge /> },
  { path: '/learn/:kid', node: <KnowledgeDetail /> },
  { path: '/lab/sql', node: <SqlLab /> },
  { path: '/levels', node: <Levels /> },
  { path: '/levels/:id', node: <LevelDetail /> },
  { path: '/practice', node: <Practice /> },
  { path: '/normalize', node: <Normalize /> },
  { path: '/lab', node: <Labs /> },
  { path: '/review', node: <Review /> },
  { path: '/mistakes', node: <Mistakes /> },
  { path: '/stats', node: <Stats /> },
  { path: '/achievements', node: <Achievements /> },
  { path: '/assignments', node: <Assignments /> },
  { path: '/assignments/:id', node: <AssignmentDetail /> },
  { path: '/classes', node: <Classes /> },
  { path: '/settings', node: <Settings /> },
  /* 教师端。这里不做角色判断 —— 页面自己会检查并给出提示。
   * 真正的门在服务端：/api/admin/* 每条路由都挂 preHandler，
   * 非教师即便把这一行删掉也拿不到数据。 */
  { path: '/admin', node: <Admin /> },
  { path: '/admin/students/:id', node: <StudentDetail /> },
];

/** 面包屑用的可读名。放在这里和路由表同源。 */
export const PAGE_NAMES: Record<string, string> = {
  '/': '仪表盘',
  '/learn': '知识树',
  '/lab/sql': 'SQL 实训场',
  '/levels': 'SQL 闯关',
  '/practice': '每日一练',
  '/normalize': '范式实验室',
  '/lab': '索引与事务',
  '/review': '复习队列',
  '/mistakes': '错题本',
  '/stats': '学习统计',
  '/achievements': '成就',
  '/assignments': '作业',
  '/classes': '班级',
  '/settings': '设置',
  '/admin': '教师工作台',
};
