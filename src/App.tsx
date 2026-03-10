import { useEffect, useMemo, useState } from 'react'
import './App.css'
import ReactFlow, { Background, Controls, MiniMap, type Edge, type Node } from 'reactflow'
import 'reactflow/dist/style.css'

type Slot = '上午' | '下午' | '晚上'
type DayTask = { id: string; text: string; slot: Slot; done?: boolean; failed?: boolean; selecting?: boolean }
type DiaryEntry = {
  id: string
  title: string
  content: string
  createdAt: number
  images?: string[]
  videos?: string[]
  location?: string
}
type DayPlan = { day: number; tasks: DayTask[] }
type WeekGoal = { id: string; title: string; days: DayPlan[]; startDate: string }
type Theme = 'genki' | 'mint'
type GoalType = '年目标' | '月目标'
type Page = 'plan' | 'diary'
type TodoView = 'week' | 'month'
type DiariesByDate = Record<string, DiaryEntry[]>
type QuadrantKey = 'important_urgent' | 'important_not_urgent' | 'not_important_urgent' | 'not_important_not_urgent'
type QuadrantItem = { id: string; text: string; quadrant: QuadrantKey; createdAt: number }

type PersistedState = {
  theme: Theme
  goalType: GoalType
  rootGoal: string
  weekGoals: WeekGoal[]
  selectedWeekId: string
  openAIKey: string
  diariesByDate: DiariesByDate
  username: string
  quadrantItems: QuadrantItem[]
}

type UserArchive = Record<string, Record<string, PersistedState>>

const STORAGE_KEY = 'plan_and_diary_v1'
const USER_ARCHIVE_KEY = 'plan_and_diary_user_archives_v1'
const DAILY_RESET_KEY = 'plan_and_diary_daily_reset_marker_v1'
const MAX_ARCHIVE_DAYS_PER_USER = 180

const normalizeUsername = (raw: string) => {
  const cleaned = (raw || 'default').trim().toLowerCase().replace(/\s+/g, '_')
  return cleaned || 'default'
}

const pruneArchiveDays = (byDay: Record<string, PersistedState>, maxDays: number) => {
  const keys = Object.keys(byDay).sort((a, b) => parseDateKey(b).getTime() - parseDateKey(a).getTime())
  const keep = new Set(keys.slice(0, maxDays))
  const next: Record<string, PersistedState> = {}
  keys.forEach((k) => {
    if (keep.has(k)) next[k] = byDay[k]
  })
  return next
}

const emptyDays = (): DayPlan[] => Array.from({ length: 7 }, (_, i) => ({ day: i + 1, tasks: [] }))
const uuid = () => Math.random().toString(36).slice(2, 10)
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const normalizeDate = (d: Date) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const parseDateKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return normalizeDate(new Date(y, (m || 1) - 1, d || 1))
}
const buildWeekDates = (startDateKey: string) => {
  const start = parseDateKey(startDateKey)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function App() {
  const [theme, setTheme] = useState<Theme>('genki')
  const [username, setUsername] = useState('default')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [quadrantItems, setQuadrantItems] = useState<QuadrantItem[]>([])
  const [quadrantQuickInput, setQuadrantQuickInput] = useState<Record<QuadrantKey, string>>({
    important_urgent: '',
    important_not_urgent: '',
    not_important_urgent: '',
    not_important_not_urgent: '',
  })
  const [taskScheduleOpenId, setTaskScheduleOpenId] = useState<string | null>(null)
  const [taskScheduleDays, setTaskScheduleDays] = useState<number[]>([])
  const [taskScheduleSlot, setTaskScheduleSlot] = useState<Slot>('上午')
  const [todayMarker, setTodayMarker] = useState(dateKey(normalizeDate(new Date())))
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
  const [todoView, setTodoView] = useState<TodoView>('week')
  const [diariesByDate, setDiariesByDate] = useState<DiariesByDate>({})
  const [diaryDay, setDiaryDay] = useState(1)
  const [diaryTitle, setDiaryTitle] = useState('')
  const [diaryContent, setDiaryContent] = useState('')
  const [diaryExpanded, setDiaryExpanded] = useState(false)
  const [diaryImages, setDiaryImages] = useState<string[]>([])
  const [diaryVideos, setDiaryVideos] = useState<string[]>([])
  const [diaryLocation, setDiaryLocation] = useState('')
  const [diarySearchYear, setDiarySearchYear] = useState('')
  const [diarySearchMonth, setDiarySearchMonth] = useState('')
  const [diarySearchDay, setDiarySearchDay] = useState('')
  const [diarySearchOpen, setDiarySearchOpen] = useState(false)
  const [appliedDiarySearch, setAppliedDiarySearch] = useState({ year: '', month: '', day: '' })
  const [bulkModeWeekId, setBulkModeWeekId] = useState<string | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Record<string, boolean>>({})
  const [undoStack, setUndoStack] = useState<Array<{ weekGoals: WeekGoal[]; diariesByDate: DiariesByDate; quadrantItems: QuadrantItem[]; selectedWeekId: string }>>([])
  const [editingDiaryKey, setEditingDiaryKey] = useState<string | null>(null)
  const [editingDiaryId, setEditingDiaryId] = useState<string | null>(null)
  const [editingDiaryTitle, setEditingDiaryTitle] = useState('')
  const [editingDiaryContent, setEditingDiaryContent] = useState('')

  const fallbackWeekStart = useMemo(() => dateKey(normalizeDate(new Date())), [])

  const selectedWeekDates = useMemo(() => {
    const start = selectedWeek?.startDate || fallbackWeekStart
    return buildWeekDates(start)
  }, [selectedWeek?.startDate, fallbackWeekStart])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nowKey = dateKey(normalizeDate(new Date()))
      setTodayMarker((prev) => (prev === nowKey ? prev : nowKey))
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    try {
      const last = localStorage.getItem(DAILY_RESET_KEY)
      if (last === todayMarker) return

      const idx = selectedWeekDates.findIndex((d) => dateKey(d) === todayMarker)
      const targetDay = idx >= 0 ? idx + 1 : 1

      setTaskInput('')
      setDay(targetDay)
      setSlot('上午')
      setDiaryDay(targetDay)
      setDiaryTitle('')
      setDiaryContent('')
      setDiaryImages([])
      setDiaryVideos([])
      setDiaryLocation('')
      setDiaryExpanded(false)
      setTaskScheduleOpenId(null)
      setTaskScheduleDays([])
      setTaskScheduleSlot('上午')

      localStorage.setItem(DAILY_RESET_KEY, todayMarker)
    } catch (e) {
      console.warn('每日计划重置失败，已忽略。', e)
    }
  }, [todayMarker, selectedWeekDates])

  const monthMatrix = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    const firstDay = new Date(y, m, 1)
    const lastDay = new Date(y, m + 1, 0)
    const leading = firstDay.getDay()
    const total = lastDay.getDate()

    const cells: Array<Date | null> = []
    for (let i = 0; i < leading; i++) cells.push(null)
    for (let d = 1; d <= total; d++) cells.push(new Date(y, m, d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
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
          startDate: typeof w.startDate === 'string' ? w.startDate : dateKey(normalizeDate(new Date())),
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
      if (typeof data.username === 'string' && data.username.trim()) setUsername(data.username)
      if (Array.isArray(data.quadrantItems)) setQuadrantItems(data.quadrantItems)
    } catch (e) {
      console.warn('读取本地数据失败，已忽略。', e)
    }
  }, [])

  useEffect(() => {
    const payload: PersistedState = {
      theme,
      goalType,
      rootGoal,
      weekGoals,
      selectedWeekId,
      openAIKey,
      diariesByDate,
      username,
      quadrantItems,
    }

    setSaveStatus('saving')
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))

        const userKey = normalizeUsername(username)
        const dayKey = dateKey(normalizeDate(new Date()))
        const rawArchive = localStorage.getItem(USER_ARCHIVE_KEY)
        const archive: UserArchive = rawArchive ? JSON.parse(rawArchive) : {}
        const userFolder = archive[userKey] || {}
        const nextUserFolder = pruneArchiveDays({ ...userFolder, [dayKey]: payload }, MAX_ARCHIVE_DAYS_PER_USER)
        archive[userKey] = nextUserFolder
        localStorage.setItem(USER_ARCHIVE_KEY, JSON.stringify(archive))
        setSaveStatus('saved')
        setLastSavedAt(Date.now())
      } catch (e) {
        setSaveStatus('error')
        console.warn('自动保存失败，已忽略。', e)
      }
    }, 400)

    return () => window.clearTimeout(timer)
  }, [theme, goalType, rootGoal, weekGoals, selectedWeekId, openAIKey, diariesByDate, username, quadrantItems])

  useEffect(() => {
    const saveNow = () => {
      try {
        setSaveStatus('saving')
        const payload: PersistedState = {
          theme,
          goalType,
          rootGoal,
          weekGoals,
          selectedWeekId,
          openAIKey,
          diariesByDate,
          username,
          quadrantItems,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))

        const userKey = normalizeUsername(username)
        const dayKey = dateKey(normalizeDate(new Date()))
        const rawArchive = localStorage.getItem(USER_ARCHIVE_KEY)
        const archive: UserArchive = rawArchive ? JSON.parse(rawArchive) : {}
        const userFolder = archive[userKey] || {}
        archive[userKey] = pruneArchiveDays({ ...userFolder, [dayKey]: payload }, MAX_ARCHIVE_DAYS_PER_USER)
        localStorage.setItem(USER_ARCHIVE_KEY, JSON.stringify(archive))
        setSaveStatus('saved')
        setLastSavedAt(Date.now())
      } catch (e) {
        setSaveStatus('error')
        console.warn('页面隐藏时保存失败，已忽略。', e)
      }
    }

    const onHiddenSave = () => {
      if (document.visibilityState === 'hidden') saveNow()
    }

    document.addEventListener('visibilitychange', onHiddenSave)
    window.addEventListener('beforeunload', saveNow)
    return () => {
      document.removeEventListener('visibilitychange', onHiddenSave)
      window.removeEventListener('beforeunload', saveNow)
    }
  }, [theme, goalType, rootGoal, weekGoals, selectedWeekId, openAIKey, diariesByDate, username, quadrantItems])

  useEffect(() => {
    setBulkModeWeekId(null)
    setBulkSelected({})
  }, [selectedWeekId])

  useEffect(() => {
    setAppliedDiarySearch({ year: diarySearchYear, month: diarySearchMonth, day: diarySearchDay })
  }, [diarySearchYear, diarySearchMonth, diarySearchDay])

  const pushUndoSnapshot = () => {
    setUndoStack((prev) => [
      ...prev.slice(-29),
      {
        weekGoals: JSON.parse(JSON.stringify(weekGoals)),
        diariesByDate: JSON.parse(JSON.stringify(diariesByDate)),
        quadrantItems: JSON.parse(JSON.stringify(quadrantItems)),
        selectedWeekId,
      },
    ])
  }

  const undoLastAction = () => {
    setUndoStack((prev) => {
      const last = prev[prev.length - 1]
      if (!last) return prev
      setWeekGoals(last.weekGoals)
      setDiariesByDate(last.diariesByDate)
      setQuadrantItems(last.quadrantItems)
      setSelectedWeekId(last.selectedWeekId)
      return prev.slice(0, -1)
    })
  }

  const addWeek = () => {
    if (!weekTitle.trim()) return
    pushUndoSnapshot()
    const w: WeekGoal = { id: uuid(), title: weekTitle.trim(), days: emptyDays(), startDate: dateKey(normalizeDate(new Date())) }
    setWeekGoals((prev) => [...prev, w])
    setSelectedWeekId(w.id)
    setWeekTitle('')
  }

  const addTask = () => {
    if (!selectedWeek || !taskInput.trim()) return
    pushUndoSnapshot()
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

  const addQuadrantItemInCell = (quadrant: QuadrantKey) => {
    const text = (quadrantQuickInput[quadrant] || '').trim()
    if (!text) return
    pushUndoSnapshot()
    setQuadrantItems((prev) => [{ id: uuid(), text, quadrant, createdAt: Date.now() }, ...prev])
    setQuadrantQuickInput((prev) => ({ ...prev, [quadrant]: '' }))
  }

  const openTaskSchedule = (itemId: string) => {
    setTaskScheduleOpenId(itemId)
    setTaskScheduleDays([])
    setTaskScheduleSlot('上午')
  }

  const toggleTaskScheduleDay = (dayNum: number) => {
    setTaskScheduleDays((prev) => (prev.includes(dayNum) ? prev.filter((x) => x !== dayNum) : [...prev, dayNum].sort((a, b) => a - b)))
  }

  const applyTaskScheduleToWeek = (item: QuadrantItem) => {
    if (!selectedWeek) {
      alert('请先选择周目标')
      return
    }
    if (!taskScheduleDays.length) {
      alert('请至少选择一个日期')
      return
    }
    pushUndoSnapshot()
    setWeekGoals((prev) =>
      prev.map((w) => {
        if (w.id !== selectedWeek.id) return w
        return {
          ...w,
          days: w.days.map((d) => {
            if (!taskScheduleDays.includes(d.day)) return d
            return { ...d, tasks: [...d.tasks, { id: uuid(), text: `[四象限] ${item.text}`, slot: taskScheduleSlot }] }
          }),
        }
      }),
    )
    setTaskScheduleOpenId(null)
    setTaskScheduleDays([])
  }

  const filesToDataUrls = async (files: FileList | null) => {
    if (!files) return [] as string[]
    const arr = Array.from(files)
    const urls = await Promise.all(
      arr.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result || ''))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(f)
          }),
      ),
    )
    return urls.filter(Boolean)
  }

  const onPickImages = async (files: FileList | null) => {
    const urls = await filesToDataUrls(files)
    if (urls.length) setDiaryImages((prev) => [...prev, ...urls])
  }

  const onPickVideos = async (files: FileList | null) => {
    const urls = await filesToDataUrls(files)
    if (urls.length) setDiaryVideos((prev) => [...prev, ...urls])
  }

  const onPickLocation = () => {
    if (!navigator.geolocation) {
      alert('当前浏览器不支持定位')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDiaryLocation(`纬度 ${pos.coords.latitude.toFixed(5)}, 经度 ${pos.coords.longitude.toFixed(5)}`)
      },
      () => alert('定位失败，请检查权限'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  const deleteDiary = (dateStorageKey: string, diaryId: string) => {
    pushUndoSnapshot()
    setDiariesByDate((prev) => {
      const list = prev[dateStorageKey] || []
      const next = list.filter((x) => x.id !== diaryId)
      const cloned = { ...prev }
      if (next.length === 0) delete cloned[dateStorageKey]
      else cloned[dateStorageKey] = next
      return cloned
    })
  }

  const startEditDiary = (dateStorageKey: string, entry: DiaryEntry) => {
    setEditingDiaryKey(dateStorageKey)
    setEditingDiaryId(entry.id)
    setEditingDiaryTitle(entry.title)
    setEditingDiaryContent(entry.content)
  }

  const saveEditDiary = () => {
    if (!editingDiaryKey || !editingDiaryId) return
    pushUndoSnapshot()
    setDiariesByDate((prev) => ({
      ...prev,
      [editingDiaryKey]: (prev[editingDiaryKey] || []).map((x) =>
        x.id !== editingDiaryId ? x : { ...x, title: editingDiaryTitle.trim() || x.title, content: editingDiaryContent.trim() || x.content },
      ),
    }))
    setEditingDiaryKey(null)
    setEditingDiaryId(null)
    setEditingDiaryTitle('')
    setEditingDiaryContent('')
  }

  const cancelEditDiary = () => {
    setEditingDiaryKey(null)
    setEditingDiaryId(null)
    setEditingDiaryTitle('')
    setEditingDiaryContent('')
  }

  const addDiary = () => {
    if (!diaryContent.trim()) return
    pushUndoSnapshot()
    const targetDate = selectedWeekDates[diaryDay - 1]
    const key = dateKey(targetDate)
    const autoTitle = diaryContent.trim().slice(0, 14) + (diaryContent.trim().length > 14 ? '...' : '')
    const entry: DiaryEntry = {
      id: uuid(),
      title: diaryTitle.trim() || autoTitle,
      content: diaryContent.trim(),
      createdAt: Date.now(),
      images: diaryImages,
      videos: diaryVideos,
      location: diaryLocation,
    }
    setDiariesByDate((prev) => ({ ...prev, [key]: [entry, ...(prev[key] || [])] }))
    setDiaryTitle('')
    setDiaryContent('')
    setDiaryImages([])
    setDiaryVideos([])
    setDiaryLocation('')
    setDiaryExpanded(false)
  }

  const markTask = (weekId: string, dayNum: number, taskId: string, mode: 'done' | 'failed') => {
    pushUndoSnapshot()
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
                    t.id !== taskId ? t : { ...t, done: mode === 'done', failed: mode === 'failed', selecting: false },
                  ),
                },
          ),
        }
      }),
    )
  }

  const startBulkSelect = (weekId: string, dayNum: number, taskId: string) => {
    setBulkModeWeekId(weekId)
    setBulkSelected({ [`${dayNum}-${taskId}`]: true })
    setWeekGoals((prev) =>
      prev.map((w) => ({
        ...w,
        days: w.days.map((d) => ({ ...d, tasks: d.tasks.map((t) => ({ ...t, selecting: false })) })),
      })),
    )
  }

  const toggleBulkTask = (dayNum: number, taskId: string) => {
    const key = `${dayNum}-${taskId}`
    setBulkSelected((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const applyBulkStatus = (mode: 'done' | 'failed') => {
    if (!bulkModeWeekId) return
    pushUndoSnapshot()
    setWeekGoals((prev) =>
      prev.map((w) => {
        if (w.id !== bulkModeWeekId) return w
        return {
          ...w,
          days: w.days.map((d) => ({
            ...d,
            tasks: d.tasks.map((t) => {
              const key = `${d.day}-${t.id}`
              if (!bulkSelected[key]) return t
              return { ...t, done: mode === 'done', failed: mode === 'failed', selecting: false }
            }),
          })),
        }
      }),
    )
    setBulkSelected({})
    setBulkModeWeekId(null)
  }

  const applyBulkDelete = () => {
    if (!bulkModeWeekId) return
    pushUndoSnapshot()
    setWeekGoals((prev) =>
      prev.map((w) => {
        if (w.id !== bulkModeWeekId) return w
        return {
          ...w,
          days: w.days.map((d) => ({
            ...d,
            tasks: d.tasks.filter((t) => !bulkSelected[`${d.day}-${t.id}`]),
          })),
        }
      }),
    )
    setBulkSelected({})
    setBulkModeWeekId(null)
  }

  const applyBulkEdit = () => {
    if (!bulkModeWeekId) return
    const nextText = prompt('批量编辑：输入新的任务内容')?.trim()
    if (!nextText) return
    pushUndoSnapshot()
    setWeekGoals((prev) =>
      prev.map((w) => {
        if (w.id !== bulkModeWeekId) return w
        return {
          ...w,
          days: w.days.map((d) => ({
            ...d,
            tasks: d.tasks.map((t) => (bulkSelected[`${d.day}-${t.id}`] ? { ...t, text: nextText } : t)),
          })),
        }
      }),
    )
    setBulkSelected({})
    setBulkModeWeekId(null)
  }

  const cancelBulk = () => {
    setBulkSelected({})
    setBulkModeWeekId(null)
  }

  const toggleTaskSelecting = (weekId: string, dayNum: number, taskId: string) => {
    setWeekGoals((prev) => {
      const current = prev
        .find((w) => w.id === weekId)
        ?.days.find((d) => d.day === dayNum)
        ?.tasks.find((t) => t.id === taskId)
      const shouldOpen = !current?.selecting

      return prev.map((w) => {
        if (w.id !== weekId) {
          return {
            ...w,
            days: w.days.map((d) => ({ ...d, tasks: d.tasks.map((t) => ({ ...t, selecting: false })) })),
          }
        }

        return {
          ...w,
          days: w.days.map((d) => ({
            ...d,
            tasks: d.tasks.map((t) => {
              if (d.day === dayNum && t.id === taskId) return { ...t, selecting: shouldOpen }
              return { ...t, selecting: false }
            }),
          })),
        }
      })
    })
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
    pushUndoSnapshot()
    localStorage.removeItem(STORAGE_KEY)
    setTheme('genki')
    setUsername('default')
    setGoalType('月目标')
    setRootGoal('')
    setWeekGoals([])
    setSelectedWeekId('')
    setWeekTitle('')
    setTaskInput('')
    setOpenAIKey('')
    setAutoPrompt('')
    setQuadrantItems([])
    setTaskScheduleOpenId(null)
    setTaskScheduleDays([])
    setPage('plan')
    setDiariesByDate({})
    setDiaryDay(1)
    setDiaryTitle('')
    setDiaryContent('')
  }

  const weekDayNumberByDateKey = useMemo(() => {
    const map: Record<string, number> = {}
    selectedWeekDates.forEach((d, idx) => {
      map[dateKey(d)] = idx + 1
    })
    return map
  }, [selectedWeekDates])

  const diaryHistory = useMemo(() => {
    const all: Array<{ date: Date; dateLabel: string; key: string; entry: DiaryEntry }> = []
    Object.entries(diariesByDate).forEach(([key, entries]) => {
      const [y, m, d] = key.split('-').map(Number)
      const dt = new Date(y, (m || 1) - 1, d || 1)
      entries.forEach((entry) => {
        all.push({ date: dt, dateLabel: `${m}月${d}日`, key, entry })
      })
    })

    const y = appliedDiarySearch.year.trim()
    const m = appliedDiarySearch.month.trim()
    const d = appliedDiarySearch.day.trim()

    const filtered = all.filter((item) => {
      const year = String(item.date.getFullYear())
      const month = String(item.date.getMonth() + 1)
      const day = String(item.date.getDate())
      if (y && year !== y) return false
      if (m && month !== String(Number(m))) return false
      if (d && day !== String(Number(d))) return false
      return true
    })

    return filtered.sort((a, b) => b.entry.createdAt - a.entry.createdAt)
  }, [diariesByDate, appliedDiarySearch])

  const quadrantLabel: Record<QuadrantKey, string> = {
    important_urgent: '重要且紧急',
    important_not_urgent: '重要不紧急',
    not_important_urgent: '不重要但紧急',
    not_important_not_urgent: '不重要不紧急',
  }

  const groupedQuadrants = useMemo(() => {
    return {
      important_urgent: quadrantItems.filter((x) => x.quadrant === 'important_urgent'),
      important_not_urgent: quadrantItems.filter((x) => x.quadrant === 'important_not_urgent'),
      not_important_urgent: quadrantItems.filter((x) => x.quadrant === 'not_important_urgent'),
      not_important_not_urgent: quadrantItems.filter((x) => x.quadrant === 'not_important_not_urgent'),
    }
  }, [quadrantItems])

  const saveHint = useMemo(() => {
    if (saveStatus === 'saving') return '💾 保存中...'
    if (saveStatus === 'error') return '⚠️ 保存失败（本地存储异常）'
    if (saveStatus === 'saved') {
      return lastSavedAt ? `✅ 已保存 ${new Date(lastSavedAt).toLocaleTimeString()}` : '✅ 已保存'
    }
    return '📝 待保存'
  }, [saveStatus, lastSavedAt])

  const flow = useMemo(() => {
    const nodes: Node[] = [{ id: 'root', data: { label: '周目标总览' }, position: { x: 260, y: 20 } }]
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
          <span style={{ marginRight: 8, fontSize: 12, opacity: 0.85 }}>{saveHint}</span>
          <button onClick={undoLastAction} disabled={undoStack.length === 0}>↶ 撤回</button>
          <button onClick={() => setTheme('genki')}>元气</button>
          <button onClick={() => setTheme('mint')}>薄荷</button>
          <button onClick={clearAll}>清空数据</button>
        </div>
      </header>

      {page === 'plan' ? (
        <>
          <section className="panel">
            <h2>1) 周目标 ↔ 日目标（合并交互）</h2>
            <div className="row compact-controls">
              <input className="span-2" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名（用于自动分文件夹归档）" />
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

            <div className="row compact-controls" style={{ marginTop: 8 }}>
              <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {selectedWeekDates.map((d, i) => (
                  <option key={i + 1} value={i + 1}>{d.getMonth() + 1}月{d.getDate()}日</option>
                ))}
              </select>
              <select value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
                <option>上午</option>
                <option>下午</option>
                <option>晚上</option>
              </select>
              <input className="span-2" value={taskInput} onChange={(e) => setTaskInput(e.target.value)} placeholder="手动添加任务（回车后点添加）" />
              <button className="span-2" onClick={addTask}>添加到当日</button>
            </div>

            <div className="chips quick-actions" style={{ marginTop: 6 }}>
              <button className="chip" onClick={() => setTaskInput('复盘昨天完成情况')}>+ 复盘</button>
              <button className="chip" onClick={() => setTaskInput('处理最重要的一件事')}>+ MIT</button>
              <button className="chip" onClick={() => setTaskInput('整理收件箱与待办')}>+ 清空待办</button>
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

          <section className="panel">
            <details>
              <summary>3) 计划四象限（艾森豪威尔）</summary>
              <div className="matrix-wrap" style={{ marginTop: 8 }}>
                <div className="matrix-y-axis">重要性 ↑</div>
                <div className="matrix-grid">
                  {([
                    'important_not_urgent',
                    'important_urgent',
                    'not_important_not_urgent',
                    'not_important_urgent',
                  ] as QuadrantKey[]).map((key) => (
                    <div key={key} className="matrix-cell">
                      <h4>{quadrantLabel[key]}</h4>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <input
                          value={quadrantQuickInput[key]}
                          onChange={(e) => setQuadrantQuickInput((prev) => ({ ...prev, [key]: e.target.value }))}
                          placeholder="输入任务"
                        />
                        <button onClick={() => addQuadrantItemInCell(key)}>＋</button>
                      </div>

                      {(groupedQuadrants[key] || []).length === 0 ? (
                        <small className="muted">暂无</small>
                      ) : (
                        (groupedQuadrants[key] || []).map((item) => (
                          <div key={item.id} className="mini-task" style={{ display: 'block', whiteSpace: 'normal', marginTop: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                              <span>{item.text}</span>
                              <button className="schedule-box-btn" onClick={() => openTaskSchedule(item.id)}>▾</button>
                            </div>

                            {taskScheduleOpenId === item.id && (
                              <div style={{ marginTop: 6 }}>
                                <div className="chips">
                                  {selectedWeekDates.map((d, i) => (
                                    <button
                                      key={`q-day-${item.id}-${i + 1}`}
                                      className={taskScheduleDays.includes(i + 1) ? 'chip active' : 'chip'}
                                      onClick={() => toggleTaskScheduleDay(i + 1)}
                                    >
                                      {d.getMonth() + 1}/{d.getDate()}
                                    </button>
                                  ))}
                                </div>
                                <div className="row" style={{ marginTop: 6 }}>
                                  <select value={taskScheduleSlot} onChange={(e) => setTaskScheduleSlot(e.target.value as Slot)}>
                                    <option>上午</option>
                                    <option>下午</option>
                                    <option>晚上</option>
                                  </select>
                                  <button onClick={() => applyTaskScheduleToWeek(item)}>添加到周计划</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
                <div className="matrix-x-axis">紧急性 →</div>
              </div>

            </details>
          </section>

          <section className="panel flow-wrap">
            <details>
              <summary>目标树可视化（思维导图）</summary>
              <div className="flow" style={{ marginTop: 8 }}>
                <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView>
                  <Background />
                  <Controls />
                  <MiniMap />
                </ReactFlow>
              </div>
            </details>
          </section>

          <section className="panel page-bottom-pad">
            <details>
              <summary>执行看板（周视图 / 月视图）</summary>
              <div className="todo-head" style={{ marginTop: 8 }}>
                <h2>{todoView === 'week' ? '一周 To-Do（可打勾/打叉）' : '一月视图（与周视图数据联动）'}</h2>
                <div className="view-toggle">
                  <button className={todoView === 'week' ? 'active' : ''} onClick={() => setTodoView('week')}>周视图</button>
                  <button className={todoView === 'month' ? 'active' : ''} onClick={() => setTodoView('month')}>月视图</button>
                </div>
              </div>
              {!selectedWeek ? (
                <p>请先选择一个周目标</p>
              ) : (
                <>
                {bulkModeWeekId === selectedWeek.id && (
                  <div className="bulk-bar">
                    <span>多选模式（已选 {Object.values(bulkSelected).filter(Boolean).length} 项）</span>
                    <div>
                      <button onClick={() => applyBulkStatus('done')}>批量✅</button>
                      <button onClick={() => applyBulkStatus('failed')}>批量❌</button>
                      <button onClick={applyBulkEdit}>编辑</button>
                      <button onClick={applyBulkDelete}>删除</button>
                      <button onClick={cancelBulk}>退出</button>
                    </div>
                  </div>
                )}

                {todoView === 'week' ? (
                  <div className="week-grid">
                    {selectedWeek.days.map((d) => {
                      const actual = selectedWeekDates[d.day - 1]
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
                                  <div className="task-status">
                                    {bulkModeWeekId === selectedWeek.id ? (
                                      <button className="status-box-btn" onClick={() => toggleBulkTask(d.day, t.id)}>
                                        {bulkSelected[`${d.day}-${t.id}`] ? '☑️' : '☐'}
                                      </button>
                                    ) : (
                                      <>
                                        <button className="status-box-btn" onClick={() => toggleTaskSelecting(selectedWeek.id, d.day, t.id)}>
                                          {t.done ? '✅' : t.failed ? '❌' : '□'}
                                        </button>
                                        {t.selecting && (
                                          <div className="status-pop">
                                            <button className="status-choice" onClick={() => markTask(selectedWeek.id, d.day, t.id, 'done')}>
                                              ✅
                                            </button>
                                            <button className="status-choice" onClick={() => markTask(selectedWeek.id, d.day, t.id, 'failed')}>
                                              ❌
                                            </button>
                                            <button className="status-choice text" onClick={() => startBulkSelect(selectedWeek.id, d.day, t.id)}>
                                              多选
                                            </button>
                                          </div>
                                        )}
                                      </>
                                    )}
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
                ) : (
                  <div className="month-grid">
                    {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
                      <div key={w} className="month-weekday">周{w}</div>
                    ))}
                    {monthMatrix.map((dt, idx) => {
                      if (!dt) return <div key={`empty-${idx}`} className="month-cell empty" />
                      const key = dateKey(dt)
                      const dayNo = weekDayNumberByDateKey[key]
                      const dayPlan = dayNo ? selectedWeek.days.find((x) => x.day === dayNo) : undefined
                      const dayDiaries = diariesByDate[key] || []

                      return (
                        <div key={key} className="month-cell">
                          <h4>{dt.getMonth() + 1}月{dt.getDate()}日</h4>
                          {(['上午', '下午', '晚上'] as Slot[]).map((s) => (
                            <div key={s} className="mini-block">
                              <small>{s}</small>
                              {(dayPlan?.tasks || [])
                                .filter((t) => t.slot === s)
                                .slice(0, 2)
                                .map((t) => (
                                  <div key={t.id} className={`mini-task ${t.done ? 'done' : ''} ${t.failed ? 'failed' : ''}`}>
                                    <span>{t.done ? '✅' : t.failed ? '❌' : '□'}</span> {t.text}
                                  </div>
                                ))}
                            </div>
                          ))}
                          <div className="mini-block">
                            <small>日记</small>
                            {dayDiaries.slice(0, 2).map((entry) => (
                              <button
                                className="diary-link-btn"
                                key={entry.id}
                                onClick={() => {
                                  setPage('diary')
                                }}
                              >
                                {entry.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
            </details>
          </section>
        </>
      ) : (
        <section className="panel diary-page page-bottom-pad">
          <div className="diary-page-head">
            <h2>icity · 我的日记</h2>
            <button className="search-toggle-btn" onClick={() => setDiarySearchOpen((v) => !v)}>🔍</button>
          </div>

          <div className="compose-card" onClick={() => setDiaryExpanded(true)}>
            <div className="compose-top">
              <div className="avatar-dot">🍩</div>
              <div className="compose-title">写点什么吧</div>
            </div>

            {diaryExpanded && (
              <>
                <select value={diaryDay} onChange={(e) => setDiaryDay(Number(e.target.value))}>
                  {selectedWeekDates.map((d, i) => (
                    <option key={i + 1} value={i + 1}>保存到 {d.getMonth() + 1}月{d.getDate()}日（晚上）</option>
                  ))}
                </select>
                <input value={diaryTitle} onChange={(e) => setDiaryTitle(e.target.value)} placeholder="标题（可选）" />
                <textarea
                  value={diaryContent}
                  onChange={(e) => setDiaryContent(e.target.value)}
                  rows={8}
                  placeholder="写点什么吧"
                />

                {(diaryImages.length > 0 || diaryVideos.length > 0 || diaryLocation) && (
                  <div className="compose-preview">
                    {diaryLocation && <small>📍 {diaryLocation}</small>}
                    {diaryImages.length > 0 && <small>🖼️ 已选图片 {diaryImages.length} 张</small>}
                    {diaryVideos.length > 0 && <small>🎬 已选视频 {diaryVideos.length} 个</small>}
                  </div>
                )}

                <div className="compose-toolbar">
                  <label className="tool-btn">📷
                    <input type="file" accept="image/*" multiple hidden onChange={(e) => onPickImages(e.target.files)} />
                  </label>
                  <label className="tool-btn">🎞️
                    <input type="file" accept="video/*" multiple hidden onChange={(e) => onPickVideos(e.target.files)} />
                  </label>
                  <button className="tool-btn" onClick={(e) => { e.stopPropagation(); onPickLocation() }}>📍</button>
                </div>

                <div className="compose-actions">
                  <span className="muted">🔒 私密</span>
                  <div className="row">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDiaryTitle('')
                        setDiaryContent('')
                        setDiaryImages([])
                        setDiaryVideos([])
                        setDiaryLocation('')
                        setDiaryExpanded(false)
                      }}
                    >
                      取消
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); addDiary() }}>发送</button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="diary-search">
            <div className="diary-search-head">
              <h3>历史日记</h3>
            </div>

            {diarySearchOpen && (
              <div className="search-mini-box">
                <div className="row">
                  <input value={diarySearchYear} onChange={(e) => setDiarySearchYear(e.target.value)} placeholder="年，如 2026" />
                  <input value={diarySearchMonth} onChange={(e) => setDiarySearchMonth(e.target.value)} placeholder="月，如 3" />
                  <input value={diarySearchDay} onChange={(e) => setDiarySearchDay(e.target.value)} placeholder="日，如 4" />
                </div>
                <div className="row">
                  <button onClick={() => setAppliedDiarySearch({ year: diarySearchYear, month: diarySearchMonth, day: diarySearchDay })}>应用搜索</button>
                  <button
                    onClick={() => {
                      setDiarySearchYear('')
                      setDiarySearchMonth('')
                      setDiarySearchDay('')
                      setAppliedDiarySearch({ year: '', month: '', day: '' })
                    }}
                  >
                    清空
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="diary-history-list">
            {diaryHistory.length === 0 ? (
              <p className="muted">没有匹配到记录</p>
            ) : (
              diaryHistory.map((item) => {
                const isEditing = editingDiaryKey === item.key && editingDiaryId === item.entry.id
                return (
                  <div className="diary-detail" key={`${item.key}-${item.entry.id}`}>
                    <div className="diary-item-head">
                      <h3>{item.entry.title}</h3>
                      <div className="row">
                        <button className="edit-btn" onClick={() => startEditDiary(item.key, item.entry)}>编辑</button>
                        <button className="delete-btn" onClick={() => deleteDiary(item.key, item.entry.id)}>删除</button>
                      </div>
                    </div>
                    <small>
                      {item.dateLabel} · {new Date(item.entry.createdAt).toLocaleString()}
                    </small>

                    {isEditing ? (
                      <div className="edit-box">
                        <input value={editingDiaryTitle} onChange={(e) => setEditingDiaryTitle(e.target.value)} placeholder="标题" />
                        <textarea value={editingDiaryContent} onChange={(e) => setEditingDiaryContent(e.target.value)} rows={4} />
                        <div className="row">
                          <button onClick={saveEditDiary}>保存</button>
                          <button onClick={cancelEditDiary}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {item.entry.location && <div className="muted">📍 {item.entry.location}</div>}
                        <p>{item.entry.content}</p>
                        {!!item.entry.images?.length && (
                          <div className="media-grid">
                            {item.entry.images.map((src, idx) => (
                              <img key={idx} src={src} alt="diary" />
                            ))}
                          </div>
                        )}
                        {!!item.entry.videos?.length && (
                          <div className="media-grid">
                            {item.entry.videos.map((src, idx) => (
                              <video key={idx} src={src} controls />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>

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
