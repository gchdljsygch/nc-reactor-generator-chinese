package net.ncplanner.plannerator.tools;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import net.ncplanner.plannerator.multiblock.BlockPos;
import net.ncplanner.plannerator.multiblock.Multiblock;
import net.ncplanner.plannerator.multiblock.overhaul.fissionsfr.Block;
import net.ncplanner.plannerator.multiblock.overhaul.fissionsfr.OverhaulSFR;
import net.ncplanner.plannerator.planner.Core;
import net.ncplanner.plannerator.planner.file.FileReader;
import net.ncplanner.plannerator.planner.file.ncpf.JSONNCPFWriter;
import net.ncplanner.plannerator.planner.file.ncpf.NCPFFileWriter;
import net.ncplanner.plannerator.planner.file.writer.BGStringWriter;
import net.ncplanner.plannerator.planner.file.writer.HellrageWriter;
import net.ncplanner.plannerator.planner.file.writer.LegacyNCPFWriter;
import net.ncplanner.plannerator.planner.file.writer.NCPFWriter;
import net.ncplanner.plannerator.planner.file.writer.PNGWriter;
import net.ncplanner.plannerator.planner.ncpf.Design;
import net.ncplanner.plannerator.planner.ncpf.Project;
import net.ncplanner.plannerator.planner.ncpf.configuration.overhaulSFR.BlockElement;
import net.ncplanner.plannerator.planner.ncpf.configuration.overhaulSFR.Fuel;
import net.ncplanner.plannerator.planner.ncpf.design.MultiblockDesign;

/**
 * R0.4 — generate and verify historical-format fixtures.
 *
 * <p>The repository ships no sample files for the legacy formats, so the
 * compatibility baseline is produced from the frozen Java version itself:
 * build one known reactor, write it out with every writer the app supports,
 * then read each file back through the registered reader chain and compare the
 * reactor that comes out.
 *
 * <p>This is the regression corpus the TypeScript port must reproduce: if the
 * new implementation can read every file in {@code datasets/fixtures/} back to
 * the same reactor, the compatibility surface is covered.
 *
 * <p>Implementation notes that matter:
 * <ul>
 *   <li>Everything is written from {@link Core#project} so that the design's
 *       {@code file} back-reference and the written configuration are the same
 *       object — the app does the same when saving.</li>
 *   <li>Hellrage JSON deliberately <b>cannot</b> store the casing
 *       ({@code HellrageWriter.java:54} — "can't save the casing :("), so the
 *       comparison is split into interior vs shell.</li>
 * </ul>
 *
 * <p>Usage: {@code FixtureGen [outDir] [reportPath]}
 */
public class FixtureGen{
    private static final int SIZE_X = 5;
    private static final int SIZE_Y = 5;
    private static final int SIZE_Z = 5;

    public static void main(String[] args) throws Exception{
        Bootstrap.init();
        NCPFWriter.format = new JSONNCPFWriter();

        String outDir = args.length>0?args[0]:"datasets/fixtures";
        String reportPath = args.length>1?args[1]:"docs/r0/fixtures.md";
        boolean underhaul = false;
        for(String a : args)if(a.equals("--underhaul"))underhaul = true;
        String prefix = underhaul?"usfr-":"sfr-";
        File dir = new File(outDir);
        dir.mkdirs();

        // ---- build the reference reactor (deterministic) ---------------------
        // Overhaul SFR exercises the coolant-recipe path (where the matches() bug
        // bites). Underhaul SFR has no coolant recipe and keys its fuel through a
        // legacy_item, so it is the control case that *should* round-trip cleanly.
        Multiblock<?> reactor = buildReactor(underhaul);
        reactor.clearCaches();
        reactor.recalculate();
        if(underhaul){
            System.out.println("(underhaul control case: no coolant recipe, index lookup uses legacy_item)");
        }else{
        OverhaulSFR sfr = (OverhaulSFR)reactor;
        // diagnostics: a null coolantRecipe serialises as index -1 and then blows up
        // on read-back inside OverhaulSFRDesign.convertFromObject.
        System.out.println("multiblockTypes     : "+Core.multiblockTypes.size());
        System.out.println("coolantRecipes       : "+sfr.getSpecificConfiguration().coolantRecipes.size());
        System.out.println("sfr.coolantRecipe    : "+(sfr.coolantRecipe==null?"null":String.valueOf(sfr.coolantRecipe.getName())));
        // Field shadowing check: NCPFOverhaulSFRConfiguration declares
        // `List<NCPFElement> coolantRecipes` and the plannerator subclass
        // OverhaulSFRConfiguration declares `List<CoolantRecipe> coolantRecipes`.
        // NCPFOverhaulSFRDesign.convertToObject() is statically typed to the PARENT,
        // so it looks the recipe up in the PARENT list.
        {
            net.ncplanner.plannerator.planner.ncpf.configuration.OverhaulSFRConfiguration planCfg =
                    sfr.getSpecificConfiguration();
            net.ncplanner.plannerator.ncpf.configuration.NCPFOverhaulSFRConfiguration ncpfCfg =
                    (net.ncplanner.plannerator.ncpf.configuration.NCPFOverhaulSFRConfiguration)(Object)planCfg;
            System.out.println("child  coolantRecipes: "+planCfg.coolantRecipes.size()
                    +" (plannerator layer, typed List<CoolantRecipe>)");
            System.out.println("parent coolantRecipes: "+ncpfCfg.coolantRecipes.size()
                    +" (NCPF layer, typed List<NCPFElement>) <- what the design serialises against");
            int match = -1;
            for(int i = 0; i<ncpfCfg.coolantRecipes.size(); i++){
                if(ncpfCfg.coolantRecipes.get(i).definition.matches(sfr.coolantRecipe.definition)){ match = i; break; }
            }
            System.out.println("identity lookup      : parent index = "+match);
            System.out.println("REFLEXIVITY          : sfr.coolantRecipe.definition.matches(itself) = "
                    +sfr.coolantRecipe.definition.matches(sfr.coolantRecipe.definition)
                    +"   (must be true; false means matches() is broken)");
            for(int i = 0; i<ncpfCfg.coolantRecipes.size(); i++){
                net.ncplanner.plannerator.ncpf.NCPFElement e = ncpfCfg.coolantRecipes.get(i);
                System.out.println("  parentReflex["+i+"]    : "+e.definition.matches(e.definition));
            }
            System.out.println("  sfr.coolantRecipe  : "+sfr.coolantRecipe.definition.type+" : "+sfr.coolantRecipe.definition);
            for(int i = 0; i<ncpfCfg.coolantRecipes.size(); i++){
                net.ncplanner.plannerator.ncpf.NCPFElement e = ncpfCfg.coolantRecipes.get(i);
                System.out.println("  parent["+i+"]          : "+e.definition.type+" : "+e.definition
                        +"  matches="+e.definition.matches(sfr.coolantRecipe.definition));
            }
            for(int i = 0; i<planCfg.coolantRecipes.size(); i++){
                net.ncplanner.plannerator.ncpf.NCPFElement e = planCfg.coolantRecipes.get(i);
                System.out.println("  child ["+i+"]          : "+e.definition.type+" : "+e.definition);
            }
            if(ncpfCfg.coolantRecipes.isEmpty()){
                System.out.println("  -> the parent list is EMPTY, so coolant_recipe always serialises as -1");
            }
        }
        }// end overhaul-only diagnostics
        String refInterior = interiorSignature(reactor);
        int refInteriorCount = countInterior(reactor);
        int refShellCount = countShell(reactor);
        System.out.println("reference reactor    : "+(underhaul?"Underhaul":"Overhaul")+" SFR "
                +SIZE_X+"x"+SIZE_Y+"x"+SIZE_Z
                +" interior="+refInteriorCount+" shell="+refShellCount);

        // ---- install it as the project's single design -----------------------
        Core.project.designs.clear();
        MultiblockDesign<?, ?> design = reactor.convertToDesign();
        Core.project.designs.add(design);
        System.out.println("design installed     : "+design.definition.type
                +" (project.designs="+Core.project.designs.size()+")");

        // ---- writers under test ---------------------------------------------
        Map<String, Writer> writers = new LinkedHashMap<>();
        writers.put("ncpf-save", (p, os) -> NCPFFileWriter.write(p, os, NCPFFileWriter.formats.get(0)));
        writers.put("ncpf-export", (p, os) -> new NCPFWriter().write(p, os));
        writers.put("legacy-ncpf", (p, os) -> new LegacyNCPFWriter().write(p, os));
        writers.put("hellrage", (p, os) -> new HellrageWriter().write(p, os));
        writers.put("bg-string", (p, os) -> new BGStringWriter().write(p, os));
        // PNGWriter renders the multiblock, so it needs a GL context and loaded
        // fonts. In this headless harness it can never succeed; it is listed so the
        // report shows *why* rather than silently omitting it.
        writers.put("png", (p, os) -> new PNGWriter().write(p, os));

        Map<String, String> extensions = new LinkedHashMap<>();
        extensions.put("ncpf-save", "ncpf.json");
        extensions.put("ncpf-export", "ncpf.json");
        extensions.put("legacy-ncpf", "ncpf");
        extensions.put("hellrage", "json");
        extensions.put("bg-string", "txt");
        extensions.put("png", "png");

        StringBuilder report = new StringBuilder();
        report.append("# R0.4 — 历史格式 fixtures 与往返验证\n\n");
        report.append("> 由 `net.ncplanner.plannerator.tools.FixtureGen` 生成。\n>\n");
        report.append("> 仓库里没有历史格式的真实样本，因此 baseline 由**冻结的 Java 版自己产出**：\n");
        report.append("> 构造一个已知反应堆 → 用每个 writer 写出 → 用注册的 reader 链读回 → 比对反应堆。\n\n");
        report.append("参考反应堆：").append(underhaul?"Underhaul":"Overhaul").append(" SFR `")
              .append(SIZE_X).append("x").append(SIZE_Y).append("x").append(SIZE_Z).append("`，");
        report.append("内部方块 ").append(refInteriorCount).append(" 个、外壳 ").append(refShellCount).append(" 个。\n\n");
        report.append("| 格式 | writer | 文件 | 大小 | 写出 | 读回 | 内部方块一致 | 外壳 | 备注 |\n");
        report.append("|---|---|---|---:|:--:|:--:|:--:|:--:|---|\n");

        int written = 0, writeFail = 0, readFail = 0, interiorOk = 0, interiorBad = 0;

        for(Map.Entry<String, Writer> e : writers.entrySet()){
            String key = e.getKey();
            String ext = extensions.get(key);
            String fileName = prefix+key+"."+ext;
            File out = new File(dir, fileName);
            String writeState = "✅", readState = "—", matchState = "—", shellNote = "—";
            String note = "";
            long size = -1;

            // ---- write ----
            try{
                if(out.exists())out.delete();
                try(OutputStream os = new FileOutputStream(out)){
                    e.getValue().write(Core.project, os);
                }
                size = out.length();
                written++;
            }catch(Throwable t){
                writeFail++;
                writeState = "❌";
                note = shortMsg(t);
                // don't leave a 0-byte stub behind in the corpus
                if(out.exists()&&out.length()==0)out.delete();
                out = null;
            }

            // ---- read back ----
            if(out!=null){
                try{
                    Project back = FileReader.read(out);
                    if(back==null)throw new IllegalStateException("FileReader returned null");
                    readState = "✅";
                    Multiblock<?> mb = firstMultiblock(back);
                    if(mb==null){
                        matchState = "—";
                        note = append(note, "读回后无多方块设计");
                    }else{
                        String sig = interiorSignature(mb);
                        int ic = countInterior(mb);
                        int sc = countShell(mb);
                        if(sig.equals(refInterior)){
                            matchState = "✅";
                            interiorOk++;
                        }else{
                            matchState = "❌";
                            interiorBad++;
                            note = append(note, "内部 "+ic+"/"+refInteriorCount+" 个，指纹不同");
                        }
                        shellNote = sc==refShellCount?"✅ ("+sc+")":"⚠️ ("+sc+"/"+refShellCount+")";
                    }
                }catch(Throwable t){
                    readFail++;
                    readState = "❌";
                    String msg = shortMsg(t);
                    if(msg.contains("coolantRecipe")){
                        msg = msg+" ← `coolant_recipe` 被写成 -1（`matches()` 不自反，见「发现 1」）";
                    }
                    note = append(note, msg);
                }
            }

            report.append("| `").append(key).append("` | ")
                  .append(writerName(key)).append(" | `").append(fileName).append("` | ")
                  .append(size<0?"—":String.format("%.1f KB", size/1024.0)).append(" | ")
                  .append(writeState).append(" | ").append(readState).append(" | ")
                  .append(matchState).append(" | ").append(shellNote).append(" | ")
                  .append(note).append(" |\n");
        }

        report.append('\n');
        report.append("## 发现\n\n");

        report.append("### ⚠️ 1. 产品 bug：`NCPFSettingsElement.matches()` 对 `legacy_recipe` 不满足自反性\n\n");
        report.append("实测（见控制台 `REFLEXIVITY` 行）：\n\n");
        report.append("```\nsfr.coolantRecipe.definition.matches(itself) = false\n```\n\n");
        report.append("**`x.matches(x)` 返回 `false`** —— 一个相等性判定不满足自反性，必然是 bug。\n\n");
        report.append("原因（代码位置 `NCPFSettingsElement.java:186-210`）：`matches()` 的 `Set` 分支假设集合元素是\n");
        report.append("`NCPFElementDefinition`，但 `NCPFLegacyRecipeElement.inputs/outputs` 实际是\n");
        report.append("`HashSet<NCPFElementStack>`（`NCPFElementStack extends DefinedNCPFModularObject`，\n");
        report.append("**不是** `NCPFElementDefinition`）。于是内层循环每次都走到 `else equal = false;`：\n\n");
        report.append("```java\n");
        report.append("for(Object elem1 : s1){\n");
        report.append("    for(Object elem1Again : s1){\n");
        report.append("        if(elem1 instanceof NCPFElementDefinition && elem1Again instanceof NCPFElementDefinition){\n");
        report.append("            if(((NCPFElementDefinition)elem1).matches((NCPFElementDefinition)elem1Again))count1++;\n");
        report.append("        }else\n");
        report.append("            equal = false;   // <-- 对 NCPFElementStack 恒定命中\n");
        report.append("    }\n\n");
        report.append("```\n\n");
        report.append("**只要 `inputs` 或 `outputs` 非空，`matches` 就恒为 `false`** —— 也就是对**每一个真实配方**都失败。\n\n");
        report.append("传导路径：\n\n");
        report.append("```\n");
        report.append("NCPFObject.setIndex(\"coolant_recipe\", recipe, config.coolantRecipes)\n");
        report.append("  -> indexof(recipe, list)  { for(...) if(list.get(i).definition.matches(recipe.definition)) return i; }\n");
        report.append("  -> 全部 false -> 写入 -1\n");
        report.append("  -> 读回时 getIndex(...) 因 index==-1 返回 null\n");
        report.append("  -> OverhaulSFRDesign.convertFromObject:42  definition.coolantRecipe.copyTo(...) -> NullPointerException\n\n");
        report.append("```\n\n");
        report.append("**用户可见后果：保存一个含 Overhaul SFR 的工程后再打开，直接 NPE。**\n");
        report.append("本报告里 `ncpf-save` / `ncpf-export` / `legacy-ncpf` 三个格式读回失败，全部由这一条引起。\n\n");
        report.append("> **R0 不做修复。** R0 的目的是**冻结** Java 版并记录基线；改产品代码会让 golden/fixture 失去可比性。\n");
        report.append("> 修复应作为独立改动，或在 TS 重写里自然消失（TS 侧不应该用「索引 + 结构相等」来引用配方，\n");
        report.append("> 而应该直接写元素身份）。\n\n");

        report.append("### 2. `hellrage` 写出了但读不回：`Invalid fuel name: MOX-241!`\n\n");
        report.append("`HellrageWriter` 把燃料的**显示名**写进 `UsedFuel.Name`，而 Hellrage 系列 reader 用该名字回查燃料。\n");
        report.append("名字对不上就抛 `IllegalArgumentException`。这是**同一类根因**的又一实例：\n");
        report.append("把「显示名」当标识符用（见 `docs/r0/findings.md` §7 与重写方案 §2 根因 5）。\n\n");
        report.append("### 3. `bg-string` 无法表示 oredict 方块\n\n");
        report.append("`Cannot export element definition in BG String: oredict (blockGraphite)`。\n");
        report.append("Building Gadget 字符串格式无法表达 oredict 引用的方块，属于格式能力限制，非缺陷。\n\n");
        report.append("### 4. `hellrage` 必然丢失外壳\n\n");
        report.append("`HellrageWriter.java:54` 明确跳过外壳方块（注释原文 `can't save the casing :(`）。\n");
        report.append("所以该格式只比对内部方块；TS 侧实现时必须复刻这一行为，否则往返断言会误报。\n\n");
        report.append("### 5. `png` 需要 GL，headless 下无法测试\n\n");
        report.append("`PNGWriter` 要渲染多方块并用字体测量文本，headless 下 NPE（`Font.getStringWidth`）。\n");
        report.append("这一项需要在有 GL 的环境单独验证。\n\n");

        report.append("## TS 实现的验收口径\n\n");
        report.append("1. **格式读取**：新实现必须能把 `datasets/fixtures/` 里每个文件读成与上表一致的反应堆；\n");
        report.append("   注意 `ncpf-*` / `legacy-ncpf` 三个文件**当前 Java 版自己都读不回**，所以对它们要按\n");
        report.append("   「应当能读回」（修复后语义）而非「复刻当前行为」来验收；\n");
        report.append("2. **格式写出**：`ncpf-save` 全保真、`ncpf-export` 走 `makePartial` + 裁剪 `plannerator:*`；\n");
        report.append("3. **配方引用**：不要用「配置内索引 + 结构相等」表示配方，直接用元素身份；\n");
        report.append("   这同时消除了本报告发现 1 的整类问题；\n");
        report.append("4. **外壳语义**：Hellrage 读写都不含外壳，比对时必须只比内部方块。\n\n");
        report.append("---\n\n");
        report.append("## 汇总\n\n");
        report.append("| 项 | 数值 |\n|---|---:|\n");
        report.append("| 尝试写出 | ").append(writers.size()).append(" |\n");
        report.append("| 写出成功 | ").append(written).append(" |\n");
        report.append("| 写出失败 | ").append(writeFail).append(" |\n");
        report.append("| 读回失败 | ").append(readFail).append(" |\n");
        report.append("| 内部方块指纹一致 | ").append(interiorOk).append(" |\n");
        report.append("| 内部方块指纹不一致 | ").append(interiorBad).append(" |\n");
        report.append('\n');
        report.append("> ⚠️ 这批 fixtures 由当前 Java 版生成，因此它们固化了**当前实现的输出**，\n");
        report.append("> 而不是历史版本的真实文件。要做到后者，需要收集社区的真实老存档（见 `docs/r0/findings.md` §10）。\n");

        Files.write(Paths.get(reportPath), report.toString().getBytes(StandardCharsets.UTF_8));

        System.out.println();
        System.out.println("=== fixture summary ===");
        System.out.println("written            : "+written+" / "+writers.size());
        System.out.println("write failures     : "+writeFail);
        System.out.println("read failures      : "+readFail);
        System.out.println("interior match     : "+interiorOk);
        System.out.println("interior mismatch  : "+interiorBad);
        System.out.println("fixtures dir       : "+dir.getAbsolutePath());
        System.out.println("report             : "+reportPath);
    }

    // ---------------------------------------------------------------------------

    private interface Writer{
        void write(Project project, OutputStream stream) throws Exception;
    }

    private static String writerName(String key){
        switch(key){
            case "ncpf-save": return "`NCPFFileWriter`";
            case "ncpf-export": return "`NCPFWriter`";
            case "legacy-ncpf": return "`LegacyNCPFWriter`";
            case "hellrage": return "`HellrageWriter`";
            case "bg-string": return "`BGStringWriter`";
            case "png": return "`PNGWriter`";
            default: return key;
        }
    }

    /** A small, deterministic, *valid* reactor: full casing + a structured interior. */
    private static Multiblock<?> buildReactor(boolean underhaul){
        if(underhaul)return buildUnderhaulReactor();
        OverhaulSFR sfr = new OverhaulSFR(Core.project.conglomeration, SIZE_X, SIZE_Y, SIZE_Z, null);
        sfr.buildDefaultCasing();

        ArrayList<Block> available = new ArrayList<>();
        sfr.getAvailableBlocks(available);
        ArrayList<Block> cells = new ArrayList<>();
        ArrayList<Block> mods = new ArrayList<>();
        ArrayList<Block> sinks = new ArrayList<>();
        for(Block b : available){
            BlockElement t = b.template;
            if(t.casing!=null||t.controller!=null||t.coolantVent!=null||t.port!=null)continue;
            if(t.fuelCell!=null)cells.add(b);
            else if(t.moderator!=null)mods.add(b);
            else if(t.heatsink!=null)sinks.add(b);
        }
        if(cells.isEmpty())throw new IllegalStateException("no fuel cell template in configuration");

        List<Fuel> fuels = cells.get(0).template.fuels;
        if(fuels.isEmpty())throw new IllegalStateException("fuel cell has no fuels");
        Random rand = new Random(4321L);

        sfr.forEachInternalPosition((BlockPos pos) -> {
            Block chosen;
            int parity = (pos.x+pos.y+pos.z)&1;
            if(parity==0)chosen = cells.get(0);
            else if(!mods.isEmpty())chosen = mods.get(rand.nextInt(mods.size()));
            else if(!sinks.isEmpty())chosen = sinks.get(rand.nextInt(sinks.size()));
            else chosen = cells.get(0);
            Block placed = (Block)chosen.newInstance(pos);
            if(placed.template.fuelCell!=null)placed.fuel = fuels.get(rand.nextInt(fuels.size()));
            sfr.setBlock(pos, placed);
        });
        return sfr;
    }

    /** Underhaul SFR control case: no coolant recipe, fuel is a legacy_item. */
    private static net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.UnderhaulSFR buildUnderhaulReactor(){
        net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.UnderhaulSFR sfr =
                new net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.UnderhaulSFR(
                        Core.project.conglomeration, SIZE_X, SIZE_Y, SIZE_Z, null);
        sfr.buildDefaultCasing();

        ArrayList<net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block> available = new ArrayList<>();
        sfr.getAvailableBlocks(available);
        ArrayList<net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block> cells = new ArrayList<>();
        ArrayList<net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block> mods = new ArrayList<>();
        for(net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block b : available){
            net.ncplanner.plannerator.planner.ncpf.configuration.underhaulSFR.BlockElement t = b.template;
            if(t.casing!=null||t.controller!=null)continue;
            if(t.fuelCell!=null)cells.add(b);
            else if(t.moderator!=null)mods.add(b);
        }
        if(cells.isEmpty())throw new IllegalStateException("no underhaul fuel cell template");
        Random rand = new Random(4321L);

        sfr.forEachInternalPosition((BlockPos pos) -> {
            net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block chosen;
            if(((pos.x+pos.y+pos.z)&1)==0)chosen = cells.get(0);
            else if(!mods.isEmpty())chosen = mods.get(rand.nextInt(mods.size()));
            else chosen = cells.get(0);
            net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block placed =
                    (net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block)chosen.newInstance(pos);
            sfr.setBlock(pos, placed);
        });
        return sfr;
    }

    /** Walk a multiblock's interior and produce a language-independent fingerprint. */
    private static String interiorSignature(Multiblock<?> mb){
        List<String> parts = new ArrayList<>();
        try{
            net.ncplanner.plannerator.multiblock.CuboidalMultiblock<?> c =
                    (net.ncplanner.plannerator.multiblock.CuboidalMultiblock<?>)mb;
            c.forEachInternalPosition((BlockPos pos) -> {
                Object o = mb.getBlock(pos);
                if(o==null)return;
                parts.add(pos.x+","+pos.y+","+pos.z+"="+describe(o));
            });
        }catch(Throwable t){
            return "<"+shortMsg(t)+">";
        }
        java.util.Collections.sort(parts);
        return String.join(";", parts);
    }

    private static String describe(Object block){
        try{
            if(block instanceof net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block){
                net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block b =
                        (net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.Block)block;
                String name = b.template.getName()!=null?b.template.getName():"?";
                if(b.recipe!=null)name += ":"+(b.recipe.getName()!=null?b.recipe.getName():"?");
                return name;
            }
            Block b = (Block)block;
            String name = b.template.getName()!=null?b.template.getName():"?";
            if(b.fuel!=null)name += ":"+(b.fuel.getName()!=null?b.fuel.getName():"?");
            if(b.irradiatorRecipe!=null)name += ":"+(b.irradiatorRecipe.getName()!=null?b.irradiatorRecipe.getName():"?");
            return name;
        }catch(Throwable t){
            return block.getClass().getSimpleName();
        }
    }

    private static int countInterior(Multiblock<?> mb){
        final int[] n = new int[1];
        try{
            ((net.ncplanner.plannerator.multiblock.CuboidalMultiblock<?>)mb).forEachInternalPosition((BlockPos pos) -> {
                if(mb.getBlock(pos)!=null)n[0]++;
            });
        }catch(Throwable t){
            return -1;
        }
        return n[0];
    }

    private static int countShell(Multiblock<?> mb){
        int n = 0;
        try{
            net.ncplanner.plannerator.multiblock.CuboidalMultiblock<?> c =
                    (net.ncplanner.plannerator.multiblock.CuboidalMultiblock<?>)mb;
            for(int x = 0; x<=c.getInternalWidth()+1; x++){
                for(int y = 0; y<=c.getInternalHeight()+1; y++){
                    for(int z = 0; z<=c.getInternalDepth()+1; z++){
                        if(x>0&&y>0&&z>0&&x<=c.getInternalWidth()&&y<=c.getInternalHeight()&&z<=c.getInternalDepth())continue;
                        if(mb.getBlock(new BlockPos(x, y, z))!=null)n++;
                    }
                }
            }
        }catch(Throwable t){
            return -1;
        }
        return n;
    }

    private static Multiblock<?> firstMultiblock(Project p){
        for(Design d : p.designs){
            if(!(d instanceof MultiblockDesign))continue;
            MultiblockDesign<?, ?> md = (MultiblockDesign<?, ?>)d;
            try{
                md.convertElements();
                return md.toMultiblock();
            }catch(Throwable t){
                System.out.println("  (design "+d.definition.type+" failed to convert: "+shortMsg(t)+")");
            }
        }
        return null;
    }

    private static String append(String a, String b){
        if(a==null||a.isEmpty())return b;
        if(b==null||b.isEmpty())return a;
        return a+"；"+b;
    }

    private static String shortMsg(Throwable t){
        String m = t.getClass().getSimpleName()+": "+String.valueOf(t.getMessage());
        if(m.length()>110)m = m.substring(0, 110)+"…";
        return m.replace("|", "\\|");
    }
}
