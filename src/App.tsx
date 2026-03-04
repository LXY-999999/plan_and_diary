import { useEffect, useMemo, useState } from 'react'
import './App.css'
import ReactFlow, { Background, Controls, MiniMap, type Edge, type Node } from 'reactflow'
import 'reactflow/dist/style.css'

type Slot = '上午' | '下午' | '晚上'
type DayTask = { id: string; text: string; slot: Slot; done?: boolean; failed?: boolean }
type DiaryEntry = { id: string; title: string; content: string; createdAt: number }
type DayPlan = { day: number; tasks: DayTask[] }
type WeekGoal = { id: string; title: string; days: DayPlan[] }
type Theme = 'genki' | 'mint'
type GoalType = '年目标' | '月目标'
type Page = 'plan' | 'diary'
type DiariesByDate = Record<string, DiaryEntry[]>

type PersistedState = {
  theme: Theme
  goalType: GoalType
  rootGoal: string
  weekGoals: WeekGoal[]
  selectedWeekId: string
  openAIKey: string
  diariesByDate: DiariesByDate
}

const STORAGE_KEY = 'plan_and_diary_v1'

const emptyDays = (): DayPlan[] => Array.from({ length: 7 }, (_, i) => ({ day: i + 1, tasks: [] }))
const uuid = () => Math.random().toString(36).slice(2, 10)
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

function App() {
  const [theme, setTheme] = useState<Theme>('genki')
  const [goalType, setGoalType] = useState<GoalType>('月目标')
  const [rootGoal, setRootGoal] = useState('')
  const [weekGoals, setWeekGoals] = useState<WeekGoal[]>([])
  const [weekTitle, setWeekTitle] = useState('')

  const [selectedWeekId, setSelectedWeekId] = useState<string>('')
  const selectedWeek = weekGoals.find((w) => w.id === selectedWeekId)

  const [taskInput, setTaskInput] = useState('')
  const [day, setDay] = useState(1)
  const [slot, setSlot] = useState<Slot>('上午')

  const [openAIKey, setOpenAIKey] = useState('')
  const [autoPrompt, setAutoPrompt] = useState('')
  const [loadingAI, setLoadingAI] = useState(false)

  const [page, setPage] = useState<Page>('plan')
  const [diariesByDate, setDiariesByDate] = useState<DiariesByDate>({})
  const [diaryDay, setDiaryDay] = useState(1)
  const [diaryTitle, setDiaryTitle] = useState('')
  const [diaryContent, setDiaryContent] = useState('')
  const [openedDiary, setOpenedDiary] = useState<{ dateLabel: string; entry: DiaryEntry } | null>(null)

  const weekDates = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw) as Partial<PersistedState>
      if (data.theme) setTheme(data.theme)
      if (data.goalType) setGoalType(data.goalType)
      if (typeof data.rootGoal === 'string') setRootGoal(data.rootGoal)
      if (Array.isArray(data.weekGoals)) {
        const normalized = data.weekGoals.map((w) => ({
          ...w,
          days: (w.days || emptyDays()).map((d, i) => ({
            day: typeof d.day === 'number' ? d.day : i + 1,
            tasks: Array.isArray(d.tasks) ? d.tasks : [],
          })),
        }))
        setWeekGoals(normalized)
      }
      if (typeof data.selectedWeekId === 'string') setSelectedWeekId(data.selectedWeekId)
      if (typeof data.openAIKey === 'string') setOpenAIKey(data.openAIKey)
      if (data.diariesByDate && typeof data.diariesByDate === 'object') setDiariesByDate(data.diariesByDate)
    } catch (e) {
      console.warn('读取本地数据失败，已忽略。', e)
    }
  }, [])

  useEffect(() => {
    const payload: PersistedState = { theme, goalType, rootGoal, weekGoals, selectedWeekId, openAIKey, diariesByDate }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [theme, goalType, rootGoal, weekGoals, selectedWeekId, openAIKey, diariesByDate])

  const addWeek = () => {
    if (!weekTitle.trim()) return
    const w: WeekGoal = { id: uuid(), title: weekTitle.trim(), days: emptyDays() }
    setWeekGoals((prev) => [...prev, w])
    setSelectedWeekId(w.id)
    setWeekTitle('')
  }

  const addTask = () => {
    if (!selectedWeek || !taskInput.trim()) return
    setWeekGoals((prev) =>
      prev.map((w) => {
        if (w.id !== selectedWeek.id) return w
        return {
          ...w,
          days: w.days.map((d) =>
            d.day === day ? { ...d, tasks: [...d.tasks, { id: uuid(), text: taskInput.trim(), slot }] } : d,
          ),
        }
      }),
    )
    setTaskInput('')
  }

  const addDiary = () => {
    if (!diaryTitle.trim() || !diaryContent.trim()) return
    const targetDate = weekDates[diaryDay - 1]
    const key = dateKey(targetDate)
    const entry: DiaryEntry = { id: uuid(), title: diaryTitle.trim(), content: diaryContent.trim(), createdAt: Date.now() }
    setDiariesByDate((prev) => ({ ...prev, [key]: [entry, ...(prev[key] || [])] }))
    setDiaryTitle('')
    setDiaryContent('')
    setOpenedDiary({ dateLabel: `${targetDate.getMonth() + 1}月${targetDate.getDate()}日`, entry })
  }

  const markTask = (weekId: string, dayNum: number, taskId: string, mode: 'done' | 'failed') => {
    setWeekGoals((prev) =>
      prev.map((w) => {
        if (w.id !== weekId) return w
        return {
          ...w,
          days: w.days.map((d) =>
            d.day !== dayNum
              ? d
              : {
                  ...d,
                  tasks: d.tasks.map((t) =>
                    t.id !== taskId ? t : { ...t, done: mode === 'done', failed: mode === 'failed' },
                  ),
                },
          ),
        }
      }),
    )
  }

  const autoGenerateWeek = async () => {
    if (!selectedWeek || !openAIKey.trim()) {
      alert('请先选择周目标并填写 OpenAI Key')
      return
    }

    setLoadingAI(true)
    try {
      const prompt =
        autoPrompt.trim() ||
        `将目标“${selectedWeek.title}”拆解为 7 天任务，每天分上午、下午、晚上。返回 JSON，格式为 {"days":[{"day":1,"morning":"...","afternoon":"...","evening":"..."}]}`

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIKey.trim()}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: '你是计划拆解助手。仅输出 JSON。' },
            { role: 'user', content: prompt },
          ],
        }),
      })

      if (!res.ok) throw new Error(`OpenAI API 调用失败: ${res.status}`)
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content
      if (!content) throw new Error('返回内容为空')

      const parsed = JSON.parse(content)
      const arr = parsed?.days || parsed?.plan || parsed
      if (!Array.isArray(arr)) throw new Error('JSON 结构不符合预期，应为数组')

      setWeekGoals((prev) =>
        prev.map((w) => {
          if (w.id !== selectedWeek.id) return w
          const days = emptyDays().map((d) => {
            const m = arr.find((x: any) => Number(x.day) === d.day) || {}
            const tasks: DayTask[] = []
            if (m.morning) tasks.push({ id: uuid(), text: String(m.morning), slot: '上午' })
            if (m.afternoon) tasks.push({ id: uuid(), text: String(m.afternoon), slot: '下午' })
            if (m.evening) tasks.push({ id: uuid(), text: String(m.evening), slot: '晚上' })
            return { ...d, tasks }
          })
          return { ...w, days }
        }),
      )
    } catch (e: any) {
      alert(`自动拆解失败：${e?.message || '请检查 Key 或提示词格式'}`)
      console.error(e)
    } finally {
      setLoadingAI(false)
    }
  }

  const clearAll = () => {
    if (!confirm('确认清空所有本地计划数据吗？')) return
    localStorage.removeItem(STORAGE_KEY)
    setTheme('genki')
    setGoalType('月目标')
    setRootGoal('')
    setWeekGoals([])
    setSelectedWeekId('')
    setWeekTitle('')
    setTaskInput('')
    setOpenAIKey('')
    setAutoPrompt('')
    setPage('plan')
    setDiariesByDate({})
    setDiaryDay(1)
    setDiaryTitle('')
    setDiaryContent('')
    setOpenedDiary(null)
  }

  const flow = useMemo(() => {
    const nodes: Node[] = [{ id: 'root', data: { label: `${goalType}: ${rootGoal || '未设置'}` }, position: { x: 260, y: 20 } }]
    const edges: Edge[] = []

    weekGoals.forEach((w, wi) => {
      const wid = `w-${w.id}`
      nodes.push({ id: wid, data: { label: `周目标: ${w.title}` }, position: { x: wi * 240 + 40, y: 130 } })
      edges.push({ id: `e-root-${wid}`, source: 'root', target: wid })
      w.days.forEach((d, di) => {
        const did = `${wid}-d${d.day}`
        nodes.push({ id: did, data: { label: `第${d.day}天` }, position: { x: wi * 240 + 40, y: 240 + di * 85 } })
        edges.push({ id: `e-${wid}-${did}`, source: wid, target: did })
      })
    })

    return { nodes, edges }
  }, [goalType, rootGoal, weekGoals])

  return (
    <div className={`app ${theme}`}>
      <header>
        <h1>🌈 Plan & Diary</h1>
        <div className="theme-switch">
          <button onClick={() => setTheme('genki')}>元气</button>
          <button onClick={() => setTheme('mint')}>薄荷</button>
          <button onClick={clearAll}>清空数据</button>
        </div>
      </header>

      {page === 'plan' ? (
        <>
          <section className="panel">
            <h2>1) 目标入口</h2>
            <div className="row">
              <select value={goalType} onChange={(e) => setGoalType(e.target.value as GoalType)}>
                <option value="年目标">年目标</option>
                <option value="月目标">月目标</option>
              </select>
              <input value={rootGoal} onChange={(e) => setRootGoal(e.target.value)} placeholder="输入你的目标" />
            </div>
          </section>

          <section className="panel">
            <h2>2) 月/年 → 周目标</h2>
            <div className="row">
              <input value={weekTitle} onChange={(e) => setWeekTitle(e.target.value)} placeholder="新增周目标" />
              <button onClick={addWeek}>添加周目标</button>
            </div>
            <div className="chips">
              {weekGoals.map((w) => (
                <button key={w.id} className={selectedWeekId === w.id ? 'chip active' : 'chip'} onClick={() => setSelectedWeekId(w.id)}>
                  {w.title}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>3) 周 → 日(早中晚)</h2>
            <div className="row">
              <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {weekDates.map((d, i) => (
                  <option key={i + 1} value={i + 1}>{d.getMonth() + 1}月{d.getDate()}日</option>
                ))}
              </select>
              <select value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
                <option>上午</option>
                <option>下午</option>
                <option>晚上</option>
              </select>
              <input value={taskInput} onChange={(e) => setTaskInput(e.target.value)} placeholder="手动添加任务" />
              <button onClick={addTask}>添加任务</button>
            </div>

            <details>
              <summary>🤖 ChatGPT 自动拆解为 7 天（需 OpenAI Key）</summary>
              <div className="row">
                <input value={openAIKey} onChange={(e) => setOpenAIKey(e.target.value)} placeholder="OpenAI API Key" type="password" />
              </div>
              <textarea value={autoPrompt} onChange={(e) => setAutoPrompt(e.target.value)} placeholder="可选：自定义拆解提示词" rows={3} />
              <button onClick={autoGenerateWeek} disabled={loadingAI}>{loadingAI ? '生成中...' : '自动生成7天早中晚'}</button>
            </details>
          </section>

          <section className="panel flow-wrap">
            <h2>目标树可视化（思维导图）</h2>
            <div className="flow">
              <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView>
                <Background />
                <Controls />
                <MiniMap />
              </ReactFlow>
            </div>
          </section>

          <section className="panel page-bottom-pad">
            <h2>一周 To-Do（可打勾/打叉）</h2>
            {!selectedWeek ? (
              <p>请先选择一个周目标</p>
            ) : (
              <div className="week-grid">
                {selectedWeek.days.map((d) => {
                  const actual = weekDates[d.day - 1]
                  const key = dateKey(actual)
                  const dayDiaries = diariesByDate[key] || []
                  return (
                    <div key={d.day} className="day-card">
                      <h3>{actual.getMonth() + 1}月{actual.getDate()}日</h3>
                      {(['上午', '下午', '晚上'] as Slot[]).map((s) => (
                        <div key={s}>
                          <h4>{s}</h4>
                          {d.tasks.filter((t) => t.slot === s).map((t) => (
                            <div className={`task ${t.done ? 'done' : ''} ${t.failed ? 'failed' : ''}`} key={t.id}>
                              <span>{t.text}</span>
                              <div>
                                <button onClick={() => markTask(selectedWeek.id, d.day, t.id, 'done')}>✅</button>
                                <button onClick={() => markTask(selectedWeek.id, d.day, t.id, 'failed')}>❌</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}

                      <div>
                        <h4>日记</h4>
                        <div className="diary-links">
                          {dayDiaries.length === 0 ? (
                            <small>暂无日记</small>
                          ) : (
                            dayDiaries.map((entry) => (
                              <button
                                className="diary-link-btn"
                                key={entry.id}
                                onClick={() => {
                                  setOpenedDiary({ dateLabel: `${actual.getMonth() + 1}月${actual.getDate()}日`, entry })
                                  setPage('diary')
                                }}
                              >
                                {entry.title}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="panel diary-page page-bottom-pad">
          <h2>📔 Diary 页面（独立）</h2>
          <div className="row">
            <select value={diaryDay} onChange={(e) => setDiaryDay(Number(e.target.value))}>
              {weekDates.map((d, i) => (
                <option key={i + 1} value={i + 1}>保存到 {d.getMonth() + 1}月{d.getDate()}日（晚上）</option>
              ))}
            </select>
            <input value={diaryTitle} onChange={(e) => setDiaryTitle(e.target.value)} placeholder="日记标题" />
          </div>
          <textarea value={diaryContent} onChange={(e) => setDiaryContent(e.target.value)} rows={8} placeholder="写今天的日记内容..." />
          <div className="row">
            <button onClick={addDiary}>保存日记</button>
            <button
              onClick={() => {
                setDiaryTitle('')
                setDiaryContent('')
                setOpenedDiary(null)
              }}
            >
              清空编辑
            </button>
          </div>

          {openedDiary && (
            <div className="diary-detail">
              <h3>{openedDiary.entry.title}</h3>
              <small>
                {openedDiary.dateLabel} · {new Date(openedDiary.entry.createdAt).toLocaleString()}
              </small>
              <p>{openedDiary.entry.content}</p>
            </div>
          )}
        </section>
      )}

      <nav className="bottom-nav">
        <button className={page === 'plan' ? 'active' : ''} onClick={() => setPage('plan')}>📋 计划</button>
        <button className={page === 'diary' ? 'active' : ''} onClick={() => setPage('diary')}>📔 日记</button>
      </nav>
    </div>
  )
}

export default App
