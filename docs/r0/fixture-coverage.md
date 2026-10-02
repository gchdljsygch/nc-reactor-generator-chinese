# R0.4 — reader 覆盖表：`fixtures`

> 由 `net.ncplanner.plannerator.tools.RoundTrip --coverage` 生成。
>
> 「同时匹配」一列很重要：`NCPFReader` 的 `formatMatches` 恒为 true（它靠 `read()` 返回 null 让位），
> 而 LegacyNCPF / Hellrage 各版本靠版本号互相排斥，正常情况下**只有一个**版本 reader 匹配。
> 若某版本出现两个匹配，说明版本判定有歧义。
>
> 对 `datasets/fixtures/` 里每个文件跑**真实的 reader 链**（`FileReader.read`），
> 记录命中的 reader、是否读入、以及读出多少元素。

| fixture | 命中的 reader | 同时匹配（含 catch-all） | 读入 | 元素数 | 设计数 | 结果 |
|---|---|---|:--:|---:|---:|---|
| `ncconfig-overhaul.cfg` | `OverhaulNCConfigReader` | NCPFReader, OverhaulNCConfigReader | ❌ | — | — | IllegalArgumentException: Cannot create an element stack, with an amount, using a definition that cannot have … |
| `ncconfig-underhaul.cfg` | `UnderhaulNCConfigReader` | NCPFReader, UnderhaulNCConfigReader | ✅ | 90 | 0 |  |
| `sfr-hellrage.json` | `OverhaulHellrageSFR6Reader` | NCPFReader, OverhaulHellrageSFR6Reader | ❌ | — | — | IllegalArgumentException: Invalid fuel name: MOX-241! |
| `sfr-ncpf-save.ncpf.json` | `NCPFReader (catch-all)` | NCPFReader | ❌ | — | — | NullPointerException: Cannot invoke "net.ncplanner.plannerator.ncpf.NCPFElement.copyTo(java.util.function.Supp… |
| `usfr-hellrage.json` | `UnderhaulHellrage2Reader` | NCPFReader, UnderhaulHellrage2Reader | ❌ | — | — | IllegalArgumentException: Invalid block name: ! |
| `usfr-legacy-ncpf.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 601 | 1 |  |
| `usfr-ncpf-export.ncpf.json` | `NCPFReader (catch-all)` | NCPFReader | ✅ | 5 | 1 |  |
| `usfr-ncpf-save.ncpf.json` | `NCPFReader (catch-all)` | NCPFReader | ✅ | 948 | 1 |  |

## 汇总

| 项 | 数值 |
|---|---:|
| fixture 数 | 8 |
| 读入成功 | 4 |
| 读入失败 | 4 |
