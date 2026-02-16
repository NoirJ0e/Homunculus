# 安装说明

## 当前状态

✅ 配置文件已准备好
✅ 角色卡已加载测试
✅ Bot token 已配置
✅ Anthropic API key 已配置

❌ **缺少依赖**: discord.py

## 需要安装 discord.py

由于系统 Python 环境受限，你需要以下方式之一：

### 选项 1: 使用 pacman（推荐）

```bash
sudo pacman -S python-discord.py
```

### 选项 2: 使用虚拟环境

```bash
cd /home/joexu/Repos/Homunculus
python3 -m venv venv
source venv/bin/activate
pip install discord.py
```

然后修改 `START.sh` 第一行为：
```bash
source /home/joexu/Repos/Homunculus/venv/bin/activate
```

### 选项 3: 手动下载

```bash
mkdir -p ~/python-libs
cd ~/python-libs
git clone https://github.com/Rapptz/discord.py
export PYTHONPATH=~/python-libs/discord.py:$PYTHONPATH
```

## 安装完成后

```bash
cd /home/joexu/Repos/Homunculus
./START.sh
```

## 验证 Discord bot

1. 去 Discord 开发者门户：https://discord.com/developers/applications
2. 找到你的 bot（使用 token `PayyVqwCYuyVRs67a8F2f06fM-0kDTxy` 的那个）
3. 确认 **Message Content Intent** 已启用
4. 邀请 bot 到服务器（如果还没有）

## 测试

启动后，在 Discord 频道 `1472783663077785722` 中发送：

```
@科瓦奇 你好
```

应该会收到科瓦奇的回复！
