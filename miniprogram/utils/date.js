const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function cloneDate(date) {
  return new Date(date.getTime())
}

function startOfDay(date) {
  const next = cloneDate(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date) {
  const next = cloneDate(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function addDays(date, days) {
  const next = cloneDate(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseDateKey(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function startOfWeek(date) {
  const next = startOfDay(date)
  const day = next.getDay()
  const offset = day === 0 ? -6 : 1 - day
  return addDays(next, offset)
}

function endOfWeek(date) {
  return endOfDay(addDays(startOfWeek(date), 6))
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

function getPeriodBounds(periodType, baseDate = new Date()) {
  if (periodType === 'monthly') {
    const start = startOfMonth(baseDate)
    const end = endOfMonth(baseDate)

    return {
      start,
      end,
      startKey: toDateKey(start),
      endKey: toDateKey(end)
    }
  }

  const start = startOfWeek(baseDate)
  const end = endOfWeek(baseDate)

  return {
    start,
    end,
    startKey: toDateKey(start),
    endKey: toDateKey(end)
  }
}

function getPreviousPeriodBounds(periodType, baseDate = new Date()) {
  const current = getPeriodBounds(periodType, baseDate)

  if (periodType === 'monthly') {
    const previousMonthDate = new Date(current.start.getFullYear(), current.start.getMonth() - 1, 1)
    return getPeriodBounds('monthly', previousMonthDate)
  }

  return getPeriodBounds('weekly', addDays(current.start, -1))
}

function isDateKeyInRange(dateKey, bounds) {
  const timestamp = startOfDay(parseDateKey(dateKey)).getTime()
  return timestamp >= startOfDay(bounds.start).getTime() && timestamp <= endOfDay(bounds.end).getTime()
}

function diffDays(fromDate, toDate) {
  const from = startOfDay(fromDate).getTime()
  const to = startOfDay(toDate).getTime()
  return Math.round((to - from) / 86400000)
}

function daysUntil(dateKey, baseDate = new Date()) {
  return diffDays(baseDate, parseDateKey(dateKey))
}

function formatTodayLabel(date = new Date()) {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekday = WEEKDAYS[date.getDay()]

  return `${month}月${day}日 ${weekday}`
}

function formatMonthDay(value) {
  const date = typeof value === 'string' ? parseDateKey(value) : value
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatFullDate(value) {
  const date = typeof value === 'string' ? parseDateKey(value) : value
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatMonthLabel(value) {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}$/.test(value)) {
      const [year, month] = value.split('-').map(Number)
      return `${year}年${month}月`
    }

    return formatMonthLabel(parseDateKey(value))
  }

  return `${value.getFullYear()}年${value.getMonth() + 1}月`
}

function formatDateTimeLabel(value, baseDate = new Date()) {
  const date = new Date(value)
  const dayKey = toDateKey(date)
  const todayKey = toDateKey(baseDate)
  const yesterdayKey = toDateKey(addDays(baseDate, -1))
  const timeLabel = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`

  if (dayKey === todayKey) {
    return `今天 ${timeLabel}`
  }

  if (dayKey === yesterdayKey) {
    return `昨天 ${timeLabel}`
  }

  return `${formatMonthDay(date)} ${timeLabel}`
}

function formatCurrency(amountCents) {
  const amount = amountCents / 100
  const hasDecimals = amountCents % 100 !== 0
  return `￥${amount.toFixed(hasDecimals ? 2 : 0)}`
}

function formatPercentChange(currentCents, previousCents) {
  if (!previousCents) {
    return '首个周期'
  }

  const delta = Math.round(((currentCents - previousCents) / previousCents) * 100)
  return `${delta > 0 ? '+' : ''}${delta}%`
}

function formatDueLabel(dueAt, status) {
  if (status === 'completed') {
    return '已完成'
  }

  if (!dueAt) {
    return '未设置日期'
  }

  const days = daysUntil(dueAt)

  if (days === 0) {
    return '今天'
  }

  if (days === 1) {
    return '明天'
  }

  if (days === -1) {
    return '昨天'
  }

  if (days > 1 && days <= 7) {
    return `${days} 天后`
  }

  if (days < -1) {
    return `已超时 ${Math.abs(days)} 天`
  }

  return formatMonthDay(dueAt)
}

function formatPeriodLabel(periodType, bounds) {
  if (periodType === 'monthly') {
    return `${bounds.start.getFullYear()}年${bounds.start.getMonth() + 1}月`
  }

  return `${formatMonthDay(bounds.start)} - ${formatMonthDay(bounds.end)}`
}

function getNextRunLabel(periodType, baseDate = new Date()) {
  if (periodType === 'monthly') {
    const end = endOfMonth(baseDate)
    return `${end.getMonth() + 1}月${end.getDate()}日 20:30`
  }

  const weekEnd = endOfWeek(baseDate)
  return `${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日 20:30`
}

function formatChineseNumber(value) {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

  if (!Number.isFinite(value) || value <= 0) {
    return '零'
  }

  if (value < 10) {
    return digits[value]
  }

  if (value === 10) {
    return '十'
  }

  if (value < 20) {
    return `十${digits[value % 10]}`
  }

  if (value < 100) {
    const tens = Math.floor(value / 10)
    const ones = value % 10
    return `${digits[tens]}十${ones ? digits[ones] : ''}`
  }

  return `${value}`
}

function getNextAnnualOccurrence(dateKey, baseDate = new Date()) {
  const anchor = parseDateKey(dateKey)
  const month = anchor.getMonth()
  const day = anchor.getDate()

  function buildOccurrence(year) {
    const lastDay = new Date(year, month + 1, 0).getDate()
    return new Date(year, month, Math.min(day, lastDay))
  }

  let occurrence = startOfDay(buildOccurrence(baseDate.getFullYear()))

  if (occurrence.getTime() < startOfDay(baseDate).getTime()) {
    occurrence = startOfDay(buildOccurrence(baseDate.getFullYear() + 1))
  }

  return {
    date: occurrence,
    dateKey: toDateKey(occurrence),
    years: occurrence.getFullYear() - anchor.getFullYear()
  }
}

module.exports = {
  addDays,
  daysUntil,
  diffDays,
  endOfMonth,
  endOfWeek,
  formatChineseNumber,
  formatCurrency,
  formatDateTimeLabel,
  formatDueLabel,
  formatFullDate,
  formatMonthLabel,
  formatMonthDay,
  formatPercentChange,
  formatPeriodLabel,
  formatTodayLabel,
  getNextRunLabel,
  getNextAnnualOccurrence,
  getPeriodBounds,
  getPreviousPeriodBounds,
  isDateKeyInRange,
  parseDateKey,
  startOfMonth,
  startOfWeek,
  toDateKey
}
