# ✅ 一切就绪！

## 已完成

✅ discord.py 2.6.4 已安装（虚拟环境）
✅ 配置文件已验证
✅ 角色卡已加载：科瓦奇
✅ Agent 目录结构已创建：`~/.homunculus/agents/kovach/`
✅ Bot token 已配置
✅ Anthropic API key 已配置
✅ QMD 已就绪：`/home/joexu/.cache/.bun/bin/qmd`

## 启动前检查清单

### 1. 确认 Discord Bot 设置

去 https://discord.com/developers/applications 检查你的 bot：

- [ ] **Message Content Intent** 已启用（Bot → Privileged Gateway Intents）
- [ ] Bot 已被邀请到服务器
- [ ] Bot 有 `Send Messages` 和 `Read Message History` 权限

### 2. 启动 Homunculus

```bash
cd /home/joexu/Repos/Homunculus
./START.sh
```

你应该看到：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Homunculus - TTRPG NPC Agent
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NPC: 科瓦奇 (Kovach)
  Channel: 1472783663077785722
  Model: claude-sonnet-4-5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INFO homunculus.factory Loading character card from examples/kovach/character-card.json
INFO homunculus.discord.client Discord client connected as [YourBotName]
INFO homunculus.discord.client Target channel acquired: your-channel-name
INFO homunculus.runtime Runtime started for NPC 'kovach' (channel_id=1472783663077785722).
```

### 3. 测试

在 Discord 频道 `1472783663077785722` 中：

```
@科瓦奇 你好，你是谁？
```

科瓦奇应该会以退伍军人的口吻回复你！

## 故障排除

### Bot 不响应

1. 检查日志中是否有 "Discord client connected"
2. 确认 Message Content Intent 已启用
3. 尝试 @提及 bot 的确切名字

### "Target channel not found"

- 检查 channel ID 是否正确
- 确认 bot 在该服务器中
- 检查 bot 是否有 View Channels 权限

### QMD 错误

如果看到 qmd 相关错误：
```bash
/home/joexu/.cache/.bun/bin/qmd --version
```

应该显示版本号。

### 内存相关

首次运行时，记忆检索可能返回空结果（正常）。
对话几轮后，检查：
```bash
ls -la ~/.homunculus/agents/kovach/memory/
```

应该能看到日期命名的 .md 文件。

## 停止

按 `Ctrl+C` 优雅关闭。

## 下一步

- 跑几轮对话测试记忆系统
- 检查 `~/.homunculus/agents/kovach/memory/*.md` 看记忆提取
- 如果一切正常，部署更多 NPC！

---

需要帮助？查看 `/home/joexu/Repos/Homunculus/docs/QUICKSTART.md`
