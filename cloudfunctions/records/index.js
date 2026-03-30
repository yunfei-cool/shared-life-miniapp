const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const ACTIVE_STATUSES = ['invited', 'paired']
const COLLECTIONS = {
  couples: 'couples',
  expenses: 'expenses',
  todos: 'todos',
  anniversaries: 'anniversaries',
  workouts: 'workouts',
  activity: 'activity_feed'
}

const EXPENSE_CATEGORIES = [
  { key: 'dining', label: '餐饮' },
  { key: 'transport', label: '出行' },
  { key: 'daily', label: '日用' },
  { key: 'gift', label: '礼物' },
  { key: 'rent', label: '房租' }
]

const WORKOUT_TYPES = [
  { key: 'run', label: '跑步' },
  { key: 'strength', label: '力量' },
  { key: 'walk', label: '步行' },
  { key: 'yoga', label: '瑜伽' },
  { key: 'cycling', label: '骑行' },
  { key: 'other', label: '其他' }
]

function nowIso() {
  return new Date().toISOString()
}

function startOfDay(date) {
  const next = new Date(date.getTime())
  next.setHours(0, 0, 0, 0)
  return next
}

function toDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parseDateKey(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function formatCurrency(amountCents) {
  const amount = amountCents / 100
  const hasDecimals = amountCents % 100 !== 0
  return `￥${amount.toFixed(hasDecimals ? 2 : 0)}`
}

function formatActivityAmount(amountCents) {
  const amount = amountCents / 100
  return amountCents % 100 === 0 ? amount.toFixed(0) : amount.toFixed(2)
}

function normalizeRelationshipTitle(title) {
  const normalized = String(title || '在一起')
    .replace(/\s+/g, '')
    .replace(/([一二三四五六七八九十\d]+周年|周年|纪念日)$/g, '')

  return normalized || '在一起'
}

async function listActiveCouplesByField(field, openid) {
  const result = await db.collection(COLLECTIONS.couples).where({
    [field]: openid,
    status: _.in(ACTIVE_STATUSES)
  }).get()

  return result.data || []
}

async function findActiveCouple(openid) {
  const [created, joined] = await Promise.all([
    listActiveCouplesByField('creatorUserId', openid),
    listActiveCouplesByField('partnerUserId', openid)
  ])

  return created
    .concat(joined)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())[0] || null
}

function getPartnerUserId(couple, openid) {
  if (!couple) {
    return null
  }

  if (couple.creatorUserId === openid) {
    return couple.partnerUserId || null
  }

  return couple.creatorUserId || null
}

function requirePairedCouple(couple) {
  if (!couple || couple.status !== 'paired') {
    throw new Error('共享空间还没连接完成')
  }
}

async function getAllByCouple(collectionName, coupleId) {
  const collection = db.collection(collectionName)
  const items = []
  let skip = 0
  const limit = 100

  while (true) {
    const result = await collection.where({
      coupleId
    }).skip(skip).limit(limit).get()
    const chunk = result.data || []
    items.push(...chunk)

    if (chunk.length < limit) {
      break
    }

    skip += chunk.length
  }

  return items
}

function mapExpenseDoc(item) {
  return {
    id: item._id,
    categoryKey: item.categoryKey,
    categoryLabel: item.categoryLabel,
    amountCents: item.amountCents,
    ownerScope: item.ownerScope,
    ownerUserId: item.ownerUserId || null,
    note: item.note || '',
    occurredOn: item.occurredOn,
    createdBy: item.createdBy || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}

function mapTodoDoc(item) {
  return {
    id: item._id,
    title: item.title,
    note: item.note || '',
    assigneeUserId: item.assigneeUserId || null,
    dueAt: item.dueAt || '',
    status: item.status || 'open',
    completedBy: item.completedBy || null,
    completedAt: item.completedAt || null,
    createdBy: item.createdBy || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}

function mapAnniversaryDoc(item) {
  return {
    id: item._id,
    title: item.title,
    date: item.date,
    type: item.type,
    linkedTodoId: item.linkedTodoId || null,
    note: item.note || '',
    createdBy: item.createdBy || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}

function mapWorkoutDoc(item) {
  return {
    id: item._id,
    typeKey: item.typeKey,
    typeLabel: item.typeLabel,
    durationMinutes: item.durationMinutes,
    occurredOn: item.occurredOn,
    note: item.note || '',
    userId: item.userId,
    createdBy: item.createdBy || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}

function mapActivityDoc(item) {
  return {
    id: item._id,
    type: item.type,
    actorUserId: item.actorUserId || null,
    targetId: item.targetId || '',
    title: item.title,
    summary: item.summary || '',
    amountCents: typeof item.amountCents === 'number' ? item.amountCents : null,
    ownerScope: item.ownerScope || '',
    ownerUserId: item.ownerUserId || null,
    categoryLabel: item.categoryLabel || '',
    note: item.note || '',
    itemTitle: item.itemTitle || '',
    createdAt: item.createdAt
  }
}

async function buildStore(coupleId) {
  const [expenses, todos, anniversaries, workouts, activities] = await Promise.all([
    getAllByCouple(COLLECTIONS.expenses, coupleId),
    getAllByCouple(COLLECTIONS.todos, coupleId),
    getAllByCouple(COLLECTIONS.anniversaries, coupleId),
    getAllByCouple(COLLECTIONS.workouts, coupleId),
    getAllByCouple(COLLECTIONS.activity, coupleId)
  ])

  return {
    expenses: expenses.map(mapExpenseDoc),
    todos: todos.map(mapTodoDoc),
    anniversaries: anniversaries.map(mapAnniversaryDoc),
    workouts: workouts.map(mapWorkoutDoc),
    activities: activities.map(mapActivityDoc)
  }
}

async function appendActivity(coupleId, activity) {
  await db.collection(COLLECTIONS.activity).add({
    data: Object.assign({
      coupleId,
      createdAt: nowIso()
    }, activity)
  })
}

function parseAmountInput(amountInput) {
  const amount = Number(String(amountInput).trim())

  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  return Math.round(amount * 100)
}

function normalizeOwnerChoice(choice, couple, openid) {
  if (choice === 'me') {
    return {
      ownerScope: 'personal',
      ownerUserId: openid
    }
  }

  if (choice === 'partner') {
    return {
      ownerScope: 'personal',
      ownerUserId: getPartnerUserId(couple, openid)
    }
  }

  return {
    ownerScope: 'shared',
    ownerUserId: null
  }
}

function normalizeAssigneeChoice(choice, couple, openid) {
  if (choice === 'me') {
    return openid
  }

  if (choice === 'partner') {
    return getPartnerUserId(couple, openid)
  }

  return null
}

function validateTodoPayload(payload = {}) {
  const title = String(payload.title || '').trim()
  const dueAt = String(payload.dueAt || '').trim()

  if (!title) {
    return {
      ok: false,
      message: '待办标题不能为空'
    }
  }

  if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
    return {
      ok: false,
      message: '截止日期请按 YYYY-MM-DD 输入，或者留空'
    }
  }

  return {
    ok: true,
    title,
    dueAt
  }
}

function validateAnniversaryPayload(payload = {}) {
  const kind = payload.kind === 'relationship' ? 'relationship' : 'custom'
  const title = String(payload.title || '').trim()
  const date = String(payload.date || '').trim()

  if (kind === 'custom' && !title) {
    return {
      ok: false,
      message: '纪念日名称不能为空'
    }
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      ok: false,
      message: '请按 YYYY-MM-DD 输入日期'
    }
  }

  return {
    ok: true,
    kind,
    title,
    date
  }
}

function validateWorkoutPayload(payload = {}) {
  const workoutType = WORKOUT_TYPES.find((item) => item.key === payload.typeKey) || WORKOUT_TYPES[0]
  const durationMinutes = Number(String(payload.durationMinutes || '').trim())
  const occurredOn = String(payload.occurredOn || '').trim()

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return {
      ok: false,
      message: '请输入有效时长'
    }
  }

  if (!occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    return {
      ok: false,
      message: '请选择运动日期'
    }
  }

  return {
    ok: true,
    typeKey: workoutType.key,
    typeLabel: workoutType.label,
    durationMinutes: Math.round(durationMinutes),
    occurredOn
  }
}

async function fetchDoc(collectionName, id, notFoundMessage, coupleId = '') {
  try {
    const result = await db.collection(collectionName).doc(id).get()
    const data = result.data

    if (coupleId && data.coupleId !== coupleId) {
      throw new Error(notFoundMessage)
    }

    return data
  } catch (error) {
    throw new Error(notFoundMessage)
  }
}

async function syncAnniversaryPrepTodo(coupleId, anniversary, prepTodoTitle, openid) {
  const nextTitle = String(prepTodoTitle || '').trim()
  const now = nowIso()
  const linkedTodoId = anniversary.linkedTodoId || null

  if (!nextTitle) {
    if (linkedTodoId) {
      await db.collection(COLLECTIONS.todos).doc(linkedTodoId).remove().catch(() => null)
    }

    return null
  }

  if (linkedTodoId) {
    await db.collection(COLLECTIONS.todos).doc(linkedTodoId).update({
      data: {
        title: nextTitle,
        updatedAt: now
      }
    })
    return linkedTodoId
  }

  const result = await db.collection(COLLECTIONS.todos).add({
    data: {
      coupleId,
      title: nextTitle,
      note: '',
      assigneeUserId: null,
      dueAt: '',
      status: 'open',
      completedBy: null,
      completedAt: null,
      createdBy: openid,
      createdAt: now,
      updatedAt: now
    }
  })

  return result._id
}

async function listRecords(openid) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  return {
    ok: true,
    viewerUserId: openid,
    store: await buildStore(couple._id)
  }
}

async function createExpense(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  const amountCents = parseAmountInput(payload.amount)

  if (!amountCents) {
    return {
      ok: false,
      message: '请输入有效金额'
    }
  }

  const category = EXPENSE_CATEGORIES.find((item) => item.key === payload.categoryKey) || EXPENSE_CATEGORIES[0]
  const owner = normalizeOwnerChoice(payload.ownerChoice, couple, openid)
  const now = nowIso()
  const created = await db.collection(COLLECTIONS.expenses).add({
    data: {
      coupleId: couple._id,
      categoryKey: category.key,
      categoryLabel: category.label,
      amountCents,
      ownerScope: owner.ownerScope,
      ownerUserId: owner.ownerUserId,
      note: payload.note || '',
      occurredOn: payload.occurredOn || toDateKey(new Date()),
      createdBy: openid,
      createdAt: now,
      updatedAt: now
    }
  })

  await appendActivity(couple._id, {
    type: 'expense_created',
    actorUserId: openid,
    targetId: created._id,
    title: '新增账单',
    summary: `${category.label}${payload.note ? ` · ${payload.note}` : ''}`,
    amountCents,
    ownerScope: owner.ownerScope,
    ownerUserId: owner.ownerUserId,
    categoryLabel: category.label,
    note: payload.note || '',
    itemTitle: `${formatActivityAmount(amountCents)} 元`
  })

  return {
    ok: true
  }
}

async function updateExpense(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  const expense = await fetchDoc(COLLECTIONS.expenses, payload.id, '没有找到这笔账单', couple._id)
  const amountCents = parseAmountInput(payload.amount)

  if (!amountCents) {
    return {
      ok: false,
      message: '请输入有效金额'
    }
  }

  const category = EXPENSE_CATEGORIES.find((item) => item.key === payload.categoryKey) || EXPENSE_CATEGORIES[0]
  const owner = normalizeOwnerChoice(payload.ownerChoice, couple, openid)

  await db.collection(COLLECTIONS.expenses).doc(expense._id).update({
    data: {
      categoryKey: category.key,
      categoryLabel: category.label,
      amountCents,
      ownerScope: owner.ownerScope,
      ownerUserId: owner.ownerUserId,
      note: payload.note || '',
      occurredOn: payload.occurredOn || expense.occurredOn,
      updatedAt: nowIso()
    }
  })

  return {
    ok: true
  }
}

async function deleteExpense(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  await fetchDoc(COLLECTIONS.expenses, payload.id, '没有找到这笔账单', couple._id)
  await db.collection(COLLECTIONS.expenses).doc(payload.id).remove()
  return {
    ok: true
  }
}

async function createTodo(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  const validation = validateTodoPayload(payload)

  if (!validation.ok) {
    return validation
  }

  const now = nowIso()
  const created = await db.collection(COLLECTIONS.todos).add({
    data: {
      coupleId: couple._id,
      title: validation.title,
      note: payload.note || '',
      assigneeUserId: normalizeAssigneeChoice(payload.assigneeChoice, couple, openid),
      dueAt: validation.dueAt,
      status: 'open',
      completedBy: null,
      completedAt: null,
      createdBy: openid,
      createdAt: now,
      updatedAt: now
    }
  })

  await appendActivity(couple._id, {
    type: 'todo_created',
    actorUserId: openid,
    targetId: created._id,
    title: '新增待办',
    summary: validation.title,
    itemTitle: validation.title
  })

  return {
    ok: true
  }
}

async function updateTodo(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  const existingTodo = await fetchDoc(COLLECTIONS.todos, payload.id, '没有找到这条待办', couple._id)
  const validation = validateTodoPayload(payload)

  if (!validation.ok) {
    return validation
  }

  const nextAssigneeUserId = normalizeAssigneeChoice(payload.assigneeChoice, couple, openid)

  await db.collection(COLLECTIONS.todos).doc(payload.id).update({
    data: {
      title: validation.title,
      note: payload.note || '',
      assigneeUserId: nextAssigneeUserId,
      dueAt: validation.dueAt,
      updatedAt: nowIso()
    }
  })

  return {
    ok: true
  }
}

async function deleteTodo(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  await fetchDoc(COLLECTIONS.todos, payload.id, '没有找到这条待办', couple._id)
  await db.collection(COLLECTIONS.todos).doc(payload.id).remove()
  await db.collection(COLLECTIONS.anniversaries).where({
    coupleId: couple._id,
    linkedTodoId: payload.id
  }).update({
    data: {
      linkedTodoId: null,
      updatedAt: nowIso()
    }
  })

  return {
    ok: true
  }
}

async function toggleTodo(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  const todo = await fetchDoc(COLLECTIONS.todos, payload.id, '没有找到这条待办', couple._id)
  const nextStatus = todo.status === 'completed' ? 'open' : 'completed'
  const now = nowIso()

  await db.collection(COLLECTIONS.todos).doc(todo._id).update({
    data: {
      status: nextStatus,
      completedBy: nextStatus === 'completed' ? openid : null,
      completedAt: nextStatus === 'completed' ? now : null,
      updatedAt: now
    }
  })

  if (nextStatus === 'completed') {
    await appendActivity(couple._id, {
      type: 'todo_completed',
      actorUserId: openid,
      targetId: todo._id,
      title: '已完成待办',
      summary: todo.title,
      itemTitle: todo.title
    })
  }

  return {
    ok: true
  }
}

async function createAnniversary(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  const validation = validateAnniversaryPayload(payload)

  if (!validation.ok) {
    return validation
  }

  const now = nowIso()
  const created = await db.collection(COLLECTIONS.anniversaries).add({
    data: {
      coupleId: couple._id,
      title: validation.kind === 'relationship' ? normalizeRelationshipTitle(validation.title || '在一起') : validation.title,
      date: validation.date,
      type: validation.kind,
      linkedTodoId: null,
      note: payload.note || '',
      createdBy: openid,
      createdAt: now,
      updatedAt: now
    }
  })
  const anniversary = await fetchDoc(COLLECTIONS.anniversaries, created._id, '没有找到这个纪念日', couple._id)
  const linkedTodoId = await syncAnniversaryPrepTodo(couple._id, anniversary, payload.prepTodoTitle, openid)

  if (linkedTodoId) {
    await db.collection(COLLECTIONS.anniversaries).doc(created._id).update({
      data: {
        linkedTodoId,
        updatedAt: nowIso()
      }
    })
  }

  await appendActivity(couple._id, {
    type: 'anniversary_created',
    actorUserId: openid,
    targetId: created._id,
    title: '新增纪念日',
    summary: validation.kind === 'relationship' ? normalizeRelationshipTitle(validation.title || '在一起') : validation.title,
    itemTitle: validation.kind === 'relationship' ? normalizeRelationshipTitle(validation.title || '在一起') : validation.title
  })

  return {
    ok: true
  }
}

async function updateAnniversary(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  const anniversary = await fetchDoc(COLLECTIONS.anniversaries, payload.id, '没有找到这个纪念日', couple._id)
  const validation = validateAnniversaryPayload(payload)

  if (!validation.ok) {
    return validation
  }

  const linkedTodoId = await syncAnniversaryPrepTodo(couple._id, anniversary, payload.prepTodoTitle, openid)

  await db.collection(COLLECTIONS.anniversaries).doc(payload.id).update({
    data: {
      type: validation.kind,
      title: validation.kind === 'relationship' ? normalizeRelationshipTitle(validation.title || '在一起') : validation.title,
      date: validation.date,
      note: payload.note || '',
      linkedTodoId: linkedTodoId || null,
      updatedAt: nowIso()
    }
  })

  return {
    ok: true
  }
}

async function deleteAnniversary(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  await fetchDoc(COLLECTIONS.anniversaries, payload.id, '没有找到这个纪念日', couple._id)
  await db.collection(COLLECTIONS.anniversaries).doc(payload.id).remove()
  return {
    ok: true
  }
}

async function createWorkout(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const validation = validateWorkoutPayload(payload)

  if (!validation.ok) {
    return validation
  }

  const now = nowIso()
  const created = await db.collection(COLLECTIONS.workouts).add({
    data: {
      coupleId: couple._id,
      typeKey: validation.typeKey,
      typeLabel: validation.typeLabel,
      durationMinutes: validation.durationMinutes,
      occurredOn: validation.occurredOn,
      note: payload.note || '',
      userId: openid,
      createdBy: openid,
      createdAt: now,
      updatedAt: now
    }
  })

  await appendActivity(couple._id, {
    type: 'workout_created',
    actorUserId: openid,
    targetId: created._id,
    title: '记录了一次运动',
    summary: `${validation.typeLabel} · ${validation.durationMinutes} 分钟`,
    itemTitle: validation.typeLabel
  })

  return {
    ok: true
  }
}

async function updateWorkout(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const workout = await fetchDoc(COLLECTIONS.workouts, payload.id, '没有找到这条运动记录', couple._id)
  const validation = validateWorkoutPayload(payload)

  if (!validation.ok) {
    return validation
  }

  if (workout.userId !== openid) {
    return {
      ok: false,
      message: '只能编辑自己的运动记录'
    }
  }

  await db.collection(COLLECTIONS.workouts).doc(payload.id).update({
    data: {
      typeKey: validation.typeKey,
      typeLabel: validation.typeLabel,
      durationMinutes: validation.durationMinutes,
      occurredOn: validation.occurredOn,
      note: payload.note || '',
      updatedAt: nowIso()
    }
  })

  return {
    ok: true
  }
}

async function deleteWorkout(openid, payload) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const workout = await fetchDoc(COLLECTIONS.workouts, payload.id, '没有找到这条运动记录', couple._id)

  if (workout.userId !== openid) {
    return {
      ok: false,
      message: '只能删除自己的运动记录'
    }
  }

  await db.collection(COLLECTIONS.workouts).doc(payload.id).remove()
  return {
    ok: true
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'listRecords'
  const payload = event.payload || {}

  try {
    if (action === 'createExpense') {
      return await createExpense(OPENID, payload)
    }

    if (action === 'updateExpense') {
      return await updateExpense(OPENID, payload)
    }

    if (action === 'deleteExpense') {
      return await deleteExpense(OPENID, payload)
    }

    if (action === 'createTodo') {
      return await createTodo(OPENID, payload)
    }

    if (action === 'updateTodo') {
      return await updateTodo(OPENID, payload)
    }

    if (action === 'deleteTodo') {
      return await deleteTodo(OPENID, payload)
    }

    if (action === 'toggleTodo') {
      return await toggleTodo(OPENID, payload)
    }

    if (action === 'createAnniversary') {
      return await createAnniversary(OPENID, payload)
    }

    if (action === 'updateAnniversary') {
      return await updateAnniversary(OPENID, payload)
    }

    if (action === 'deleteAnniversary') {
      return await deleteAnniversary(OPENID, payload)
    }

    if (action === 'createWorkout') {
      return await createWorkout(OPENID, payload)
    }

    if (action === 'updateWorkout') {
      return await updateWorkout(OPENID, payload)
    }

    if (action === 'deleteWorkout') {
      return await deleteWorkout(OPENID, payload)
    }

    return await listRecords(OPENID)
  } catch (error) {
    console.error('[records] failed', action, error)
    return {
      ok: false,
      message: error && error.message ? error.message : '记录请求失败'
    }
  }
}
