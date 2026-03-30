const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const ACTIVE_STATUSES = ['paired']
const ASSIGNMENT_WINDOW_MINUTES = 20
const COLLECTIONS = {
  couples: 'couples',
  todos: 'todos',
  preferences: 'notification_preferences',
  deliveries: 'notification_deliveries',
  queue: 'notification_queue'
}

const MINIPROGRAM_STATE = 'trial'
const TODO_NOTIFICATIONS_RELEASED = false
const TODO_ASSIGNMENT_TEMPLATE_ID = 'd7hREjo_M5QQyAttnDAmSGu8JC7E5NHyu4F6HJkP2rw'
const TODO_DUE_TEMPLATE_ID = 'R1pfDFPyTImevEDSsruCdaU6lz0-NtmJyDBYj0SYTHc'
const TEMPLATE_CONFIG = {
  assignment: {
    templateId: TODO_ASSIGNMENT_TEMPLATE_ID,
    fields: {
      title: 'thing1',
      summary: 'thing4',
      remark: 'thing9'
    }
  },
  due: {
    templateId: TODO_DUE_TEMPLATE_ID,
    fields: {
      summary: 'thing2',
      dueAt: 'time3',
      remark: 'thing4',
      count: 'thing7'
    }
  }
}

function nowIso() {
  return new Date().toISOString()
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function formatDateTime(date) {
  const instance = date instanceof Date ? date : new Date(date)
  return `${pad2(instance.getMonth() + 1)}月${pad2(instance.getDate())}日 ${pad2(instance.getHours())}:${pad2(instance.getMinutes())}`
}

function formatTemplateDateTime(value, fallbackTime = '09:00:00') {
  if (!value) {
    return ''
  }

  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`
  }

  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text} ${fallbackTime}`
  }

  const instance = new Date(value)
  if (Number.isNaN(instance.getTime())) {
    return ''
  }

  return `${instance.getFullYear()}-${pad2(instance.getMonth() + 1)}-${pad2(instance.getDate())} ${pad2(instance.getHours())}:${pad2(instance.getMinutes())}:${pad2(instance.getSeconds())}`
}

function truncateText(value, limit = 20) {
  const text = String(value || '').trim()
  if (text.length <= limit) {
    return text
  }

  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

function isTemplateConfigured(template) {
  return !!(template && template.templateId && String(template.templateId).indexOf('REPLACE_') !== 0)
}

function buildTemplateState() {
  return {
    todoAssignmentTemplateId: TEMPLATE_CONFIG.assignment.templateId || '',
    todoDueTemplateId: TEMPLATE_CONFIG.due.templateId || '',
    todoAssignmentTemplateConfigured: isTemplateConfigured(TEMPLATE_CONFIG.assignment),
    todoDueTemplateConfigured: isTemplateConfigured(TEMPLATE_CONFIG.due)
  }
}

async function expirePendingAssignmentQueuesForRelease() {
  if (TODO_NOTIFICATIONS_RELEASED) {
    return 0
  }

  const pendingQueues = await getAllByWhere(COLLECTIONS.queue, {
    kind: 'todo_assignment_digest',
    status: 'pending'
  })

  for (const queueDoc of pendingQueues) {
    await updateQueueDoc(queueDoc._id, {
      status: 'expired',
      errorMessage: '待办提醒已延期到下一版本'
    })
  }

  return pendingQueues.length
}

function getDefaultPreferences(coupleId = '', userId = '') {
  return Object.assign({
    coupleId,
    userId,
    todoAssignmentWanted: false,
    todoAssignmentArmed: false,
    todoDueWanted: false,
    todoDueArmed: false,
    lastAssignmentConsentAt: '',
    lastDueConsentAt: '',
    updatedAt: ''
  }, buildTemplateState())
}

function mapPreferencesDoc(doc = null, coupleId = '', userId = '') {
  if (!doc) {
    return getDefaultPreferences(coupleId, userId)
  }

  const defaults = getDefaultPreferences(coupleId, userId)
  const legacyWanted = !!doc.todoReminderEnabled

  return Object.assign(defaults, {
    todoAssignmentWanted: Object.prototype.hasOwnProperty.call(doc, 'todoAssignmentWanted')
      ? !!doc.todoAssignmentWanted
      : legacyWanted,
    todoAssignmentArmed: !!doc.todoAssignmentArmed,
    todoDueWanted: Object.prototype.hasOwnProperty.call(doc, 'todoDueWanted')
      ? !!doc.todoDueWanted
      : legacyWanted,
    todoDueArmed: !!doc.todoDueArmed,
    lastAssignmentConsentAt: doc.lastAssignmentConsentAt || '',
    lastDueConsentAt: doc.lastDueConsentAt || '',
    updatedAt: doc.updatedAt || ''
  })
}

function detectAction(event = {}) {
  if (event.action) {
    return event.action
  }

  const triggerName = event.TriggerName || event.triggerName || event.name || ''

  if (String(triggerName).indexOf('todoAssignmentReminderSweep') >= 0) {
    return 'runAssignmentReminderSweep'
  }

  if (String(triggerName).indexOf('todoDueReminderSweep') >= 0) {
    return 'runDueReminderSweep'
  }

  return 'getPreferences'
}

async function getAllByWhere(collectionName, query) {
  const collection = db.collection(collectionName)
  const items = []
  let skip = 0
  const limit = 100

  while (true) {
    const result = await collection.where(query).skip(skip).limit(limit).get()
    const chunk = result.data || []
    items.push(...chunk)

    if (chunk.length < limit) {
      break
    }

    skip += chunk.length
  }

  return items
}

async function listPairedCouplesByField(field, userId) {
  const result = await db.collection(COLLECTIONS.couples).where({
    [field]: userId,
    status: _.in(ACTIVE_STATUSES)
  }).get()

  return result.data || []
}

async function findActiveCouple(userId) {
  const [created, joined] = await Promise.all([
    listPairedCouplesByField('creatorUserId', userId),
    listPairedCouplesByField('partnerUserId', userId)
  ])

  return created
    .concat(joined)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())[0] || null
}

async function findCoupleById(coupleId) {
  if (!coupleId) {
    return null
  }

  try {
    const result = await db.collection(COLLECTIONS.couples).doc(coupleId).get()
    return result.data || null
  } catch (error) {
    return null
  }
}

function requirePairedCouple(couple) {
  if (!couple || couple.status !== 'paired') {
    throw new Error('共享空间还没连接完成')
  }
}

async function getPreferenceDoc(coupleId, userId) {
  const result = await db.collection(COLLECTIONS.preferences).where({
    coupleId,
    userId
  }).limit(1).get()

  return (result.data || [])[0] || null
}

async function upsertPreferenceDoc(coupleId, userId, patch = {}) {
  const existing = await getPreferenceDoc(coupleId, userId)
  const existingData = existing ? Object.assign({}, existing) : {}
  if (existingData._id) {
    delete existingData._id
  }
  const next = Object.assign({
    coupleId,
    userId,
    todoAssignmentWanted: false,
    todoAssignmentArmed: false,
    todoDueWanted: false,
    todoDueArmed: false,
    todoAssignmentTemplateId: TEMPLATE_CONFIG.assignment.templateId || '',
    todoDueTemplateId: TEMPLATE_CONFIG.due.templateId || '',
    lastAssignmentConsentAt: '',
    lastDueConsentAt: '',
    updatedAt: nowIso()
  }, existingData, patch, {
    coupleId,
    userId,
    todoAssignmentTemplateId: TEMPLATE_CONFIG.assignment.templateId || '',
    todoDueTemplateId: TEMPLATE_CONFIG.due.templateId || '',
    updatedAt: nowIso()
  })

  if (existing) {
    await db.collection(COLLECTIONS.preferences).doc(existing._id).update({
      data: next
    })
  } else {
    await db.collection(COLLECTIONS.preferences).add({
      data: next
    })
  }

  return mapPreferencesDoc(await getPreferenceDoc(coupleId, userId), coupleId, userId)
}

async function getDeliveryDoc(deliveryKey) {
  const result = await db.collection(COLLECTIONS.deliveries).where({
    deliveryKey
  }).limit(1).get()

  return (result.data || [])[0] || null
}

async function markDelivery(deliveryKey, docPatch = {}) {
  const existing = await getDeliveryDoc(deliveryKey)
  const existingData = existing ? Object.assign({}, existing) : {}
  if (existingData._id) {
    delete existingData._id
  }
  const next = Object.assign({
    deliveryKey,
    updatedAt: nowIso()
  }, existingData, docPatch, {
    deliveryKey,
    updatedAt: nowIso()
  })

  if (existing) {
    await db.collection(COLLECTIONS.deliveries).doc(existing._id).update({
      data: next
    })
    return
  }

  await db.collection(COLLECTIONS.deliveries).add({
    data: next
  })
}

async function fetchTodo(todoId) {
  if (!todoId) {
    return null
  }

  try {
    const result = await db.collection(COLLECTIONS.todos).doc(todoId).get()
    return result.data || null
  } catch (error) {
    return null
  }
}

async function fetchTodosByIds(ids = []) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)))
  const items = []

  for (let index = 0; index < uniqueIds.length; index += 100) {
    const chunk = uniqueIds.slice(index, index + 100)

    if (!chunk.length) {
      continue
    }

    const result = await db.collection(COLLECTIONS.todos).where({
      _id: _.in(chunk)
    }).get()

    items.push(...(result.data || []))
  }

  return items
}

function buildTemplateData(fields, values) {
  const data = {}
  Object.keys(fields || {}).forEach((key) => {
    const fieldKey = fields[key]
    const value = values[key]

    if (fieldKey && value !== undefined && value !== null && value !== '') {
      data[fieldKey] = {
        value
      }
    }
  })

  return data
}

function buildTodoPage(todoId = '', preset = 'all') {
  const params = [`target=todo`, `preset=${preset}`]

  if (todoId) {
    params.push(`todoId=${todoId}`)
  }

  return `pages/index/index?${params.join('&')}`
}

function buildAssignmentDigestPayload(queueDoc, todos) {
  const sorted = todos
    .slice()
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())
  const latestTodo = sorted[0] || null
  const count = todos.length

  return buildTemplateData(TEMPLATE_CONFIG.assignment.fields, {
    title: count > 1 ? `${count} 个新待办` : '1 个新待办',
    summary: latestTodo ? truncateText(latestTodo.title, 18) : '去看看待办',
    remark: count > 1 ? `最近一条，${truncateText(latestTodo ? latestTodo.title : '去看看待办', 16)}` : '打开待办查看详情'
  })
}

function buildDueDigestPayload(todos) {
  const sorted = todos
    .slice()
    .sort((left, right) => {
      const leftDue = left.dueAt ? left.dueAt : '9999-12-31'
      const rightDue = right.dueAt ? right.dueAt : '9999-12-31'
      if (leftDue !== rightDue) {
        return leftDue < rightDue ? -1 : 1
      }
      return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime()
    })
  const focusTodo = sorted[0] || null
  const count = todos.length
  const dueAt = focusTodo
    ? formatTemplateDateTime(focusTodo.dueAt, '23:59:00')
    : formatTemplateDateTime(nowIso())

  return buildTemplateData(TEMPLATE_CONFIG.due.fields, {
    summary: count > 1 ? `今天有 ${count} 个待办到期` : '今天有 1 个待办到期',
    dueAt,
    remark: focusTodo ? `最紧急：${truncateText(focusTodo.title, 16)}` : '今天记得处理',
    count: `${count} 项`
  })
}

async function sendSubscribeMessage(touser, templateId, page, data) {
  return cloud.openapi.subscribeMessage.send({
    touser,
    templateId,
    miniprogram_state: MINIPROGRAM_STATE,
    page,
    data
  })
}

async function getPreferences(openid) {
  if (!TODO_NOTIFICATIONS_RELEASED) {
    await expirePendingAssignmentQueuesForRelease()
    return {
      ok: true,
      preferences: getDefaultPreferences('', openid)
    }
  }

  const couple = await findActiveCouple(openid)

  if (!couple) {
    return {
      ok: true,
      preferences: getDefaultPreferences('', openid)
    }
  }

  try {
    const sweepResult = await runAssignmentReminderSweep()
    console.log('[notifications] getPreferences assignment sweep', JSON.stringify({
      userId: openid,
      sentCount: sweepResult && sweepResult.sentCount ? sweepResult.sentCount : 0
    }))
  } catch (error) {
    console.warn('[notifications] getPreferences assignment sweep failed', JSON.stringify({
      userId: openid,
      message: error && error.message ? error.message : 'unknown'
    }))
  }

  return {
    ok: true,
    preferences: mapPreferencesDoc(await getPreferenceDoc(couple._id, openid), couple._id, openid)
  }
}

async function updatePreferences(openid, payload = {}) {
  if (!TODO_NOTIFICATIONS_RELEASED) {
    await expirePendingAssignmentQueuesForRelease()
    return {
      ok: true,
      preferences: getDefaultPreferences('', openid)
    }
  }

  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const nextPatch = {}

  ;['todoAssignmentWanted', 'todoAssignmentArmed', 'todoDueWanted', 'todoDueArmed'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      nextPatch[key] = !!payload[key]
    }
  })

  const consentKinds = Array.isArray(payload.consentGrantedKinds) ? payload.consentGrantedKinds : []
  if (consentKinds.indexOf('assignment') >= 0) {
    nextPatch.lastAssignmentConsentAt = nowIso()
  }
  if (consentKinds.indexOf('due') >= 0) {
    nextPatch.lastDueConsentAt = nowIso()
  }

  return {
    ok: true,
    preferences: await upsertPreferenceDoc(couple._id, openid, nextPatch)
  }
}

async function findActiveAssignmentQueue(coupleId, userId, now = new Date()) {
  const pending = await getAllByWhere(COLLECTIONS.queue, {
    kind: 'todo_assignment_digest',
    coupleId,
    userId,
    status: 'pending'
  })

  return pending
    .filter((item) => new Date(item.windowEnd || 0).getTime() > now.getTime())
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())[0] || null
}

async function updateQueueDoc(queueId, patch = {}) {
  await db.collection(COLLECTIONS.queue).doc(queueId).update({
    data: Object.assign({}, patch, {
      updatedAt: nowIso()
    })
  })
}

async function queueTodoAssignment(payload = {}) {
  if (!TODO_NOTIFICATIONS_RELEASED) {
    await expirePendingAssignmentQueuesForRelease()
    return {
      ok: true,
      skipped: true,
      reason: 'disabled_by_release'
    }
  }

  const todo = await fetchTodo(payload.todoId)

  if (!todo || todo.status !== 'open' || !todo.assigneeUserId) {
    return {
      ok: true,
      skipped: true,
      reason: 'todo not eligible'
    }
  }

  if (payload.actorUserId && payload.actorUserId === todo.assigneeUserId) {
    return {
      ok: true,
      skipped: true,
      reason: 'self assigned'
    }
  }

  const couple = await findCoupleById(todo.coupleId)
  requirePairedCouple(couple)

  const now = new Date()
  const queueDoc = await findActiveAssignmentQueue(couple._id, todo.assigneeUserId, now)

  if (queueDoc) {
    const nextIds = Array.from(new Set([].concat(queueDoc.itemIds || [], todo._id)))
    await updateQueueDoc(queueDoc._id, {
      itemIds: nextIds,
      latestItemId: todo._id
    })

    return {
      ok: true,
      queued: true,
      queueId: queueDoc._id
    }
  }

  const windowStart = nowIso()
  const windowEndDate = new Date(now.getTime() + ASSIGNMENT_WINDOW_MINUTES * 60 * 1000)
  const created = await db.collection(COLLECTIONS.queue).add({
    data: {
      kind: 'todo_assignment_digest',
      coupleId: couple._id,
      userId: todo.assigneeUserId,
      itemIds: [todo._id],
      latestItemId: todo._id,
      windowStart,
      windowEnd: windowEndDate.toISOString(),
      status: 'pending',
      errorMessage: '',
      createdAt: windowStart,
      updatedAt: windowStart
    }
  })

  return {
    ok: true,
    queued: true,
    queueId: created._id
  }
}

async function runAssignmentReminderSweep() {
  if (!TODO_NOTIFICATIONS_RELEASED) {
    const expiredCount = await expirePendingAssignmentQueuesForRelease()
    return {
      ok: true,
      sentCount: 0,
      expiredCount
    }
  }

  const now = new Date()
  const pendingQueues = await getAllByWhere(COLLECTIONS.queue, {
    kind: 'todo_assignment_digest',
    status: 'pending'
  })
  let sentCount = 0

  console.log('[notifications] assignment sweep start', JSON.stringify({
    now: now.toISOString(),
    pendingCount: pendingQueues.length
  }))

  for (const queueDoc of pendingQueues) {
    console.log('[notifications] assignment sweep inspect', JSON.stringify({
      queueId: queueDoc._id,
      userId: queueDoc.userId,
      coupleId: queueDoc.coupleId,
      status: queueDoc.status,
      windowEnd: queueDoc.windowEnd
    }))

    if (new Date(queueDoc.windowEnd || 0).getTime() > now.getTime()) {
      console.log('[notifications] assignment sweep wait', JSON.stringify({
        queueId: queueDoc._id,
        reason: 'window_not_reached'
      }))
      continue
    }

    const couple = await findCoupleById(queueDoc.coupleId)

    if (!couple || couple.status !== 'paired') {
      console.warn('[notifications] assignment sweep expire', JSON.stringify({
        queueId: queueDoc._id,
        reason: 'couple_unavailable'
      }))
      await updateQueueDoc(queueDoc._id, {
        status: 'expired',
        errorMessage: '共享空间不可用'
      })
      continue
    }

    const preferences = mapPreferencesDoc(await getPreferenceDoc(queueDoc.coupleId, queueDoc.userId), queueDoc.coupleId, queueDoc.userId)
    if (!preferences.todoAssignmentWanted || !preferences.todoAssignmentArmed) {
      console.warn('[notifications] assignment sweep expire', JSON.stringify({
        queueId: queueDoc._id,
        reason: 'preference_not_armed'
      }))
      await updateQueueDoc(queueDoc._id, {
        status: 'expired',
        errorMessage: '分配提醒未准备好'
      })
      continue
    }

    if (!preferences.todoAssignmentTemplateConfigured) {
      console.warn('[notifications] assignment sweep fail', JSON.stringify({
        queueId: queueDoc._id,
        reason: 'template_not_configured'
      }))
      await updateQueueDoc(queueDoc._id, {
        status: 'failed',
        errorMessage: '分配提醒模板未配置'
      })
      continue
    }

    const todos = (await fetchTodosByIds(queueDoc.itemIds || []))
      .filter((item) => item.coupleId === queueDoc.coupleId && item.assigneeUserId === queueDoc.userId && item.status === 'open')

    if (!todos.length) {
      console.warn('[notifications] assignment sweep expire', JSON.stringify({
        queueId: queueDoc._id,
        reason: 'no_open_todos'
      }))
      await updateQueueDoc(queueDoc._id, {
        status: 'expired',
        errorMessage: '没有可提醒的待办'
      })
      continue
    }

    const deliveryKey = `todo_assignment_digest:${queueDoc._id}:${queueDoc.userId}`
    const existing = await getDeliveryDoc(deliveryKey)
    if (existing && existing.status === 'sent') {
      console.log('[notifications] assignment sweep dedupe', JSON.stringify({
        queueId: queueDoc._id,
        deliveryKey
      }))
      await updateQueueDoc(queueDoc._id, {
        status: 'sent',
        errorMessage: ''
      })
      continue
    }

    if (existing && existing.status === 'failed' && String(existing.errorMessage || '').indexOf('不能更新_id的值') >= 0) {
      console.warn('[notifications] assignment sweep recover sent', JSON.stringify({
        queueId: queueDoc._id,
        deliveryKey,
        reason: 'legacy_delivery_update_bug'
      }))
      await markDelivery(deliveryKey, {
        kind: 'todo_assignment_digest',
        coupleId: queueDoc.coupleId,
        userId: queueDoc.userId,
        targetId: queueDoc._id,
        status: 'sent',
        sentAt: existing.sentAt || nowIso(),
        errorMessage: ''
      })
      await updateQueueDoc(queueDoc._id, {
        status: 'sent',
        errorMessage: ''
      })
      await upsertPreferenceDoc(queueDoc.coupleId, queueDoc.userId, {
        todoAssignmentWanted: true,
        todoAssignmentArmed: false
      })
      sentCount += 1
      continue
    }

    try {
      await sendSubscribeMessage(
        queueDoc.userId,
        preferences.todoAssignmentTemplateId,
        buildTodoPage(queueDoc.latestItemId || todos[0]._id, 'assigned_to_me'),
        buildAssignmentDigestPayload(queueDoc, todos)
      )

      await markDelivery(deliveryKey, {
        kind: 'todo_assignment_digest',
        coupleId: queueDoc.coupleId,
        userId: queueDoc.userId,
        targetId: queueDoc._id,
        status: 'sent',
        sentAt: nowIso(),
        errorMessage: ''
      })
      await updateQueueDoc(queueDoc._id, {
        status: 'sent',
        errorMessage: ''
      })
      await upsertPreferenceDoc(queueDoc.coupleId, queueDoc.userId, {
        todoAssignmentWanted: true,
        todoAssignmentArmed: false
      })
      console.log('[notifications] assignment sweep sent', JSON.stringify({
        queueId: queueDoc._id,
        deliveryKey,
        todoCount: todos.length
      }))
      sentCount += 1
    } catch (error) {
      console.error('[notifications] assignment sweep send failed', JSON.stringify({
        queueId: queueDoc._id,
        deliveryKey,
        message: error && error.message ? error.message : 'send failed'
      }))
      await markDelivery(deliveryKey, {
        kind: 'todo_assignment_digest',
        coupleId: queueDoc.coupleId,
        userId: queueDoc.userId,
        targetId: queueDoc._id,
        status: 'failed',
        sentAt: '',
        errorMessage: error && error.message ? error.message : 'send failed'
      })
      await updateQueueDoc(queueDoc._id, {
        status: 'failed',
        errorMessage: error && error.message ? error.message : '分配提醒发送失败'
      })
    }
  }

  return {
    ok: true,
    sentCount
  }
}

async function runDueReminderSweep() {
  if (!TODO_NOTIFICATIONS_RELEASED) {
    return {
      ok: true,
      sentCount: 0
    }
  }

  const todayKey = toDateKey(new Date())
  const preferences = await getAllByWhere(COLLECTIONS.preferences, {
    todoDueWanted: true
  })
  let sentCount = 0

  for (const preferenceDoc of preferences) {
    const preference = mapPreferencesDoc(preferenceDoc, preferenceDoc.coupleId, preferenceDoc.userId)

    if (!preference.todoDueWanted || !preference.todoDueArmed || !preference.userId || !preference.coupleId) {
      continue
    }

    if (!preference.todoDueTemplateConfigured) {
      continue
    }

    const couple = await findCoupleById(preference.coupleId)

    if (!couple || couple.status !== 'paired') {
      continue
    }

    const todos = await getAllByWhere(COLLECTIONS.todos, {
      coupleId: preference.coupleId,
      assigneeUserId: preference.userId,
      dueAt: todayKey,
      status: 'open'
    })

    if (!todos.length) {
      continue
    }

    const deliveryKey = `todo_due_digest:${todayKey}:${preference.userId}`
    const existing = await getDeliveryDoc(deliveryKey)

    if (existing && existing.status === 'sent') {
      continue
    }

    try {
      const sortedTodos = todos
        .slice()
        .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())
      const latestTodo = sortedTodos[0] || null

      await sendSubscribeMessage(
        preference.userId,
        preference.todoDueTemplateId,
        buildTodoPage(latestTodo ? latestTodo._id : '', 'due_today'),
        buildDueDigestPayload(todos)
      )

      await markDelivery(deliveryKey, {
        kind: 'todo_due_digest',
        coupleId: preference.coupleId,
        userId: preference.userId,
        targetId: latestTodo ? latestTodo._id : '',
        dueAt: todayKey,
        status: 'sent',
        sentAt: nowIso(),
        errorMessage: ''
      })
      await upsertPreferenceDoc(preference.coupleId, preference.userId, {
        todoDueWanted: true,
        todoDueArmed: false
      })
      sentCount += 1
    } catch (error) {
      await markDelivery(deliveryKey, {
        kind: 'todo_due_digest',
        coupleId: preference.coupleId,
        userId: preference.userId,
        targetId: '',
        dueAt: todayKey,
        status: 'failed',
        sentAt: '',
        errorMessage: error && error.message ? error.message : 'send failed'
      })
    }
  }

  return {
    ok: true,
    sentCount
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const action = detectAction(event)

  console.log('[notifications] action start', JSON.stringify({
    action,
    openid: OPENID || '',
    triggerName: event.TriggerName || event.triggerName || event.name || ''
  }))

  try {
    if (action === 'updatePreferences') {
      return await updatePreferences(OPENID, event.payload || {})
    }

    if (action === 'queueTodoAssignment') {
      return await queueTodoAssignment(event.payload || {})
    }

    if (action === 'runAssignmentReminderSweep') {
      return await runAssignmentReminderSweep()
    }

    if (action === 'runDueReminderSweep') {
      return await runDueReminderSweep()
    }

    return await getPreferences(OPENID)
  } catch (error) {
    console.error('[notifications] failed', action, error)
    return {
      ok: false,
      message: error && error.message ? error.message : '提醒请求失败'
    }
  }
}
