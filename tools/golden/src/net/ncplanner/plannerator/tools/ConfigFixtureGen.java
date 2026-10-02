package net.ncplanner.plannerator.tools;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import net.ncplanner.plannerator.planner.file.FileReader;
import net.ncplanner.plannerator.planner.ncpf.Project;

/**
 * R0.4 — fixtures for the Forge/NCConfig ({@code .cfg}) readers.
 *
 * <p>The repository ships no {@code .cfg} sample, and those two readers
 * ({@code OverhaulNCConfigReader}, {@code UnderhaulNCConfigReader}) read a
 * <em>configuration</em> rather than a design, so they cannot be covered by the
 * writer round-trip used for the other formats. This tool synthesises a minimal
 * but complete {@code nuclearcraft.cfg} that satisfies every property the readers
 * touch, writes it out, and then verifies it by running the real reader chain.
 *
 * <p>Requirements were derived mechanically from the reader sources:
 * <ul>
 *   <li>scalar vs list, and the exact element type, from the accessor used
 *       ({@code getInt} → {@code I:}, {@code getDouble} → {@code D:},
 *       {@code getString} → {@code S:}, {@code getBoolean} → {@code B:});</li>
 *   <li>list lengths from the highest literal index each reader uses, rounded up
 *       generously for lists indexed by a loop variable;</li>
 *   <li>fuel-family list lengths from the exact {@code addSFRFuels}/{@code addFuels}
 *       argument counts, because those are indexed element-by-element.</li>
 * </ul>
 *
 * <p>Usage: {@code ConfigFixtureGen [outDir] [reportPath]}
 */
public class ConfigFixtureGen{
    public static void main(String[] args) throws Exception{
        Bootstrap.init();

        String outDir = args.length>0?args[0]:"datasets/fixtures";
        String reportPath = args.length>1?args[1]:"docs/r0/fixtures-ncconfig.md";
        new File(outDir).mkdirs();

        List<String[]> cases = new ArrayList<>();
        cases.add(new String[]{"ncconfig-underhaul.cfg", "UnderhaulNCConfigReader", underhaulCfg(), null});
        cases.add(new String[]{"ncconfig-overhaul.cfg", "OverhaulNCConfigReader", overhaulCfg(),
            "该 fixture 本身是完整的；read() 抛异常是**产品 bug**：`OverhaulNCConfigReader` 无条件地在"
            + "第 129-131 行用 `new NCPFListElement(...)` 调 `builder.irradiatorRecipe(...)`，"
            + "而 `OverhaulSFRConfigurationBuilder:188` 执行 `new NCPFElementStack(definition, 1)`；"
            + "`NCPFListElement.canHaveAmount()` 返回 false，于是构造函数直接抛 "
            + "`IllegalArgumentException: Cannot create an element stack, with an amount, using a definition that "
            + "cannot have an amount!`。这三行是无条件的，因此**任何** overhaul `.cfg` 都读不进来（详见 findings §11）。"});

        StringBuilder report = new StringBuilder();
        report.append("# R0.4 — NCConfig（`.cfg`）fixtures\n\n");
        report.append("> 由 `net.ncplanner.plannerator.tools.ConfigFixtureGen` 生成。\n>\n");
        report.append("> 这两个 reader 读的是**配置**而不是设计，因此无法用其它格式那种「writer 写出 → reader 读回」的办法覆盖。\n");
        report.append("> 本工具按 reader 源码**逐属性合成**一个最小但完整的 `nuclearcraft.cfg`，再用真实的 reader 链验证。\n\n");
        report.append("| 文件 | 期望 reader | 大小 | 读入 | 命中的 reader | 元素数 | 配置 |\n");
        report.append("|---|---|---:|:--:|---|---:|---|\n");

        int ok = 0, bad = 0;
        for(String[] c : cases){
            String fileName = c[0];
            String expected = c[1];
            String text = c[2];
            String knownIssue = c.length>3?c[3]:null;
            File out = new File(outDir, fileName);
            Files.write(out.toPath(), text.getBytes(StandardCharsets.UTF_8));

            String readState = "❌";
            String matched = "—";
            String elements = "—";
            String config = "—";
            String note = "";
            try{
                Project p = FileReader.read(out);
                if(p==null)throw new IllegalStateException("FileReader returned null");
                readState = "✅";
                ok++;
                elements = String.valueOf(countElements(p));
                config = describe(p);
                matched = effectiveReader(out, expected);
                if(!expected.equals(matched)){
                    note = "⚠️ 期望 "+expected+"，实际由 "+matched+" 读出";
                }
            }catch(Throwable t){
                bad++;
                note = shortMsg(t);
            }
            report.append("| `").append(fileName).append("` | `").append(expected).append("` | ")
                  .append(String.format("%.1f KB", out.length()/1024.0)).append(" | ")
                  .append(readState).append(" | `").append(matched).append("` | ")
                  .append(elements).append(" | ").append(config).append(" | ")
                  .append(note).append(" |\n");
            if(knownIssue!=null){
                report.append('\n');
                report.append("> **`").append(fileName).append("` 说明**：").append(knownIssue).append("\n");
            }
        }

        report.append('\n');
        report.append("## 汇总\n\n");
        report.append("| 项 | 数值 |\n|---|---:|\n");
        report.append("| fixture 数 | ").append(cases.size()).append(" |\n");
        report.append("| 读入成功 | ").append(ok).append(" |\n");
        report.append("| 读入失败 | ").append(bad).append(" |\n");
        report.append('\n');
        report.append("## 为什么这两个 reader 需要专门的 fixture\n\n");
        report.append("其余格式的 fixture 走「构造反应堆 → writer 写出 → reader 读回 → 比对」这条环回链路。\n");
        report.append("`OverhaulNCConfigReader` / `UnderhaulNCConfigReader` 是**配置读取器**：\n\n");
        report.append("- 输入是 NuclearCraft 模组的 Forge 配置文件（`config/nuclearcraft.cfg`），不是规划器写出的文件；\n");
        report.append("- 仓库里没有任何 `.cfg` 样本；\n");
        report.append("- 没有对应的 writer（规划器只能读它，不能写它）。\n\n");
        report.append("所以必须**按 reader 源码合成输入**。本工具的合成规则：\n\n");
        report.append("1. **标量 vs 列表、元素类型**由 reader 使用的访问器决定：\n");
        report.append("   `getInt` → `I:`，`getDouble` → `D:`，`getString` → `S:`，`getBoolean` → `B:`。\n");
        report.append("   `ConfigList.getInt` 是 `return get(index)`（泛型强转），类型写错会 ClassCastException。\n");
        report.append("2. **列表长度**取 reader 里出现的最大字面量下标，循环索引的取足够大的值。\n");
        report.append("3. **燃料族的列表长度必须精确** —— `addSFRFuels`/`addFuels` 逐元素索引，\n");
        report.append("   长度取自这些调用的实参个数：thorium 5、uranium 20、neptunium 10、plutonium 20、\n");
        report.append("   mixed 10、americium 10、curium 30、berkelium 10、californium 20（overhaul）。\n");
        report.append("4. **放置规则字符串**用 reader 的解析器能接受的最小形式：`at least one cell` / `at least one moderator`。\n");
        report.append("   `parsePlacementRule` → `NCPFPlacementRule.parseNc` 会把 `cell`/`moderator`/`casing` 等前缀\n");
        report.append("   映射到模块，所以这些字符串无需引用具体方块。\n\n");
        report.append("## TS 实现的验收口径\n\n");
        report.append("新实现必须能把这两个 `.cfg` 读成与上表一致的配置（元素数与配置名），\n");
        report.append("并且**探测顺序**要与 `docs/r0/compat-contract.md` §6 一致：\n");
        report.append("underhaul 的 `.cfg` 不能先被 overhaul reader 抢走（两者靠 `fission_sink_cooling_rate`\n");
        report.append("与 `fission_cooling_rate` 的存在与否区分）。\n");

        Files.write(Paths.get(reportPath), report.toString().getBytes(StandardCharsets.UTF_8));

        System.out.println();
        System.out.println("=== ncconfig fixture summary ===");
        System.out.println("fixtures written : "+cases.size());
        System.out.println("read OK          : "+ok);
        System.out.println("read FAILED      : "+bad);
        System.out.println("out dir          : "+new File(outDir).getAbsolutePath());
        System.out.println("report           : "+reportPath);
    }

    /**
     * The reader chain is "first reader whose {@code formatMatches} is true and whose
     * {@code read()} returns non-null". {@code NCPFReader} always matches by design
     * (it defers by returning null), so the effective reader is the first claimant
     * after it.
     */
    private static String effectiveReader(File out, String expected){
        for(net.ncplanner.plannerator.planner.file.FormatReader r : FileReader.formats){
            String name = r.getClass().getSimpleName();
            if(name.equals("NCPFReader"))continue;// always matches, defers via read()==null
            try{
                if(r.formatMatches(() -> {
                    try{
                        return new java.io.FileInputStream(out);
                    }catch(Exception ex){
                        return null;
                    }
                })){
                    return name;
                }
            }catch(Throwable ignored){
            }
        }
        return "(none)";
    }

    private static String shortMsg(Throwable t){
        String m = t.getClass().getSimpleName()+": "+String.valueOf(t.getMessage());
        if(m.length()>140)m = m.substring(0, 140)+"…";
        return m.replace("|", "\\|");
    }

    private static int countElements(Project p){
        int n = 0;
        for(net.ncplanner.plannerator.ncpf.configuration.NCPFConfiguration cfg
                : p.configuration.configurations.values()){
            for(List<net.ncplanner.plannerator.ncpf.NCPFElement> list : cfg.getAllElementsISaidAllElements()){
                n += list.size();
            }
        }
        return n;
    }

    private static String describe(Project p){
        StringBuilder sb = new StringBuilder();
        for(net.ncplanner.plannerator.ncpf.configuration.NCPFConfiguration cfg
                : p.configuration.configurations.values()){
            if(sb.length()>0)sb.append("<br>");
            sb.append(cfg.getName());
        }
        return sb.length()==0?"<empty>":sb.toString();
    }

    // ---------------------------------------------------------------------------
    // Forge config text builders
    // ---------------------------------------------------------------------------

    private static Writer w;
    private static StringBuilder sb;

    private static void line(String s){
        sb.append(s).append('\n');
    }

    private static void indent(String s){
        sb.append("    ").append(s).append('\n');
    }

    private static void scalarD(String key, double v){
        indent("D:"+key+"="+v);
    }

    private static void scalarI(String key, int v){
        indent("I:"+key+"="+v);
    }

    private static void scalarB(String key, boolean v){
        indent("B:"+key+"="+v);
    }

    /** Numeric list; type letter is 'I' or 'D' and must match the reader's accessor. */
    private static void numList(String key, char type, int length, double value){
        indent(type+":"+key+" <");
        for(int i = 0; i<length; i++)indent(fmt(value));
        indent(">");
    }

    private static void numListVarying(String key, char type, double... values){
        indent(type+":"+key+" <");
        for(double v : values)indent(fmt(v));
        indent(">");
    }

    private static void strList(String key, String value, int length){
        indent("S:"+key+" <");
        for(int i = 0; i<length; i++)indent(value);
        indent(">");
    }

    private static void boolList(String key, boolean value, int length){
        indent("B:"+key+" <");
        for(int i = 0; i<length; i++)indent(String.valueOf(value));
        indent(">");
    }

    private static String fmt(double v){
        if(v==Math.rint(v)&&Math.abs(v)<1e15)return String.valueOf((long)v);
        return String.valueOf(v);
    }

    // ---------------------------------------------------------------------------

    /** Minimal complete Forge config for {@code UnderhaulNCConfigReader}. */
    private static String underhaulCfg(){
        sb = new StringBuilder();
        line("# R0.4 NCConfig fixture — synthetic, satisfies UnderhaulNCConfigReader");
        line("# Generated by net.ncplanner.plannerator.tools.ConfigFixtureGen. Do not edit by hand.");
        line("");
        line("fission {");
        scalarB("fission_water_cooler_requirement", true);
        scalarD("fission_power", 1.0);
        scalarD("fission_fuel_use", 1.0);
        scalarD("fission_heat_generation", 1.0);
        scalarI("fission_min_size", 3);
        scalarI("fission_max_size", 24);
        scalarI("fission_neutron_reach", 4);
        scalarD("fission_moderator_extra_power", 1.0);
        scalarD("fission_moderator_extra_heat", 1.0);
        scalarI("fission_active_cooler_max_rate", 5);
        numList("fission_cooling_rate", 'D', 15, 40);
        numList("fission_active_cooling_rate", 'D', 15, 40);
        // addFuels() reads these three per family, indexed element by element,
        // so the lengths must match the fuel-name argument counts exactly.
        String[][] families = {
            {"thorium", "2"}, {"uranium", "8"}, {"neptunium", "4"}, {"plutonium", "8"},
            {"mox", "2"}, {"americium", "4"}, {"curium", "12"}, {"berkelium", "4"},
            {"californium", "8"},
        };
        for(String[] fam : families){
            int n = Integer.parseInt(fam[1]);
            numList("fission_"+fam[0]+"_fuel_time", 'D', n, 100);
            numList("fission_"+fam[0]+"_power", 'D', n, 100);
            numList("fission_"+fam[0]+"_heat_generation", 'D', n, 10);
        }
        line("}");
        return sb.toString();
    }

    /** Minimal complete Forge config for {@code OverhaulNCConfigReader}. */
    private static String overhaulCfg(){
        sb = new StringBuilder();
        line("# R0.4 NCConfig fixture — synthetic, satisfies OverhaulNCConfigReader");
        line("# Generated by net.ncplanner.plannerator.tools.ConfigFixtureGen. Do not edit by hand.");
        line("");
        line("fission {");
        scalarD("fission_fuel_time_multiplier", 1.0);
        scalarD("fission_fuel_heat_multiplier", 1.0);
        scalarD("fission_fuel_efficiency_multiplier", 1.0);
        scalarI("fission_cooling_efficiency_leniency", 1);
        scalarI("fission_min_size", 3);
        scalarI("fission_max_size", 24);
        scalarI("fission_neutron_reach", 4);
        // getDouble(0..1)
        numList("fission_sparsity_penalty_params", 'D', 2, 1.0);
        numList("fission_source_efficiency", 'D', 8, 1.0);
        numList("fission_moderator_efficiency", 'D', 8, 1.0);
        // read with getInt -> must be I:
        numList("fission_moderator_flux_factor", 'I', 8, 1);
        numList("fission_reflector_efficiency", 'D', 8, 1.0);
        numList("fission_reflector_reflectivity", 'D', 8, 1.0);
        numList("fission_shield_heat_per_flux", 'D', 8, 1.0);
        numList("fission_shield_efficiency", 'D', 8, 1.0);
        numList("fission_irradiator_heat_per_flux", 'D', 8, 1.0);
        numList("fission_irradiator_efficiency", 'D', 8, 1.0);
        // sinks: 16 solid_fission_sink + sink2 series, read with getInt
        numList("fission_sink_cooling_rate", 'I', 32, 100);
        strList("fission_sink_rule", "at least one cell", 32);
        numList("fission_heater_cooling_rate", 'I', 32, 100);
        strList("fission_heater_rule", "at least one cell", 32);
        // addSFRFuels(): lengths must match the fuel-name argument counts exactly
        String[][] families = {
            {"thorium", "5"}, {"uranium", "20"}, {"neptunium", "10"}, {"plutonium", "20"},
            {"mixed", "10"}, {"americium", "10"}, {"curium", "30"}, {"berkelium", "10"},
            {"californium", "20"},
        };
        for(String[] fam : families){
            int n = Integer.parseInt(fam[1]);
            numList("fission_"+fam[0]+"_fuel_time", 'I', n, 100);
            numList("fission_"+fam[0]+"_heat_generation", 'I', n, 10);
            numList("fission_"+fam[0]+"_efficiency", 'D', n, 1.0);
            numList("fission_"+fam[0]+"_criticality", 'I', n, 1);
            boolList("fission_"+fam[0]+"_self_priming", false, n);
        }
        line("}");
        line("");
        line("turbine {");
        scalarI("turbine_mb_per_blade", 1);
        scalarI("turbine_min_size", 3);
        scalarI("turbine_max_size", 24);
        scalarD("turbine_tension_throughput_factor", 1.0);
        scalarD("turbine_power_bonus_multiplier", 1.0);
        scalarD("turbine_stator_expansion", 1.0);
        numList("turbine_throughput_leniency_params", 'D', 2, 1.0);
        numList("turbine_blade_efficiency", 'D', 3, 1.0);
        numList("turbine_blade_expansion", 'D', 3, 1.0);
        numList("turbine_coil_conductivity", 'D', 6, 1.0);
        strList("turbine_coil_rule", "at least one blade", 6);
        strList("turbine_connector_rule", "at least one coil", 1);
        line("}");
        return sb.toString();
    }
}
