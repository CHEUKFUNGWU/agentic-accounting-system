import type { AgentTask } from '../components/OverviewModule';
import type { AppLanguage } from './preferences';

export const TASK_PANE_MEDIA = '(min-width: 1600px)';
const copy = {
  en: { title:'For your review', subtitle:'Focus on the items that need your judgment.', trigger:'Tasks', close:'Collapse task pane', backdrop:'Close task drawer', search:'Search tasks', placeholder:'Search tasks or references…', clear:'Clear task search', filters:'Task status', pending:'Pending', all:'All', list:'Task list', done:'Handled', review:'Needs review', noMatches:'No matching tasks', empty:'No pending tasks', showAll:'Show all', source:'Agent tasks', opened:'Opened {module}. No task action was executed.', footer:'Review in the workspace', footnote:'Selecting an item opens its module. It does not approve, post or change task status.' },
  zh: { title:'待你处理', subtitle:'把注意力留给需要判断的事。', trigger:'待办', close:'收起待办栏', backdrop:'关闭待办抽屉', search:'搜索右侧待办', placeholder:'搜索待办、编号…', clear:'清除待办搜索', filters:'待办状态筛选', pending:'待处理', all:'全部', list:'任务列表', done:'已处理', review:'待人工判断', noMatches:'没有匹配的待办', empty:'没有待处理事项', showAll:'查看全部', source:'Agent 待办', opened:'已打开{module}模块，尚未执行任何处理。', footer:'回到业务页面完成覆核', footnote:'点选仅打开对应模块，不会核准、过账或改变待办状态。' },
  es: { title:'Por revisar', subtitle:'Prioriza las tareas que necesitan tu criterio.', trigger:'Tareas', close:'Contraer tareas', backdrop:'Cerrar panel de tareas', search:'Buscar tareas', placeholder:'Buscar tareas o referencias…', clear:'Borrar búsqueda de tareas', filters:'Estado de tareas', pending:'Pendientes', all:'Todas', list:'Lista de tareas', done:'Resuelta', review:'Requiere revisión', noMatches:'No hay coincidencias', empty:'No hay tareas pendientes', showAll:'Ver todas', source:'Tareas de agentes', opened:'Se abrió {module}. No se ejecutó ninguna acción.', footer:'Revisa en el área de trabajo', footnote:'Seleccionar una tarea abre su módulo. No aprueba, contabiliza ni cambia su estado.' },
  ja: { title:'確認待ち', subtitle:'判断が必要な項目を確認します。', trigger:'タスク', close:'タスク欄を閉じる', backdrop:'タスクパネルを閉じる', search:'タスクを検索', placeholder:'タスクや参照番号を検索…', clear:'タスク検索をクリア', filters:'タスクの状態', pending:'未処理', all:'すべて', list:'タスク一覧', done:'処理済み', review:'確認が必要', noMatches:'一致するタスクがありません', empty:'未処理のタスクはありません', showAll:'すべて表示', source:'Agent タスク', opened:'{module}を開きました。処理は実行していません。', footer:'業務画面で確認してください', footnote:'選択すると対応する画面を開きます。承認、転記、状態変更は実行しません。' },
};
const categories: Record<AppLanguage, Record<AgentTask['category'], string>> = {
  en: { 'Revenue Recognition':'Revenue recognition', 'Bank Reconciliation':'Bank reconciliation', 'Tax Nexus':'Tax judgment', 'Accrual Drift':'Accrual difference' },
  zh: { 'Revenue Recognition':'收入确认', 'Bank Reconciliation':'银行核对', 'Tax Nexus':'税务判断', 'Accrual Drift':'应计差异' },
  es: { 'Revenue Recognition':'Reconocimiento de ingresos', 'Bank Reconciliation':'Conciliación bancaria', 'Tax Nexus':'Revisión fiscal', 'Accrual Drift':'Diferencia de devengos' },
  ja: { 'Revenue Recognition':'収益認識', 'Bank Reconciliation':'銀行照合', 'Tax Nexus':'税務判断', 'Accrual Drift':'未払・未収差異' },
};
export const queueCopy = (language: AppLanguage) => copy[language] || copy.en;
export const queueCategory = (task: AgentTask, language: AppLanguage) => categories[language]?.[task.category] || task.category;
export const pendingTaskCount = (tasks: AgentTask[]) => tasks.filter(task => !task.resolved).length;
export function filterTasks(tasks: AgentTask[], query: string, filter: 'pending' | 'all', language: AppLanguage) {
  const term = query.normalize('NFKC').trim().toLowerCase();
  return tasks.filter(task => (filter === 'all' || !task.resolved) && `${task.title} ${task.description} ${task.code} ${task.id} ${task.category} ${queueCategory(task, language)}`.normalize('NFKC').toLowerCase().includes(term));
}
export function queuePeriod(period: string, language: AppLanguage): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return period;
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : language, { year:'numeric', month:'long', timeZone:'UTC' }).format(new Date(`${period}-01T00:00:00Z`));
}
