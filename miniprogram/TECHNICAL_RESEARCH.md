# 情侣空间微信小程序 - 技术调研文档

## 技术栈概述

### 核心技术
- **微信小程序框架** - 原生小程序开发
- **微信云开发** - 后端服务和数据库
- **WXML + WXSS + JavaScript** - 前端技术栈

### 开发环境
- 微信开发者工具
- Node.js (可选，用于构建工具)
- Git (版本控制)

## 云开发配置

### 环境准备
1. 在微信公众平台注册小程序
2. 开通云开发服务
3. 创建云环境
4. 获取环境ID

### 数据库设计

#### 用户表 (users)
```javascript
{
  _id: "user_123",           // 用户ID
  openid: "wx_openid_123",   // 微信OpenID
  nickName: "小明",          // 昵称
  avatarUrl: "https://...",  // 头像URL
  gender: 1,                 // 性别 (0:未知,1:男,2:女)
  city: "北京",              // 城市
  createdAt: "2026-03-27",   // 创建时间
  updatedAt: "2026-03-27"    // 更新时间
}
```

#### 情侣空间表 (couples)
```javascript
{
  _id: "couple_123",         // 空间ID
  inviteCode: "LOVE2026",    // 邀请码(8位)
  creatorId: "user_123",     // 创建者ID
  partnerId: "user_456",     // 伴侣ID(可选)
  status: "active",          // 状态: pending/active
  createdAt: "2026-03-27",   // 创建时间
  joinedAt: "2026-03-28",    // 加入时间(可选)
}
```

#### 待办事项表 (todos)
```javascript
{
  _id: "todo_123",           // 待办ID
  coupleId: "couple_123",    // 所属空间ID
  title: "看电影",           // 标题
  description: "周末一起看电影", // 描述
  completed: false,          // 完成状态
  completedBy: null,         // 完成者ID
  completedAt: null,         // 完成时间
  createdAt: "2026-03-27",   // 创建时间
  createdBy: "user_123"      // 创建者ID
}
```

#### 照片表 (photos)
```javascript
{
  _id: "photo_123",          // 照片ID
  coupleId: "couple_123",    // 所属空间ID
  fileId: "cloud://...",     // 云文件ID
  url: "https://...",        // 访问URL
  title: "海边日落",         // 标题
  description: "第一次一起看海", // 描述
  uploaderId: "user_123",    // 上传者ID
  uploadedAt: "2026-03-27",  // 上传时间
  tags: ["海边", "日落"],    // 标签
  likes: 0,                  // 点赞数
  comments: []               // 评论列表
}
```

#### 纪念日表 (anniversaries)
```javascript
{
  _id: "anniversary_123",    // 纪念日ID
  coupleId: "couple_123",    // 所属空间ID
  title: "相识100天",        // 标题
  date: "2026-03-27",        // 日期
  type: "custom",            // 类型: first_meet/birthday/custom
  createdAt: "2026-03-27",   // 创建时间
  createdBy: "user_123"      // 创建者ID
}
```

#### 活动记录表 (activities)
```javascript
{
  _id: "activity_123",       // 活动ID
  coupleId: "couple_123",    // 所属空间ID
  type: "photo_upload",      // 类型: todo_complete/photo_upload/anniversary/create_couple/join_couple
  userId: "user_123",        // 用户ID
  targetId: "photo_123",     // 目标ID(可选)
  title: "上传了新照片",      // 标题
  content: "海边日落",       // 内容
  timestamp: "2026-03-27 14:30:00" // 时间戳
}
```

## 云函数设计

### 用户相关
1. `getUserInfo` - 获取用户信息
2. `updateUserInfo` - 更新用户信息
3. `checkUserStatus` - 检查用户状态

### 情侣空间相关
1. `createCoupleSpace` - 创建情侣空间
2. `joinCoupleSpace` - 加入情侣空间
3. `leaveCoupleSpace` - 离开情侣空间
4. `getCoupleInfo` - 获取空间信息
5. `generateInviteCode` - 生成邀请码
6. `validateInviteCode` - 验证邀请码

### 待办事项相关
1. `createTodo` - 创建待办
2. `completeTodo` - 完成待办
3. `deleteTodo` - 删除待办
4. `getTodos` - 获取待办列表
5. `updateTodo` - 更新待办

### 照片相关
1. `uploadPhoto` - 上传照片
2. `deletePhoto` - 删除照片
3. `getPhotos` - 获取照片列表
4. `updatePhotoInfo` - 更新照片信息
5. `likePhoto` - 点赞照片

### 纪念日相关
1. `createAnniversary` - 创建纪念日
2. `deleteAnniversary` - 删除纪念日
3. `getAnniversaries` - 获取纪念日列表
4. `updateAnniversary` - 更新纪念日

### 活动记录相关
1. `recordActivity` - 记录活动
2. `getActivities` - 获取活动记录
3. `clearOldActivities` - 清理旧活动

## 前端架构

### 页面结构
```
miniprogram/
├── app.js              # 小程序入口
├── app.json            # 全局配置
├── app.wxss            # 全局样式
├── pages/              # 页面目录
│   ├── home/           # 首页
│   ├── timeline/       # 时间线
│   ├── photos/         # 照片
│   └── profile/        # 个人资料
└── components/         # 公共组件(预留)
```

### 数据流管理
1. **全局数据** - `app.globalData`
   - 用户信息
   - 情侣空间状态
   - 登录状态

2. **页面数据** - `Page.data`
   - 当前页面状态
   - 列表数据
   - 用户输入

3. **本地缓存** - `wx.setStorage/wx.getStorage`
   - 用户偏好设置
   - 离线数据
   - 临时状态

### 状态管理策略
- 使用小程序原生的数据绑定
- 页面间通信通过全局数据或URL参数
- 复杂状态使用自定义事件

## 性能优化

### 图片优化
1. **图片压缩** - 上传前压缩图片
2. **懒加载** - 滚动时加载可见图片
3. **CDN加速** - 使用云存储CDN
4. **格式选择** - 根据场景选择WebP/JPEG

### 数据优化
1. **分页加载** - 列表数据分页请求
2. **数据缓存** - 频繁访问数据本地缓存
3. **请求合并** - 批量数据请求
4. **防抖节流** - 用户操作频率控制

### 渲染优化
1. **虚拟列表** - 长列表使用虚拟滚动
2. **按需渲染** - 条件渲染避免不必要的DOM
3. **CSS优化** - 减少重绘和回流
4. **动画优化** - 使用CSS动画替代JS动画

## 安全考虑

### 数据安全
1. **权限验证** - 所有云函数添加权限验证
2. **数据过滤** - 输入数据验证和过滤
3. **敏感信息** - 不存储敏感用户信息
4. **访问控制** - 情侣数据隔离访问

### 接口安全
1. **参数校验** - 所有接口参数验证
2. **频率限制** - API调用频率限制
3. **错误处理** - 统一的错误响应
4. **日志记录** - 关键操作日志记录

## 测试策略

### 单元测试
1. **工具选择** - 使用微信小程序测试框架
2. **测试范围** - 核心业务逻辑测试
3. **Mock数据** - 模拟云函数和API调用

### 集成测试
1. **页面测试** - 页面流程测试
2. **数据流测试** - 数据同步测试
3. **跨页面测试** - 页面间交互测试

### 性能测试
1. **加载测试** - 页面加载性能测试
2. **内存测试** - 内存使用情况测试
3. **网络测试** - 不同网络环境测试

## 部署和发布

### 开发流程
1. **本地开发** - 微信开发者工具
2. **代码提交** - Git版本控制
3. **代码审查** - Pull Request流程

### 测试环境
1. **体验版** - 内部测试版本
2. **A/B测试** - 新功能灰度发布
3. **用户反馈** - 收集用户反馈

### 生产发布
1. **版本管理** - 语义化版本控制
2. **更新日志** - 详细的更新说明
3. **回滚计划** - 紧急问题回滚方案

## 监控和运维

### 性能监控
1. **错误监控** - 收集运行时错误
2. **性能监控** - 页面加载性能监控
3. **用户行为** - 关键用户行为分析

### 业务监控
1. **用户增长** - 新增用户和活跃用户
2. **功能使用** - 各功能使用频率
3. **错误率** - 接口错误率监控

### 告警机制
1. **错误告警** - 关键错误实时告警
2. **性能告警** - 性能指标异常告警
3. **业务告警** - 业务数据异常告警

## 扩展性考虑

### 技术债务管理
1. **代码规范** - 统一的代码规范
2. **文档更新** - 代码和文档同步更新
3. **重构计划** - 定期技术重构

### 架构演进
1. **微服务化** - 复杂功能微服务化
2. **组件化** - UI组件抽象和复用
3. **插件化** - 功能模块插件化设计

---
*文档版本: 1.0*
*最后更新: 2026-03-27*
*创建者: Claude Code*