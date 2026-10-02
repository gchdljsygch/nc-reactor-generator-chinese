# R0.4 — 历史格式 fixtures 与往返验证

> 由 `net.ncplanner.plannerator.tools.FixtureGen` 生成。
>
> 仓库里没有历史格式的真实样本，因此 baseline 由**冻结的 Java 版自己产出**：
> 构造一个已知反应堆 → 用每个 writer 写出 → 用注册的 reader 链读回 → 比对反应堆。

参考反应堆：Overhaul SFR `5x5x5`，内部方块 125 个、外壳 218 个。

| 格式 | writer | 文件 | 大小 | 写出 | 读回 | 内部方块一致 | 外壳 | 备注 |
|---|---|---|---:|:--:|:--:|:--:|:--:|---|
| `ncpf-save` | `NCPFFileWriter` | `sfr-ncpf-save.ncpf.json` | 352.9 KB | ✅ | ❌ | — | — | NullPointerException: Cannot invoke "net.ncplanner.plannerator.ncpf.NCPFElement.copyTo(java.util.function.Supp… |
| `ncpf-export` | `NCPFWriter` | `sfr-ncpf-export.ncpf.json` | — | ❌ | — | — | — | NullPointerException: Cannot invoke "net.ncplanner.plannerator.ncpf.NCPFElement.copyTo(java.util.function.Supp… |
| `legacy-ncpf` | `LegacyNCPFWriter` | `sfr-legacy-ncpf.ncpf` | — | ❌ | — | — | — | NullPointerException: Cannot invoke "net.ncplanner.plannerator.ncpf.NCPFElement.copyTo(java.util.function.Supp… |
| `hellrage` | `HellrageWriter` | `sfr-hellrage.json` | 4.4 KB | ✅ | ❌ | — | — | IllegalArgumentException: Invalid fuel name: MOX-241! |
| `bg-string` | `BGStringWriter` | `sfr-bg-string.txt` | — | ❌ | — | — | — | IllegalArgumentException: Cannot export element definition in BG String: oredict (blockGraphite) |
| `png` | `PNGWriter` | `sfr-png.png` | — | ❌ | — | — | — | NullPointerException: Cannot invoke "net.ncplanner.plannerator.graphics.Font.getStringWidth(String, float)" be… |

## 发现

### ⚠️ 1. 产品 bug：`NCPFSettingsElement.matches()` 对 `legacy_recipe` 不满足自反性

实测（见控制台 `REFLEXIVITY` 行）：

```
sfr.coolantRecipe.definition.matches(itself) = false
```

**`x.matches(x)` 返回 `false`** —— 一个相等性判定不满足自反性，必然是 bug。

原因（代码位置 `NCPFSettingsElement.java:186-210`）：`matches()` 的 `Set` 分支假设集合元素是
`NCPFElementDefinition`，但 `NCPFLegacyRecipeElement.inputs/outputs` 实际是
`HashSet<NCPFElementStack>`（`NCPFElementStack extends DefinedNCPFModularObject`，
**不是** `NCPFElementDefinition`）。于是内层循环每次都走到 `else equal = false;`：

```java
for(Object elem1 : s1){
    for(Object elem1Again : s1){
        if(elem1 instanceof NCPFElementDefinition && elem1Again instanceof NCPFElementDefinition){
            if(((NCPFElementDefinition)elem1).matches((NCPFElementDefinition)elem1Again))count1++;
        }else
            equal = false;   // <-- 对 NCPFElementStack 恒定命中
    }

```

**只要 `inputs` 或 `outputs` 非空，`matches` 就恒为 `false`** —— 也就是对**每一个真实配方**都失败。

传导路径：

```
NCPFObject.setIndex("coolant_recipe", recipe, config.coolantRecipes)
  -> indexof(recipe, list)  { for(...) if(list.get(i).definition.matches(recipe.definition)) return i; }
  -> 全部 false -> 写入 -1
  -> 读回时 getIndex(...) 因 index==-1 返回 null
  -> OverhaulSFRDesign.convertFromObject:42  definition.coolantRecipe.copyTo(...) -> NullPointerException

```

**用户可见后果：保存一个含 Overhaul SFR 的工程后再打开，直接 NPE。**
本报告里 `ncpf-save` / `ncpf-export` / `legacy-ncpf` 三个格式读回失败，全部由这一条引起。

> **R0 不做修复。** R0 的目的是**冻结** Java 版并记录基线；改产品代码会让 golden/fixture 失去可比性。
> 修复应作为独立改动，或在 TS 重写里自然消失（TS 侧不应该用「索引 + 结构相等」来引用配方，
> 而应该直接写元素身份）。

### 2. `hellrage` 写出了但读不回：`Invalid fuel name: MOX-241!`

`HellrageWriter` 把燃料的**显示名**写进 `UsedFuel.Name`，而 Hellrage 系列 reader 用该名字回查燃料。
名字对不上就抛 `IllegalArgumentException`。这是**同一类根因**的又一实例：
把「显示名」当标识符用（见 `docs/r0/findings.md` §7 与重写方案 §2 根因 5）。

### 3. `bg-string` 无法表示 oredict 方块

`Cannot export element definition in BG String: oredict (blockGraphite)`。
Building Gadget 字符串格式无法表达 oredict 引用的方块，属于格式能力限制，非缺陷。

### 4. `hellrage` 必然丢失外壳

`HellrageWriter.java:54` 明确跳过外壳方块（注释原文 `can't save the casing :(`）。
所以该格式只比对内部方块；TS 侧实现时必须复刻这一行为，否则往返断言会误报。

### 5. `png` 需要 GL，headless 下无法测试

`PNGWriter` 要渲染多方块并用字体测量文本，headless 下 NPE（`Font.getStringWidth`）。
这一项需要在有 GL 的环境单独验证。

## TS 实现的验收口径

1. **格式读取**：新实现必须能把 `datasets/fixtures/` 里每个文件读成与上表一致的反应堆；
   注意 `ncpf-*` / `legacy-ncpf` 三个文件**当前 Java 版自己都读不回**，所以对它们要按
   「应当能读回」（修复后语义）而非「复刻当前行为」来验收；
2. **格式写出**：`ncpf-save` 全保真、`ncpf-export` 走 `makePartial` + 裁剪 `plannerator:*`；
3. **配方引用**：不要用「配置内索引 + 结构相等」表示配方，直接用元素身份；
   这同时消除了本报告发现 1 的整类问题；
4. **外壳语义**：Hellrage 读写都不含外壳，比对时必须只比内部方块。

---

## 汇总

| 项 | 数值 |
|---|---:|
| 尝试写出 | 6 |
| 写出成功 | 2 |
| 写出失败 | 4 |
| 读回失败 | 2 |
| 内部方块指纹一致 | 0 |
| 内部方块指纹不一致 | 0 |

> ⚠️ 这批 fixtures 由当前 Java 版生成，因此它们固化了**当前实现的输出**，
> 而不是历史版本的真实文件。要做到后者，需要收集社区的真实老存档（见 `docs/r0/findings.md` §10）。
