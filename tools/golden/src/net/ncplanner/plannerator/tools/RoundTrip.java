package net.ncplanner.plannerator.tools;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.stream.Stream;

import net.ncplanner.plannerator.ncpf.NCPFElement;
import net.ncplanner.plannerator.ncpf.configuration.NCPFConfiguration;
import net.ncplanner.plannerator.planner.file.FileReader;
import net.ncplanner.plannerator.planner.file.ncpf.JSONNCPFWriter;
import net.ncplanner.plannerator.planner.file.ncpf.NCPFFileReader;
import net.ncplanner.plannerator.planner.file.ncpf.NCPFFileWriter;
import net.ncplanner.plannerator.planner.file.writer.NCPFWriter;
import net.ncplanner.plannerator.planner.ncpf.Addon;
import net.ncplanner.plannerator.planner.ncpf.Project;

/**
 * R0.4 — format round-trip harness over the real shipped corpus.
 *
 * <p>The repository ships no historical sample files, so the compatibility
 * baseline is established against the one real corpus we do have: the 34
 * {@code *.ncpf.json} configurations under {@code src/configurations/}
 * (~10 MB, the production data users actually load).
 *
 * <p>For every file this does:
 * <pre>
 *   read  -> Project a
 *   write -> bytes   (NCPFWriter + JSONNCPFWriter, the current production writer)
 *   read  -> Project b
 *   compare signature(a) vs signature(b)
 * </pre>
 *
 * <p>The signature is a language-independent structural fingerprint: every
 * configuration, every element identity, its display name, and the element
 * count. Configs whose reader/writer pair is lossy show up immediately, which
 * is exactly the regression baseline the TypeScript port needs to match.
 *
 * <p>Usage: {@code RoundTrip [configDir] [outReport]}
 */
public class RoundTrip{
    public static void main(String[] args) throws Exception{
        Bootstrap.init();

        // `--coverage <fixturesDir> <reportPath>`: run the real reader chain over every
        // fixture and emit a per-fixture reader-coverage table. This is the R0.4
        // evidence that every shipped reader that *can* be exercised was exercised.
        if(args.length>=2&&args[0].equals("--coverage")){
            File dir = new File(args[1]);
            String reportPath = args.length>2?args[2]:null;
            File[] files = dir.listFiles();
            Arrays.sort(files, (a, b) -> a.getName().compareTo(b.getName()));
            StringBuilder md = new StringBuilder();
            md.append("# R0.4 — reader 覆盖表：`").append(dir.getName()).append("`\n\n");
            md.append("> 由 `net.ncplanner.plannerator.tools.RoundTrip --coverage` 生成。\n>\n");
            md.append("> 「同时匹配」一列很重要：`NCPFReader` 的 `formatMatches` 恒为 true（它靠 `read()` 返回 null 让位），\n");
            md.append("> 而 LegacyNCPF / Hellrage 各版本靠版本号互相排斥，正常情况下**只有一个**版本 reader 匹配。\n");
            md.append("> 若某版本出现两个匹配，说明版本判定有歧义。\n>\n");
            md.append("> 对 `datasets/fixtures/` 里每个文件跑**真实的 reader 链**（`FileReader.read`），\n");
            md.append("> 记录命中的 reader、是否读入、以及读出多少元素。\n\n");
            md.append("| fixture | 命中的 reader | 同时匹配（含 catch-all） | 读入 | 元素数 | 设计数 | 结果 |\n");
            md.append("|---|---|---|:--:|---:|---:|---|\n");
            int ok = 0, bad = 0;
            for(File f : files){
                if(!f.isFile())continue;
                if(f.getName().equals("README.md"))continue;
                if(f.getName().equals("MANIFEST.txt"))continue;
                String eff = effectiveReader(f);
                String state, elems = "—", designs = "—", note = "";
                try{
                    Project p = FileReader.read(f);
                    if(p==null)throw new IllegalStateException("reader chain returned null");
                    state = "✅";
                    ok++;
                    elems = String.valueOf(countElements(p));
                    designs = String.valueOf(p.designs.size());
                }catch(Throwable t){
                    state = "❌";
                    bad++;
                    note = shortMsg(t);
                }
                md.append("| `").append(f.getName()).append("` | `").append(eff).append("` | ")
                  .append(matchingReaders(f)).append(" | ")
                  .append(state).append(" | ").append(elems).append(" | ").append(designs).append(" | ")
                  .append(note).append(" |\n");
                System.out.println(String.format("%-28s %-28s %s  elems=%s designs=%s %s",
                        f.getName(), eff, state, elems, designs, note));
            }
            md.append('\n');
            md.append("## 汇总\n\n");
            md.append("| 项 | 数值 |\n|---|---:|\n");
            md.append("| fixture 数 | ").append(ok+bad).append(" |\n");
            md.append("| 读入成功 | ").append(ok).append(" |\n");
            md.append("| 读入失败 | ").append(bad).append(" |\n");
            if(reportPath!=null){
                java.nio.file.Files.write(java.nio.file.Paths.get(reportPath),
                        md.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                System.out.println("report        : "+reportPath);
            }
            return;
        }

        // `--check <file>`: run the REAL reader chain on a single file and report
        // the outcome, which reader won, and what came out. Used to prove causality
        // for format bugs and to attribute coverage per fixture.
        if(args.length>=2&&args[0].equals("--check")){
            File f = new File(args[1]);
            System.out.println("checking      : "+f.getAbsolutePath()+" ("+f.length()+" bytes)");
            System.out.println("matching      : "+matchingReaders(f));
            System.out.println("effective     : "+effectiveReader(f));
            try{
                Project p = FileReader.read(f);// full chain, as the app does
                if(p==null)throw new IllegalStateException("reader chain returned null");
                System.out.println("read          : OK");
                System.out.println("designs       : "+p.designs.size());
                for(net.ncplanner.plannerator.planner.ncpf.Design d : p.designs){
                    System.out.println("   - "+d.definition.type);
                }
                System.out.println("elements      : "+countElements(p));
                System.out.println("displays      : "+countDisplayNames(p));
                return;
            }catch(Throwable t){
                System.out.println("read          : FAILED");
                System.out.println("exception     : "+t);
                Throwable c = t.getCause();
                while(c!=null){
                    System.out.println("caused by     : "+c);
                    c = c.getCause();
                }
                System.exit(1);
            }
        }

        // `fusion_test.ncpf.json` ships in the repo but its module is inactive by
        // default, so a default install cannot read it. Activate it here so the
        // format baseline covers every shipped file.
        Bootstrap.activateModule("fusion_test");

        String dir = args.length>0?args[0]:"src/configurations";
        String out = args.length>1?args[1]:null;

        // make sure the production writer has its format plugged in
        NCPFWriter.format = new JSONNCPFWriter();

        List<Path> files = new ArrayList<>();
        try(Stream<Path> s = Files.walk(Paths.get(dir))){
            s.filter(p -> p.toString().endsWith(".ncpf.json")).forEach(files::add);
        }
        Collections.sort(files);

        StringBuilder report = new StringBuilder();
        report.append("# R0.4 — NCPF 格式往返测试报告\n\n");
        report.append("> 由 `net.ncplanner.plannerator.tools.RoundTrip` 生成。\n>\n");
        report.append("> 对象：`src/configurations/**/*.ncpf.json`（生产数据，");
        report.append(files.size()).append(" 个文件）。\n");
        report.append("> 流程：read → 写出 → 再 read → 比对结构指纹。\n\n");
        report.append("## ⚠️ 项目里有**两个** NCPF writer，保真度不同\n\n");
        report.append("| writer | 用在哪 | 行为 |\n");
        report.append("|---|---|---|\n");
        report.append("| `NCPFFileWriter`（`Core.java:611`） | **用户保存工程** | `project.convertToObject()` 后直接写，**不裁剪任何模块** |\n");
        report.append("| `NCPFWriter`（`FileWriter.NCPF`，`MenuMain:316-320`） | **导出单个多方块** | 写完后 `trimPlanneratorModules()`：**删掉所有非 `ncpf:` 前缀的模块**，即 `plannerator:display_name` / `plannerator:texture` / `plannerator:legacy_names` 全部丢失 |\n\n");
        report.append("所以本表分两列分别测。**生产保存路径（`NCPFFileWriter`）是必须完全保真的那一个**；\n");
        report.append("导出路径的丢失是设计如此，但 TS 侧必须显式实现两种语义，不能混用。\n\n");
        report.append("| 文件 | 大小 | 元素数 | 显示名 | 生产保存往返 | 导出往返* | 备注 |\n");
        report.append("|---|---:|---:|---:|:--:|:--:|---|\n");

        int okSave = 0, badSave = 0, okExport = 0, badExport = 0, failed = 0;
        long totalBytes = 0;

        for(Path p : files){
            String name = p.toString().replace('\\', '/');
            long size = Files.size(p);
            totalBytes += size;
            String saveState = "—", exportState = "—", note = "";
            int elems = -1, displays = -1, exportDisplays = -1;
            try{
                Project a = readFile(p);
                if(a==null)throw new IllegalStateException("reader returned null");
                String sigA = signature(a);
                elems = countElements(a);
                displays = countDisplayNames(a);

                // ---- production save path: NCPFFileWriter (no trimming) ----
                ByteArrayOutputStream bos1 = new ByteArrayOutputStream();
                NCPFFileWriter.write(a, bos1, NCPFFileWriter.formats.get(0));
                Project b1 = readBack(bos1.toByteArray());
                if(sigA.equals(signature(b1))){
                    saveState = "✅";
                    okSave++;
                }else{
                    saveState = "❌";
                    badSave++;
                    note = "生产保存路径指纹不同(元素 "+elems+"→"+countElements(b1)+")";
                }

                // ---- export path: NCPFWriter (makePartial + trims plannerator:*) ----
                // For a *configuration* file there are no designs, so makePartial()
                // strips every unreferenced element and the writer additionally drops
                // all plannerator:* modules. That is by design, so this column only
                // carries a verdict when the file actually contains designs.
                boolean hasDesigns = !a.designs.isEmpty();
                if(!hasDesigns){
                    exportState = "n/a";
                }else{
                    ByteArrayOutputStream bos2 = new ByteArrayOutputStream();
                    new NCPFWriter().write(a, bos2);
                    Project b2 = readBack(bos2.toByteArray());
                    exportDisplays = countDisplayNames(b2);
                    if(structureSignature(a).equals(structureSignature(b2))){
                        exportState = "✅";
                        okExport++;
                    }else{
                        exportState = "❌";
                        badExport++;
                    }
                }
            }catch(Throwable t){
                failed++;
                String msg = t.getClass().getSimpleName()+": "+String.valueOf(t.getMessage());
                if(msg.length()>80)msg = msg.substring(0, 80)+"…";
                note = msg.replace("|", "\\|");
                if(saveState.equals("—"))saveState = "❌";
                if(exportState.equals("—"))exportState = "❌";
            }
            report.append("| `").append(name).append("` | ")
                  .append(String.format("%.1f KB", size/1024.0)).append(" | ")
                  .append(elems<0?"—":String.valueOf(elems)).append(" | ")
                  .append(displays<0?"—":String.valueOf(displays)).append(" | ")
                  .append(saveState).append(" | ").append(exportState).append(" | ")
                  .append(note).append(" |\n");
        }

        report.append('\n');
        report.append("## 汇总\n\n");
        report.append("| 项 | 数值 |\n|---|---:|\n");
        report.append("| 文件数 | ").append(files.size()).append(" |\n");
        report.append("| 语料总大小 | ").append(String.format("%.1f MB", totalBytes/1048576.0)).append(" |\n");
        report.append("| **生产保存往返一致（`NCPFFileWriter`）** | **").append(okSave).append(" / ").append(files.size()).append("** |\n");
        report.append("| 生产保存往返不一致 | ").append(badSave).append(" |\n");
        report.append("| 导出往返结构一致（`NCPFWriter`，仅含有设计的文件） | ").append(okExport).append(" |\n");
        report.append("| 导出往返结构不一致 | ").append(badExport).append(" |\n");
        report.append("| 抛异常 | ").append(failed).append(" |\n");
        report.append('\n');
        report.append("\\* **导出往返**列对配置类文件标 `n/a`：`NCPFWriter` 会先调 `makePartial()`，");
        report.append("只保留被设计引用到的元素，再裁掉所有 `plannerator:*` 模块。");
        report.append("配置文件里没有设计，所以元素会被全部剥离 —— 这是**设计如此**，不是缺陷。");
        report.append("该列只有在文件本身含设计时才有判定意义。\n");
        report.append('\n');
        report.append("## TS 实现的验收标准\n\n");
        report.append("1. 对同一批 `*.ncpf.json`，读入后的**结构指纹**与 Java 版一致；\n");
        report.append("2. 用「生产保存」语义写出的文件，能被冻结的 Java 版 `NCPFFileReader` 回读成**相同指纹**；\n");
        report.append("3. 用「导出」语义写出的文件，结构保留、`plannerator:*` 模块按规则裁剪。\n");

        System.out.println();
        System.out.println("=== round-trip summary ===");
        System.out.println("files                : "+files.size());
        System.out.println("total corpus         : "+String.format("%.1f MB", totalBytes/1048576.0));
        System.out.println("save path OK         : "+okSave+" / "+files.size());
        System.out.println("save path differ     : "+badSave);
        System.out.println("export path structure OK : "+okExport);
        System.out.println("export path structure bad: "+badExport);
        System.out.println("threw                : "+failed);

        if(out!=null){
            Files.write(Paths.get(out), report.toString().getBytes(StandardCharsets.UTF_8));
            System.out.println("report           : "+out);
        }
    }

    /**
     * Readers whose {@code formatMatches} accepts this file. {@code NCPFReader} always
     * matches by design (it defers by returning null from {@code read()}), so it is
     * listed but is never the effective one for a non-NCPF file.
     */
    private static String matchingReaders(File f){
        StringBuilder sb = new StringBuilder();
        for(net.ncplanner.plannerator.planner.file.FormatReader r : FileReader.formats){
            try{
                if(r.formatMatches(() -> {
                    try{
                        return new FileInputStream(f);
                    }catch(Exception ex){
                        return null;
                    }
                })){
                    if(sb.length()>0)sb.append(", ");
                    sb.append(r.getClass().getSimpleName());
                }
            }catch(Throwable ignored){
            }
        }
        return sb.length()==0?"(none)":sb.toString();
    }

    /** First reader in chain order that actually wins, ignoring the NCPF catch-all. */
    private static String effectiveReader(File f){
        for(net.ncplanner.plannerator.planner.file.FormatReader r : FileReader.formats){
            String name = r.getClass().getSimpleName();
            if(name.equals("NCPFReader"))continue;
            try{
                if(r.formatMatches(() -> {
                    try{
                        return new FileInputStream(f);
                    }catch(Exception ex){
                        return null;
                    }
                })){
                    return name;
                }
            }catch(Throwable ignored){
            }
        }
        // nothing else matched: the NCPF catch-all wins
        return "NCPFReader (catch-all)";
    }

    private static String shortMsg(Throwable t){
        String m = t.getClass().getSimpleName()+": "+String.valueOf(t.getMessage());
        if(m.length()>110)m = m.substring(0, 110)+"…";
        return m.replace("|", "\\|");
    }

    private static Project readBack(byte[] bytes) throws Exception{
        final byte[] b = bytes;
        return NCPFFileReader.read(() -> new ByteArrayInputStream(b), null);
    }

    /** Count elements that carry an explicit display name (plannerator:display_name). */
    private static int countDisplayNames(Project p){
        int n = 0;
        for(NCPFConfiguration cfg : p.configuration.configurations.values()){
            for(List<NCPFElement> list : cfg.getAllElementsISaidAllElements()){
                for(NCPFElement e : list){
                    try{
                        net.ncplanner.plannerator.planner.ncpf.module.DisplayNameModule m =
                                e.getModule(net.ncplanner.plannerator.planner.ncpf.module.DisplayNameModule::new);
                        if(m!=null&&m.displayName!=null)n++;
                    }catch(Throwable t){
                        // ignore
                    }
                }
            }
        }
        return n;
    }

    /**
     * Structure-only fingerprint: element identities and counts, but WITHOUT the
     * plannerator-specific display names/textures that the export writer trims.
     */
    private static String structureSignature(Project p) throws Exception{
        List<String> lines = new ArrayList<>();
        for(NCPFConfiguration cfg : p.configuration.configurations.values()){
            lines.add("cfg|"+cfg.getName());
            for(List<NCPFElement> list : cfg.getAllElementsISaidAllElements()){
                for(NCPFElement e : list){
                    try{
                        lines.add("el|"+cfg.getName()+"|"+e.definition.type+"|"+e.definition.toString());
                    }catch(Throwable t){
                        lines.add("el|"+cfg.getName()+"|<unstringifiable>");
                    }
                }
            }
        }
        Collections.sort(lines);
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        StringBuilder sb = new StringBuilder();
        for(String l : lines)sb.append(l).append('\n');
        byte[] d = md.digest(sb.toString().getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for(int i = 0; i<12; i++)hex.append(String.format("%02x", d[i]));
        return hex+"#"+lines.size();
    }

    private static Project readFile(Path p) throws Exception{
        final File f = p.toFile();
        return NCPFFileReader.read(() -> {
            try{
                return new FileInputStream(f);
            }catch(Exception ex){
                return null;
            }
        }, f);
    }

    private static int countElements(Project p){
        int n = 0;
        for(NCPFConfiguration cfg : p.configuration.configurations.values()){
            for(List<NCPFElement> list : cfg.getAllElementsISaidAllElements())n += list.size();
        }
        for(Addon a : p.addons){
            for(NCPFConfiguration cfg : a.configuration.configurations.values()){
                for(List<NCPFElement> list : cfg.getAllElementsISaidAllElements())n += list.size();
            }
        }
        return n;
    }

    /** Language-independent structural fingerprint. */
    private static String signature(Project p) throws Exception{
        List<String> lines = new ArrayList<>();
        for(NCPFConfiguration cfg : p.configuration.configurations.values()){
            lines.add("cfg|"+cfg.getName());
            for(List<NCPFElement> list : cfg.getAllElementsISaidAllElements()){
                for(NCPFElement e : list){
                    lines.add("el|"+cfg.getName()+"|"+safe(e));
                }
            }
        }
        for(Addon a : p.addons){
            lines.add("addon|"+safeName(a));
            for(NCPFConfiguration cfg : a.configuration.configurations.values()){
                for(List<NCPFElement> list : cfg.getAllElementsISaidAllElements()){
                    for(NCPFElement e : list){
                        lines.add("ael|"+safeName(a)+"|"+cfg.getName()+"|"+safe(e));
                    }
                }
            }
        }
        Collections.sort(lines);
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        StringBuilder sb = new StringBuilder();
        for(String l : lines)sb.append(l).append('\n');
        byte[] d = md.digest(sb.toString().getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for(int i = 0; i<12; i++)hex.append(String.format("%02x", d[i]));
        return hex+"#"+lines.size();
    }

    private static String safe(NCPFElement e){
        try{
            return e.definition.type+"|"+e.definition.toString()+"|"+e.getDisplayName();
        }catch(Throwable t){
            return "<unstringifiable>";
        }
    }

    private static String safeName(Addon a){
        try{
            return a.getName();
        }catch(Throwable t){
            return "<unnamed>";
        }
    }
}
