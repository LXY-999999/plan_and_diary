import { useEffect, useMemo, useState } from 'react'
import './App.css'
import ReactFlow, { Background, MiniMap, type Edge, type Node } from 'reactflow'
import 'reactflow/dist/style.css'
import * as XLSX from 'xlsx'

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
type GoalLayer = '总目标' | '年目标' | '月目标' | '周目标'
type PlanTreeNode = { id: string; label: string; goalLayer: GoalLayer; quadrant?: QuadrantKey; leftId?: string; rightId?: string }
type Theme = 'genki' | 'mint'
type GoalType = '年目标' | '月目标'
type Page = 'plan' | 'diary'
type TodoView = 'week' | 'month'
type DiariesByDate = Record<string, DiaryEntry[]>
type QuadrantKey = 'important_urgent' | 'important_not_urgent' | 'not_important_urgent' | 'not_important_not_urgent'
type QuadrantItem = { id: string; text: string; quadrant: QuadrantKey; createdAt: number; sourceNodeId?: string }

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
  planTreeNodes?: PlanTreeNode[]
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

const defaultPlanTree = (): PlanTreeNode[] => [{ id: 'root', label: '总目标', goalLayer: '总目标' }]

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
  const [quadrantComposerOpen, setQuadrantComposerOpen] = useState<Record<QuadrantKey, boolean>>({
    important_urgent: false,
    important_not_urgent: false,
    not_important_urgent: false,
    not_important_not_urgent: false,
  })
  const [taskScheduleOpenId, setTaskScheduleOpenId] = useState<string | null>(null)
  const [taskScheduleDays, setTaskScheduleDays] = useState<number[]>([])
  const [taskScheduleSlot, setTaskScheduleSlot] = useState<Slot>('上午')
  const [draggingQuadrantItemId, setDraggingQuadrantItemId] = useState<string | null>(null)
  const [todayMarker, setTodayMarker] = useState(dateKey(normalizeDate(new Date())))
  const [goalType, setGoalType] = useState<GoalType>('月目标')
  const [rootGoal, setRootGoal] = useState('')
  const [weekGoals, setWeekGoals] = useState<WeekGoal[]>([])
  const [planTreeNodes, setPlanTreeNodes] = useState<PlanTreeNode[]>(defaultPlanTree())

  const [selectedWeekId, setSelectedWeekId] = useState<string>('')
  const selectedWeek = weekGoals.find((w) => w.id === selectedWeekId)

  const [openAIKey, setOpenAIKey] = useState('')

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
  const [draggingWeekTask, setDraggingWeekTask] = useState<{ day: number; taskId: string } | null>(null)
  const [weekDropTarget, setWeekDropTarget] = useState<{ day: number; slot: Slot } | null>(null)
  const [undoStack, setUndoStack] = useState<Array<{ weekGoals: WeekGoal[]; diariesByDate: DiariesByDate; quadrantItems: QuadrantItem[]; planTreeNodes: PlanTreeNode[]; selectedWeekId: string }>>([])
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
      if (Array.isArray(data.planTreeNodes) && data.planTreeNodes.length) {
        setPlanTreeNodes(
          data.planTreeNodes.map((n: any, idx: number) => ({
            ...n,
            label: n?.label || (n?.id === 'root' || idx === 0 ? '总目标' : '新节点'),
            goalLayer: (n?.id === 'root' || idx === 0) ? '总目标' : ((n?.goalLayer as GoalLayer) || '周目标'),
          })),
        )
      }
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
      planTreeNodes,
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
  }, [theme, goalType, rootGoal, weekGoals, selectedWeekId, openAIKey, diariesByDate, username, quadrantItems, planTreeNodes])

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
          planTreeNodes,
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
  }, [theme, goalType, rootGoal, weekGoals, selectedWeekId, openAIKey, diariesByDate, username, quadrantItems, planTreeNodes])

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
        planTreeNodes: JSON.parse(JSON.stringify(planTreeNodes)),
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
      setPlanTreeNodes(last.planTreeNodes)
      setSelectedWeekId(last.selectedWeekId)
      return prev.slice(0, -1)
    })
  }

  const addQuadrantItemInCell = (quadrant: QuadrantKey) => {
    const text = (quadrantQuickInput[quadrant] || '').trim()
    if (!text) return
    pushUndoSnapshot()
    setQuadrantItems((prev) => [{ id: uuid(), text, quadrant, createdAt: Date.now() }, ...prev])
    setQuadrantQuickInput((prev) => ({ ...prev, [quadrant]: '' }))
  }

  const toggleQuadrantComposer = (quadrant: QuadrantKey) => {
    setQuadrantComposerOpen((prev) => ({ ...prev, [quadrant]: !prev[quadrant] }))
  }

  const openTaskSchedule = (itemId: string) => {
    setTaskScheduleOpenId((prev) => {
      if (prev === itemId) {
        setTaskScheduleDays([])
        return null
      }
      setTaskScheduleDays([])
      setTaskScheduleSlot('上午')
      return itemId
    })
  }

  const toggleTaskScheduleDay = (dayNum: number) => {
    setTaskScheduleDays((prev) => (prev.includes(dayNum) ? prev.filter((x) => x !== dayNum) : [...prev, dayNum].sort((a, b) => a - b)))
  }

  const moveQuadrantItem = (itemId: string, targetQuadrant: QuadrantKey) => {
    pushUndoSnapshot()
    setQuadrantItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, quadrant: targetQuadrant } : x)))
  }

  const deleteQuadrantItem = (itemId: string) => {
    pushUndoSnapshot()
    setQuadrantItems((prev) => prev.filter((x) => x.id !== itemId))
    if (taskScheduleOpenId === itemId) setTaskScheduleOpenId(null)
  }

  const onQuadrantItemDragStart = (itemId: string, event: any) => {
    setDraggingQuadrantItemId(itemId)
    event.dataTransfer.setData('text/plain', itemId)
    event.dataTransfer.effectAllowed = 'move'
  }

  const onQuadrantItemDragEnd = () => {
    setDraggingQuadrantItemId(null)
  }

  const onQuadrantCellDrop = (targetQuadrant: QuadrantKey, event: any) => {
    event.preventDefault()
    const itemId = event.dataTransfer.getData('text/plain') || draggingQuadrantItemId
    if (!itemId) return
    moveQuadrantItem(itemId, targetQuadrant)
    setDraggingQuadrantItemId(null)
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
            return {
              ...d,
              tasks: [...d.tasks, { id: uuid(), text: `${quadrantEmoji[item.quadrant]} ${item.text}`, slot: taskScheduleSlot }],
            }
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

  const moveWeekTask = (sourceDay: number, taskId: string, targetDay: number, targetSlot: Slot) => {
    if (!selectedWeek) return
    if (sourceDay === targetDay) {
      const sourceTask = selectedWeek.days.find((d) => d.day === sourceDay)?.tasks.find((t) => t.id === taskId)
      if (sourceTask?.slot === targetSlot) return
    }
    pushUndoSnapshot()
    setWeekGoals((prev) =>
      prev.map((w) => {
        if (w.id !== selectedWeek.id) return w
        let moved: DayTask | null = null
        const daysWithout = w.days.map((d) => {
          if (d.day !== sourceDay) return d
          const left = d.tasks.filter((t) => {
            if (t.id === taskId) {
              moved = { ...t, slot: targetSlot }
              return false
            }
            return true
          })
          return { ...d, tasks: left }
        })
        if (!moved) return w
        return {
          ...w,
          days: daysWithout.map((d) => (d.day === targetDay ? { ...d, tasks: [...d.tasks, moved!] } : d)),
        }
      }),
    )
  }

  const resolveTouchSlotTarget = (touch: any): { day: number; slot: Slot } | null => {
    const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
    const slotEl = el?.closest?.('[data-week-slot]') as HTMLElement | null
    if (!slotEl) return null
    const day = Number(slotEl.dataset.day || '')
    const slot = (slotEl.dataset.slot || '') as Slot
    if (!day || !slot) return null
    return { day, slot }
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

  const clearPlanData = () => {
    if (!confirm('确认仅清空【计划模块】数据吗？')) return
    pushUndoSnapshot()
    setGoalType('月目标')
    setRootGoal('')
    setWeekGoals([])
    setSelectedWeekId('')
    setOpenAIKey('')
    setQuadrantItems([])
    setPlanTreeNodes(defaultPlanTree())
    setTaskScheduleOpenId(null)
    setTaskScheduleDays([])
    setTaskScheduleSlot('上午')
  }

  const clearDiaryData = () => {
    if (!confirm('确认仅清空【日记模块】数据吗？')) return
    pushUndoSnapshot()
    setDiariesByDate({})
    setDiaryDay(1)
    setDiaryTitle('')
    setDiaryContent('')
    setDiaryImages([])
    setDiaryVideos([])
    setDiaryLocation('')
    setDiaryExpanded(false)
    setDiarySearchYear('')
    setDiarySearchMonth('')
    setDiarySearchDay('')
    setAppliedDiarySearch({ year: '', month: '', day: '' })
  }

  const buildWeekSheets = (targetWeek: WeekGoal, sheetPrefix = '周') => {
    const weekday = ['日', '一', '二', '三', '四', '五', '六']
    const weekDates = buildWeekDates(targetWeek.startDate)
    const dayBlocks = targetWeek.days.map((d) => {
      const date = weekDates[d.day - 1]
      const key = dateKey(date)
      return {
        title: `${date.getMonth() + 1}/${date.getDate()}(周${weekday[date.getDay()]})`,
        tasks: d.tasks,
        diaries: diariesByDate[key] || [],
      }
    })

    const maxTasks = Math.max(8, ...dayBlocks.map((x) => x.tasks.length))
    const aoa: any[][] = []
    const totalCols = dayBlocks.length * 2
    const rangeText = `${dayBlocks[0]?.title || ''} - ${dayBlocks[dayBlocks.length - 1]?.title || ''}`

    aoa.push(['本周计划模板', ...Array(totalCols - 1).fill('')])
    aoa.push([`周目标：${targetWeek.title}`, ...Array(totalCols - 1).fill('')])
    aoa.push([`周范围：${rangeText}`, ...Array(totalCols - 1).fill('')])

    const dayHeaderRow: string[] = []
    dayBlocks.forEach((d) => dayHeaderRow.push(d.title, ''))
    aoa.push(dayHeaderRow)

    const subHeaderRow: string[] = []
    dayBlocks.forEach(() => subHeaderRow.push('To Do', '状态'))
    aoa.push(subHeaderRow)

    for (let i = 0; i < maxTasks; i++) {
      const row: string[] = []
      dayBlocks.forEach((d) => {
        const t = d.tasks[i]
        row.push(t ? `${t.slot}｜${t.text}` : '')
        row.push(t ? (t.done ? '✅' : t.failed ? '❌' : '') : '')
      })
      aoa.push(row)
    }

    aoa.push([])
    aoa.push(['本周复盘', ...Array(totalCols - 1).fill('')])
    aoa.push(['做得好的事：', ...Array(totalCols - 1).fill('')])
    aoa.push(['下周改进：', ...Array(totalCols - 1).fill('')])

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } },
      ...dayBlocks.map((_, i) => ({ s: { r: 3, c: i * 2 }, e: { r: 3, c: i * 2 + 1 } })),
      { s: { r: maxTasks + 6, c: 0 }, e: { r: maxTasks + 6, c: totalCols - 1 } },
      { s: { r: maxTasks + 7, c: 0 }, e: { r: maxTasks + 7, c: totalCols - 1 } },
      { s: { r: maxTasks + 8, c: 0 }, e: { r: maxTasks + 8, c: totalCols - 1 } },
    ]
    ws['!cols'] = dayBlocks.flatMap(() => [{ wch: 24 }, { wch: 8 }])

    const diaryAoa: any[][] = []
    diaryAoa.push(['本周日记模板', ...Array(totalCols - 1).fill('')])
    diaryAoa.push([`周目标：${targetWeek.title}`, ...Array(totalCols - 1).fill('')])

    const diaryHeaderRow: string[] = []
    dayBlocks.forEach((d) => diaryHeaderRow.push(d.title, ''))
    diaryAoa.push(diaryHeaderRow)

    const diarySubHeaderRow: string[] = []
    dayBlocks.forEach(() => diarySubHeaderRow.push('日记标题', '日记内容'))
    diaryAoa.push(diarySubHeaderRow)

    const maxDiaryRows = Math.max(4, ...dayBlocks.map((x) => x.diaries.length))
    for (let i = 0; i < maxDiaryRows; i++) {
      const row: string[] = []
      dayBlocks.forEach((d) => {
        const entry = d.diaries[i]
        row.push(entry ? entry.title : '')
        row.push(entry ? entry.content : '')
      })
      diaryAoa.push(row)
    }

    const diaryWs = XLSX.utils.aoa_to_sheet(diaryAoa)
    diaryWs['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
      ...dayBlocks.map((_, i) => ({ s: { r: 2, c: i * 2 }, e: { r: 2, c: i * 2 + 1 } })),
    ]
    diaryWs['!cols'] = dayBlocks.flatMap(() => [{ wch: 16 }, { wch: 36 }])

    return {
      planSheetName: `${sheetPrefix}-计划`,
      diarySheetName: `${sheetPrefix}-日记`,
      ws,
      diaryWs,
    }
  }

  const exportWeekToExcel = () => {
    if (!selectedWeek) {
      alert('请先选择一个周目标')
      return
    }
    const wb = XLSX.utils.book_new()
    const one = buildWeekSheets(selectedWeek, '本周')
    XLSX.utils.book_append_sheet(wb, one.ws, one.planSheetName)
    XLSX.utils.book_append_sheet(wb, one.diaryWs, one.diarySheetName)
    XLSX.writeFile(wb, `plan-week-${selectedWeek.title}-${dateKey(new Date())}.xlsx`)
  }

  const exportMonthToExcel = () => {
    if (!weekGoals.length) {
      alert('暂无可导出的周计划')
      return
    }
    const wb = XLSX.utils.book_new()
    weekGoals.forEach((w, idx) => {
      const sheet = buildWeekSheets(w, `第${idx + 1}周`)
      XLSX.utils.book_append_sheet(wb, sheet.ws, sheet.planSheetName)
      XLSX.utils.book_append_sheet(wb, sheet.diaryWs, sheet.diarySheetName)
    })
    XLSX.writeFile(wb, `plan-month-${dateKey(new Date())}.xlsx`)
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

  const quadrantEmoji: Record<QuadrantKey, string> = {
    important_urgent: '🚨',
    important_not_urgent: '🎯',
    not_important_urgent: '⏱️',
    not_important_not_urgent: '🧹',
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

  const addTreeChildToNode = (nodeId: string, side: 'left' | 'right') => {
    const parent = planTreeNodes.find((n) => n.id === nodeId)
    if (!parent) return
    if ((side === 'left' && parent.leftId) || (side === 'right' && parent.rightId)) {
      alert('该方向已有子节点')
      return
    }
    pushUndoSnapshot()
    const newId = uuid()
    const nextLayer: GoalLayer =
      parent.goalLayer === '总目标'
        ? '年目标'
        : parent.goalLayer === '年目标'
          ? '月目标'
          : '周目标'

    setPlanTreeNodes((prev) =>
      prev
        .map((n) => (n.id === parent.id ? { ...n, ...(side === 'left' ? { leftId: newId } : { rightId: newId }) } : n))
        .concat([{ id: newId, label: `${nextLayer}`, goalLayer: nextLayer }]),
    )
  }

  const syncTreeNodeToQuadrant = (nodeId: string, target: '' | QuadrantKey) => {
    const node = planTreeNodes.find((n) => n.id === nodeId)
    if (!node || node.id === 'root') return
    pushUndoSnapshot()

    setPlanTreeNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, quadrant: target || undefined } : n)))

    if (!target) {
      setQuadrantItems((prev) => prev.filter((q) => q.sourceNodeId !== nodeId))
      return
    }

    setQuadrantItems((prev) => {
      const existing = prev.find((q) => q.sourceNodeId === nodeId)
      if (existing) {
        return prev.map((q) => (q.sourceNodeId === nodeId ? { ...q, quadrant: target, text: node.label } : q))
      }
      return [{ id: uuid(), text: node.label, quadrant: target, createdAt: Date.now(), sourceNodeId: nodeId }, ...prev]
    })
  }

  const renameTreeNodeById = (nodeId: string) => {
    if (!nodeId) return
    const current = planTreeNodes.find((n) => n.id === nodeId)
    if (!current) return
    const next = prompt('输入新的节点名称', current.label)?.trim()
    if (!next) return
    pushUndoSnapshot()
    setPlanTreeNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, label: next } : n)))
    setQuadrantItems((prev) => prev.map((q) => (q.sourceNodeId === nodeId ? { ...q, text: next } : q)))
  }

  const deleteTreeNode = (nodeId: string) => {
    if (!nodeId || nodeId === 'root') {
      alert('根节点不可删除')
      return
    }
    pushUndoSnapshot()

    const nodeMap = new Map(planTreeNodes.map((n) => [n.id, n]))
    const removeSet = new Set<string>()
    const stack = [nodeId]
    while (stack.length) {
      const id = stack.pop()!
      if (removeSet.has(id)) continue
      removeSet.add(id)
      const n = nodeMap.get(id)
      if (!n) continue
      if (n.leftId) stack.push(n.leftId)
      if (n.rightId) stack.push(n.rightId)
    }

    setPlanTreeNodes((prev) =>
      prev
        .filter((n) => !removeSet.has(n.id))
        .map((n) => ({
          ...n,
          leftId: n.leftId && removeSet.has(n.leftId) ? undefined : n.leftId,
          rightId: n.rightId && removeSet.has(n.rightId) ? undefined : n.rightId,
        })),
    )
    setQuadrantItems((prev) => prev.filter((q) => !(q.sourceNodeId && removeSet.has(q.sourceNodeId))))
  }

  const flow = useMemo(() => {
    const nodeMap = new Map(planTreeNodes.map((n) => [n.id, n]))
    if (!nodeMap.has('root')) return { nodes: [] as Node[], edges: [] as Edge[] }

    const nodes: Node[] = []
    const edges: Edge[] = []

    const queue: Array<{ id: string; level: number; index: number }> = [{ id: 'root', level: 0, index: 0 }]
    while (queue.length) {
      const cur = queue.shift()!
      const node = nodeMap.get(cur.id)
      if (!node) continue

      const count = Math.max(1, 2 ** cur.level)
      const offset = (cur.index - (count - 1) / 2) * 220
      nodes.push({
        id: node.id,
        data: {
          label: (
            <div className="tree-node-card" onDoubleClick={() => renameTreeNodeById(node.id)}>
              <div>{`${node.goalLayer}｜${node.label}`}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center', flexWrap: 'nowrap' }}>
                <button className="schedule-box-btn" onClick={() => addTreeChildToNode(node.id, 'left')}>L+</button>
                <button className="schedule-box-btn" onClick={() => addTreeChildToNode(node.id, 'right')}>R+</button>
                {node.id !== 'root' && (
                  <>
                    <details className="tree-node-menu">
                      <summary className="schedule-box-btn">▾</summary>
                      <div className="tree-node-menu-pop">
                        <button onClick={() => syncTreeNodeToQuadrant(node.id, '')}>不入象限</button>
                        <button onClick={() => syncTreeNodeToQuadrant(node.id, 'important_urgent')}>重要且紧急</button>
                        <button onClick={() => syncTreeNodeToQuadrant(node.id, 'important_not_urgent')}>重要不紧急</button>
                        <button onClick={() => syncTreeNodeToQuadrant(node.id, 'not_important_urgent')}>不重要但紧急</button>
                        <button onClick={() => syncTreeNodeToQuadrant(node.id, 'not_important_not_urgent')}>不重要不紧急</button>
                      </div>
                    </details>
                    <button className="schedule-box-btn" onClick={() => deleteTreeNode(node.id)}>✕</button>
                  </>
                )}
              </div>
            </div>
          ),
        },
        position: { x: offset + 380, y: 30 + cur.level * 110 },
      })

      if (node.leftId) {
        edges.push({ id: `e-${node.id}-${node.leftId}`, source: node.id, target: node.leftId })
        queue.push({ id: node.leftId, level: cur.level + 1, index: cur.index * 2 })
      }
      if (node.rightId) {
        edges.push({ id: `e-${node.id}-${node.rightId}`, source: node.id, target: node.rightId })
        queue.push({ id: node.rightId, level: cur.level + 1, index: cur.index * 2 + 1 })
      }
    }

    return { nodes, edges }
  }, [planTreeNodes])

  return (
    <div className={`app ${theme}`}>
      <header>
        <h1>🌈 Plan & Diary</h1>
        <div className="theme-switch compact-header-actions">
          <span className="save-hint-mini">{saveHint}</span>
          <button onClick={undoLastAction} disabled={undoStack.length === 0}>↶ 撤回</button>
          <details className="top-actions-menu">
            <summary>⚙️</summary>
            <div className="top-actions-pop">
              <label style={{ fontSize: 12, color: '#64748b' }}>样式</label>
              <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                <option value="mint">薄荷</option>
                <option value="genki">元气</option>
              </select>
              <button onClick={page === 'plan' ? clearPlanData : clearDiaryData}>{page === 'plan' ? '清空计划' : '清空日记'}</button>
            </div>
          </details>
        </div>
      </header>

      {page === 'plan' ? (
        <>
          <section className="panel">
            <details open>
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
                    <div
                      key={key}
                      className="matrix-cell"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onQuadrantCellDrop(key, e)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <h4 style={{ margin: 0 }}>{quadrantLabel[key]}</h4>
                        <button className="schedule-box-btn" onClick={() => toggleQuadrantComposer(key)}>
                          {quadrantComposerOpen[key] ? '▴' : '▾'}
                        </button>
                      </div>
                      {quadrantComposerOpen[key] && (
                        <div className="row" style={{ margin: '6px 0', alignItems: 'center' }}>
                          <input
                            value={quadrantQuickInput[key]}
                            onChange={(e) => setQuadrantQuickInput((prev) => ({ ...prev, [key]: e.target.value }))}
                            placeholder="输入任务"
                          />
                          <button className="add-box-btn" onClick={() => addQuadrantItemInCell(key)}>＋</button>
                        </div>
                      )}

                      {(groupedQuadrants[key] || []).length === 0 ? (
                        <small className="muted">暂无</small>
                      ) : (
                        (groupedQuadrants[key] || []).map((item) => (
                          <div
                            key={item.id}
                            className="mini-task"
                            style={{ display: 'block', whiteSpace: 'normal', marginTop: 6 }}
                            draggable
                            onDragStart={(e) => onQuadrantItemDragStart(item.id, e)}
                            onDragEnd={onQuadrantItemDragEnd}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                              <span>{item.text}</span>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <button className="schedule-box-btn" onClick={() => openTaskSchedule(item.id)}>▾</button>
                                <button className="schedule-box-btn" onClick={() => deleteQuadrantItem(item.id)}>✕</button>
                              </div>
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
              <summary>目标树可视化（二叉树）</summary>
              <div className="flow" style={{ marginTop: 8 }}>
                <ReactFlow
                  nodes={flow.nodes}
                  edges={flow.edges}
                  fitView
                >
                  <Background />
                  <MiniMap style={{ width: 90, height: 60 }} />
                </ReactFlow>
              </div>
            </details>
          </section>

          <section className="panel page-bottom-pad">
            <details open>
              <summary>执行看板（周视图 / 月视图）</summary>
              <div className="todo-head" style={{ marginTop: 8 }}>
                <h2>{todoView === 'week' ? '一周 To-Do（可打勾/打叉）' : '一月视图（与周视图数据联动）'}</h2>
                <div className="view-toggle">
                  <button onClick={todoView === 'month' ? exportMonthToExcel : exportWeekToExcel}>{todoView === 'month' ? '导出月Excel' : '导出周Excel'}</button>
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
                            <div
                              key={s}
                              data-week-slot="1"
                              data-day={d.day}
                              data-slot={s}
                              className={weekDropTarget?.day === d.day && weekDropTarget?.slot === s ? 'week-slot-drop-target' : ''}
                              onDragOver={(e) => {
                                e.preventDefault()
                                if (draggingWeekTask) setWeekDropTarget({ day: d.day, slot: s })
                              }}
                              onDragLeave={() => {
                                if (weekDropTarget?.day === d.day && weekDropTarget?.slot === s) setWeekDropTarget(null)
                              }}
                              onDrop={() => {
                                if (draggingWeekTask) {
                                  moveWeekTask(draggingWeekTask.day, draggingWeekTask.taskId, d.day, s)
                                  setDraggingWeekTask(null)
                                  setWeekDropTarget(null)
                                }
                              }}
                            >
                              <h4>{s}</h4>
                              {d.tasks.filter((t) => t.slot === s).map((t) => (
                                <div
                                  className={`task ${t.done ? 'done' : ''} ${t.failed ? 'failed' : ''}`}
                                  key={t.id}
                                  draggable={bulkModeWeekId !== selectedWeek.id}
                                  onDragStart={() => setDraggingWeekTask({ day: d.day, taskId: t.id })}
                                  onDragEnd={() => {
                                    setDraggingWeekTask(null)
                                    setWeekDropTarget(null)
                                  }}
                                  onTouchStart={() => setDraggingWeekTask({ day: d.day, taskId: t.id })}
                                  onTouchMove={(e: any) => {
                                    if (!draggingWeekTask) return
                                    const touch = e.touches?.[0]
                                    if (!touch) return
                                    const target = resolveTouchSlotTarget(touch)
                                    setWeekDropTarget(target)
                                  }}
                                  onTouchEnd={(e: any) => {
                                    if (!draggingWeekTask) return
                                    const touch = e.changedTouches?.[0]
                                    const target = touch ? resolveTouchSlotTarget(touch) : weekDropTarget
                                    if (target) moveWeekTask(draggingWeekTask.day, draggingWeekTask.taskId, target.day, target.slot)
                                    setDraggingWeekTask(null)
                                    setWeekDropTarget(null)
                                  }}
                                >
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
