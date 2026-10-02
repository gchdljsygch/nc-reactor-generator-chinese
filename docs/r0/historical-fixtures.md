# R0.4 — reader 覆盖表：`historical`

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
| `aapn.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 622 | 0 |  |
| `alloy_heat_sinks.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 44 | 0 |  |
| `asdf.ncpf` | `LegacyNCPF1Reader` | NCPFReader, LegacyNCPF1Reader | ❌ | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `e2e.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 94 | 0 |  |
| `extreme_reactors.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 2 | 0 |  |
| `fusion_test.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ❌ | — | — | ClassCastException: class net.ncplanner.plannerator.ncpf.module.UnknownNCPFModule cannot be cast to class net.… |
| `ic2.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 86 | 0 |  |
| `inert_matrix_fuels.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 83 | 0 |  |
| `moar_fuels.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 116 | 0 |  |
| `moar_heat_sinks.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 246 | 0 |  |
| `nuclearcraft.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 606 | 0 |  |
| `overhaul.json` | `OverhaulHellrageSFR5Reader` | NCPFReader, OverhaulHellrageSFR5Reader | ❌ | — | — | IllegalArgumentException: Invalid block name: Cf-252! |
| `po3.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 91 | 0 |  |
| `qmd.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 94 | 0 |  |
| `quanta.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 529 | 0 |  |
| `qwerty.ncpf` | `LegacyNCPF1Reader` | NCPFReader, LegacyNCPF1Reader | ❌ | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `spicy_heat_sinks_stable.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 86 | 0 |  |
| `trinity.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 4 | 0 |  |
| `underhaul.json` | `UnderhaulHellrage2Reader` | NCPFReader, UnderhaulHellrage2Reader | ✅ | 0 | 1 |  |

## 汇总

| 项 | 数值 |
|---|---:|
| fixture 数 | 19 |
| 读入成功 | 15 |
| 读入失败 | 4 |
