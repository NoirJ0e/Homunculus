# Live 验收存档：live-realdm.ts 真 DM 自驱诊断

> **来源**：2026-06-09 在原开发机（remote）上运行 `scripts/live-realdm.ts` 的 step-trace 落盘
> （`data/headless/`，gitignored），2026-07-03 从该机器上找回后存档于此。
> **证明**：与 live-game.ts 互补——DM 不是脚本而是**真自驱 LLM**（`dmQueryStream`，
> extended thinking 可见）。6 分钟 78 条流消息：ToolSearch 加载 engine 工具 → narrate →
> 串行 nominate（每点一个立刻看见该角色的实际行动，Bug2「失明」已修）→ call_check →
> 下一轮该角色掷骰（d100 真结算）→ discover_lead ×3 → advance_milestone（m1→m2），
> 三个 NPC 各自独立人格回应（Bug1「共脑」已修）。
> **轮不变量实锤**：DM 试图同轮重复点名铁拳被引擎拒绝（「本轮已行动」），DM 自适应
> 将 pending 检定留到下轮结算——#52 的引擎兜底按设计生效。
> **已知瑕疵（见存档正文）**：① DM 把「林萱」叫成「林轩」（cast 只给 actorId
> `npc-linxuan`，显示名未入 DM prompt）；② CoC7 团里 DM 用了 D&D 式「DC 12」措辞
> （引擎正确按 roll-under 结算，无实害）。
> **对应 issue**：PRD #50 收尾诊断（commit ddc741c 的原始证据）。

---

# 真DM live 诊断 — 2026-06-09T18:42:14.234Z
pool=3

🟢 频道 #失书录-realdm-1781030534233 (1513976540726038558)
🟢 池 3 bots


===== 启动真 DM query =====
> 🧠 The user wants me to start hosting this tabletop RPG session. Let me first load the necessary MCP engine tools using ToolSearch, then begin the session with narrate, followed by nominate for each character.

Let me start by loading the engine tools I need.
🔧 ToolSearch({"query":"select:mcp__engine__narrate,mcp__engine__nominate,mcp__engine__advance_milestone,mcp__engine__discover_lead,mcp__engine__advance_clock,mcp__engine__call_check","max_results":6})
↩️ 
> 🧠 Now I have all the tools loaded. Let me start the session with a narrate for the opening scene, then nominate each character one by one.

The scene is: 白鹤阁茶馆密谈 (White Crane Pavilion teahouse secret meeting)
- A stolen nameless black book
- A dead book boy (书童)
- The three investigators are AI agents: npc-zhoushen, npc-tiequan, npc-linxuan

Let me craft an atmospheric opening narration in Chinese, …
🗣️ DM: 好的，开始主持。先发开场叙事。
🔧 mcp__engine__narrate({"sceneId":"1513976540726038558","prose":"\n午后的日头偏西，白鹤阁茶馆二楼包厢里透进一缕带尘的光柱，把桌上的茶烟切成两半。\n\n窗棂半掩，街市的叫卖声从底下浮上来，却在踏进这间包厢的瞬间便变得遥远——像是隔了一层水。包厢正中摆着一张八仙桌，桌面油光发亮，留着数不清的茶杯圆晕。角落的炭炉里红炭微明，铁壶发出低沉的嘶鸣。\n\n今日请诸位到此的，是古玩商曹…)
↩️ narrated → 1513976540726038558
> 🧠 Now I need to nominate the first character. Let me nominate `npc-zhoushen` first with an in-fiction cue.
🗣️ DM: 开场叙事已落。现在逐个点名，从第一位调查员开始。
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-zhoushen","desc":"周慎，你是第一个落座的——桌上那枚布帛裹着的蜡封就在你指尖两寸开外，书童死前托人转交的遗物。你怎么做？"})
↩️ npc-zhoushen：我没急着动那蜡封，先把它翻过来，对着光瞧了瞧封面有没有血迹或指甲抠过的痕迹——死前托人转交的东西，开之前得先弄清楚它究竟经过几双手。
还剩：npc-tiequan、npc-linxuan
> 🧠 Zhou Shen examined the wax seal carefully without opening it, checking for blood or fingernail marks. That's a good investigative action. No mechanical check needed for a basic visual examination. Now I need to nominate the next character: npc-tiequan.
🗣️ DM: 周慎翻看蜡封的动作清晰而克制，目光像在读一件档案。现在点第二位。
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-tiequan","desc":"铁拳，你人还没坐稳，包厢门缝里透进来的那股子气味就已经进了你的鼻子——茶香之外，隐隐有一丝烧焦的甜腥。你留意到这气味了吗，打算怎么办？"})
↩️ npc-tiequan：我猛地回头往门缝那头嗅了嗅，右手已经搭上了椅背——"甜腥味，烧过的——你们闻到没有？"
还剩：npc-linxuan
> 🧠 Iron Fist is alert to the strange sweet-burning smell. Good. Now nominate the last character: npc-linxuan.
🗣️ DM: 铁拳一嗅即警，声音压得很低却劈出了包厢里第一句话。最后一位。
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-linxuan","desc":"林轩，铁拳的话音未落，你注意到青花茶盏里那半杯残茶——茶汤的颜色比寻常龙井深了不止一个色号，杯底隐约有一圈细密的沉淀。这不像是泡久了的茶色。你怎么看？"})
↩️ npc-linxuan：我从袖口取出一块素帕，垫着茶盏边沿将它推近——低头对着那圈沉淀嗅了嗅，没有动它。

"先别喝茶。"
本轮已全部点完
> 🧠 All three characters have been nominated in this round. Now I need to do a narrate to collect what happened and advance the scene, then start the next round.

Summary of what happened:
1. 周慎 (Zhou Shen): Carefully examined the wax seal without opening it, checking for blood or fingernail marks — a methodical investigator.
2. 铁拳 (Tie Quan): Noticed a burnt sweet-bloody smell seeping from the door c…
🗣️ DM: 本轮全员已点完。收尾叙事，撒线索，进下一轮。
🔧 mcp__engine__narrate({"sceneId":"1513976540726038558","prose":"\n包厢里一瞬间安静下来。\n\n铁拳的那句话还悬在空气里，林轩已经把茶盏挡在众人前方，素帕隔着杯沿，像在保存一件证物。\n\n周慎将蜡封对着窗口斜光细看——布帛表面有三道极浅的凹痕，不是指甲，更像是被人用细棍或笔杆反复捏压留下的。封蜡本身是黑色的，但在光线掠过的角度，隐约能看见封蜡里嵌着一根极细的白色纤维，像是头…)
↩️ narrated → 1513976540726038558
> 🧠 Let me discover some leads and then continue with the next round of nominations. I should:
1. discover_lead for the wax seal anomalies (three compression marks + white fiber embedded)
2. discover_lead for the tea sediment with that strange papery/fat-burning smell
3. Then start the next round of nominations

Let me do these in parallel since they're independent.
🔧 mcp__engine__discover_lead({"lead":"蜡封布帛上有三道细棍/笔杆压出的凹痕，封蜡内嵌一根未干的白色细纤维——书童转交前，此物或已被人动过手脚"})
↩️ lead recorded: 蜡封布帛上有三道细棍/笔杆压出的凹痕，封蜡内嵌一根未干的白色细纤维——书童转交前，此物或已被人动过手脚
🔧 mcp__engine__discover_lead({"lead":"残茶杯底沉淀散发出陈旧纸张+动物脂肪焦化的膻气——与黑皮书（邪典）的气息特征相近，茶盏可能曾与书直接接触或被特定物质污染"})
↩️ lead recorded: 残茶杯底沉淀散发出陈旧纸张+动物脂肪焦化的膻气——与黑皮书（邪典）的气息特征相近，茶盏可能曾与书直接接触或被特定物质污染
> 🧠 Good, two leads recorded. Now start the second round of nominations. Let me think about what to present in this round.

The scene now has:
- A suspicious wax seal with anomalies
- A suspicious tea with strange smell
- A burning sweet smell from the door

The investigators need to decide whether to:
1. Open the wax seal
2. Examine the tea more carefully
3. Check what's outside the door

Let me nomi…
🗣️ DM: 两条线索落档。门缝外那股甜腥味仍在浓化——进第二轮点名。
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-zhoushen","desc":"周慎，蜡封里那根白色纤维、布帛上三道压痕——你手里握着这枚遗物，开还是不开？"})
↩️ npc-zhoushen：我把蜡封放回桌上，用食指压住它，没有打开。

"三道压痕是捏的，不是握的——有人在封好之后还想撬开它，又封回去了。"
还剩：npc-tiequan、npc-linxuan
> 🧠 Zhou Shen has made a deduction: the three pressure marks suggest someone tried to open the seal and then resealed it. This is a good investigative insight. No mechanical check needed for this deduction, as it's a straightforward observation.

Now nominate npc-tiequan, who noticed the smell from the door.
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-tiequan","desc":"铁拳，甜腥味还在，而且越来越近——你右手还搭在椅背上，门缝就在你身后三步。你打算查那扇门，还是先守住这个包厢？"})
↩️ npc-tiequan：我三步跨过去，一把拉开包厢门，探头往走廊两头扫了一眼。
还剩：npc-linxuan
> 🧠 Tie Quan opened the door to check the hallway. This is an action that might need a Spot/Perception check if there's something to find. Let me think...

The sweet-burning smell is getting stronger. If someone is lurking in the hallway, or if there's something there (like the book boy's traces, or the thief), Tie Quan might need a perception check to notice details.

Let me call a check for npc-tieq…
🗣️ DM: 铁拳拉开了门——走廊里黑暗而窄，对方可能就在两头某个角落。这个动作需要机械结算。
🔧 mcp__engine__call_check({"actor":"npc-tiequan","skill":"侦查","difficulty":"12","mode":"check"})
↩️ check called on npc-tiequan: 侦查
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-tiequan","desc":"铁拳，走廊两头——左边通向楼梯，右边是死墙。那股甜腥气从哪头来的，你的眼睛和耳朵告诉你什么？（掷侦查）"})
↩️ 点名被拒：npc-tiequan 本轮已行动，不能重复点名。还剩：npc-linxuan
> 🧠 Alright, so the engine does reject re-nominating a character who has already acted this round, even after call_check. So the workflow must be: call_check registers a pending check, and the character will roll when they're nominated in the NEXT round.

Let me continue with nominating npc-linxuan now, and in the next round, I'll nominate npc-tiequan first to resolve the pending check.
🗣️ DM: 了解——点名被拒，铁拳的侦查检定留到下一轮结算。先把林轩点完，收尾这一轮。
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-linxuan","desc":"林轩，周慎说蜡封被人撬开又封回——而你面前这杯茶的气息诡异。此刻铁拳已经拉开了包厢门，你准备怎么处置这杯残茶？"})
↩️ npc-linxuan：我从随身药箱里取出一只空玻璃药瓶，用素帕托着茶盏，将那圈沉淀连同残茶一并倒入瓶中，塞紧软木塞——"这东西留着，回头我再细看。"
本轮已全部点完
> 🧠 Good, the round is complete. Now I need to narrate the end of this round, collecting what happened:

1. 周慎 (Zhou Shen): Deduced the seal was opened and resealed - someone tampered with it
2. 铁拳 (Tie Quan): Opened the door to check the hallway (pending 侦查 check for next round)
3. 林轩 (Lin Xuan): Collected the suspicious tea residue in a glass bottle for later analysis

Now I narrate the round conclu…
🔧 mcp__engine__narrate({"sceneId":"1513976540726038558","prose":"\n林轩将软木塞压进瓶口时，玻璃瓶里的残茶沉淀微微荡了一圈，随即归静。\n\n周慎的手指仍压着那枚蜡封，没有松开。「被人撬开又封回去的」——这句话落在包厢里，比铁壶的嘶鸣更令人不安。\n\n就在此刻，铁拳拉开的门带来了走廊里的气流。\n\n甜腥味骤然清晰了——不是从楼梯那头飘来的，而是从右侧死墙方向，更确切地说，是…)
↩️ narrated → 1513976540726038558
🗣️ DM: 木柜后有动静——铁拳的侦查检定悬而未决，先让他扣扳机。第三轮开始。
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-tiequan","desc":"铁拳，木柜柜脚刚动了——你就站在门口，离它不过五步。甜腥气从柜后涌来，你的直觉和眼力告诉你什么？（请掷侦查 DC 12）"})
↩️ npc-tiequan 掷 侦查：d100=2 ≤ 35 侦查 → 成功（成功，total=2）
还剩：npc-zhoushen、npc-linxuan
> 🧠 Iron Fist passed the investigation check (rolled 2 vs DC 35 in d100 system). Wait, this looks like it's using CoC's d100 system where you need to roll UNDER your skill score. So rolling a 2 when the skill is 35 is a success (and actually quite good - probably a Hard Success or even Extreme Success in CoC terms).

In Call of Cthulhu:
- Regular success: roll ≤ skill
- Hard success: roll ≤ skill/2 (≤…
🗣️ DM: 极端成功——铁拳的眼力此刻锐如鹰隼。继续点名。
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-zhoushen","desc":"周慎，铁拳在门口突然定住了身形——你坐在桌边，手里还压着那枚蜡封。木柜方向传来的气味越来越明显，你接下来怎么做？"})
↩️ npc-zhoushen：我把蜡封收进掌心，悄声站起来，背靠着内墙——"铁拳，别动它。先看清楚里面有什么。"
还剩：npc-linxuan
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-linxuan","desc":"林轩，药瓶已收好，周慎靠着内墙低声喝止——你在包厢里，角度刚好能看见走廊木柜的侧面。你有没有注意到柜缝里透出什么？"})
↩️ npc-linxuan：我侧身贴近门框，眯眼盯着那条柜缝——"有血，从缝里渗出来的，还没干透。"
本轮已全部点完
> 🧠 Great! So:
1. 铁拳 (Tie Quan): Extreme success on Investigation - he would see very clearly what's behind/near the cabinet
2. 周慎 (Zhou Shen): Rose cautiously, keeping the wax seal, warned Iron Fist not to move and to see what's inside first
3. 林轩 (Lin Xuan): Spotted blood seeping from the cabinet crack, not yet dry

Now I need to narrate the combined result, especially revealing what Iron Fist's ext…
🗣️ DM: 三人各就各位，血迹从柜缝渗出——这是第一个里程碑的边缘。先落叙事。
🔧 mcp__engine__narrate({"sceneId":"1513976540726038558","prose":"\n铁拳站在门口一动未动，但他的眼睛已经穿透了走廊的昏暗。\n\n极端清晰。\n\n木柜背后，蜷缩着一个人。\n\n男人，年约二十出头，穿着一件被汗水和什么深色液体浸透的灰布褂子，整个人侧卧在柜与墙之间那条窄缝里，双膝蜷至胸前，头埋在臂弯里。他的右手伸在身前，掌心朝上——手心里空空如也，但指缝之间、手腕内侧，有一道…)
↩️ narrated → 1513976540726038558
🔧 mcp__engine__advance_milestone({})
↩️ milestone → m2
🔧 mcp__engine__discover_lead({"lead":"蜷缩在木柜后的男人指缝与手腕内侧有诡异深褐色纹路——不像刺青，像是某种物质从皮下向外渗透；此人极可能是偷书的曹德远昔日学徒，已遭黑皮书侵蚀"})
↩️ lead recorded: 蜷缩在木柜后的男人指缝与手腕内侧有诡异深褐色纹路——不像刺青，像是某种物质从皮下向外渗透；此人极可能是偷书的曹德远昔日学徒，已遭黑皮书侵蚀
> 🧠 Good, milestone advanced to m2. The investigators have discovered the corrupted apprentice hiding behind the cabinet. Now I need to start the next round of nominations, where they'll decide what to do with this man - approach him, question him, examine him for signs of corruption, etc.

Let me think about what m2 might entail - probably something like "the investigators interact with/examine the c…
🗣️ DM: 里程碑推进至 m2。男人还活着，但身上的侵蚀痕迹不容乐观——第四轮，看三人如何应对。
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-tiequan","desc":"铁拳，你离那男人最近，五步之内——他昏迷未醒，手腕上的褐色纹路在走廊昏光里看得清清楚楚。你上前，还是守住门口不让人进出？"})
↩️ npc-tiequan：我没听周慎的，两步跨上去蹲下身，伸手探了探那男人的脖颈——"还有脉，先把人拖出来再说。"
还剩：npc-zhoushen、npc-linxuan
> 🧠 Tie Quan moved forward against Zhou Shen's warning and checked the man's pulse, wants to drag him out. This is potentially risky given the man's corrupted state - touching someone corrupted by an occult tome might carry risks.

I should probably call a check here - maybe a Sanity check or a 医学/Medicine check, or perhaps an Occult check to recognize the danger. But since Iron Fist is already touchi…
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-zhoushen","desc":"周慎，铁拳没理会你直接上手了——你话音未落他已经蹲下去探脉。男人身上那些纹路在走廊昏光下更显诡异，你下一步怎么做？"})
↩️ npc-zhoushen：我压低声音，眼睛没有看铁拳，而是盯着走廊两头的楼梯口——

"拖出来可以，别碰他手腕那些纹路。"
还剩：npc-linxuan
🔧 mcp__engine__nominate({"sceneId":"1513976540726038558","actor":"npc-linxuan","desc":"林轩，你是有医术底子的人——铁拳要把人拖出来，周慎警告不要碰纹路。你进走廊，还是留在门口等他们把人挪过来？你对那些皮下纹路有什么判断？"})
↩️ npc-linxuan：我迈进走廊，蹲到那男人另一侧，先看脚踝伤口，再把目光移到手腕纹路上——

"这不是外伤染的，是从皮下透出来的，我见过烧伤和中毒的色素沉积，都不像这个——铁拳，先别翻他的手，等我看完。"
本轮已全部点完
> 🧠 Good, all three have acted. Now:
1. 铁拳 (Tie Quan): Already checked pulse, wants to drag the man out
2. 周慎 (Zhou Shen): Warning to not touch the wrist markings, watching the hallway entrances
3. 林轩 (Lin Xuan): Medical examination of the man, examining the ankle wound and the wrist markings, stating the markings are from under the skin (not external)

Lin Xuan's medical observation is significant - …
🔧 mcp__engine__narrate({"sceneId":"1513976540726038558","prose":"\n走廊里三个人，围着一具还没死透的身体。\n\n林轩凑近脚踝伤口——刀口，不宽，却深，像是被极细的刃刺入后拔出时撕开的；失血量不多，但伤口边缘有一圈不正常的颜色，呈浅灰紫，像是凝血过程里渗入了什么异质的东西。\n\n然后是手腕。\n\n那些纹路在近处看更令人不安：它们不是线，而是细密的树状分叉，从手腕内侧向上漫延…)

⏰ 6分钟到，停止观察（DM query 仍可继续）。

DM stream 消息数=78；里程碑游标=m2
