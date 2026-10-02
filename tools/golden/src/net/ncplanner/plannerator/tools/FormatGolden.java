package net.ncplanner.plannerator.tools;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Supplier;
import java.util.stream.Stream;

import net.ncplanner.plannerator.ncpf.NCPFElement;
import net.ncplanner.plannerator.ncpf.configuration.NCPFConfiguration;
import net.ncplanner.plannerator.planner.file.FileReader;
import net.ncplanner.plannerator.planner.file.ncpf.NCPFFileWriter;
import net.ncplanner.plannerator.planner.ncpf.Addon;
import net.ncplanner.plannerator.planner.ncpf.Project;

/**
 * R2 — format-compatibility golden generator.
 *
 * <p>R2's acceptance criteria ("the TS reader reads fixture X into an equivalent
 * project") need an <em>oracle</em>, not a hand-written expectation. This tool
 * runs the frozen Java reader chain ({@code FileReader.read}) over every fixture
 * and records, per file:
 *
 * <ul>
 *   <li>the effective reader (which format won);</li>
 *   <li>element and design counts (identical to the R0 coverage tables);</li>
 *   <li>the language-independent structural fingerprint
 *       ({@code RoundTrip.signature}, the 38/38 baseline function);</li>
 *   <li>the converted project written out as NCPF JSON
 *       ({@code NCPFFileWriter} / {@code JSONNCPFWriter}), so the TS side can
 *       diff its own conversion cell by cell instead of only comparing hashes.</li>
 * </ul>
 *
 * <p>Usage:
 * <pre>
 *   FormatGolden --convert datasets/fixtures datasets/converted
 *   FormatGolden --probe  some-file.ncpf          # read with the real chain
 *   FormatGolden --fingerprint some-file.ncpf     # same, fingerprint only
 * </pre>
 *
 * <p>{@code --probe} exists so the TS writers can be validated the way iron law 5
 * demands: a file written by TS is fed back into the frozen Java reader.
 */
public class FormatGolden{
    public static void main(String[] args) throws Exception{
        Bootstrap.init();

        if(args.length>=3&&args[0].equals("--convert")){
            convert(new File(args[1]), new File(args[2]));
            return;
        }
        if(args.length>=2&&(args[0].equals("--probe")||args[0].equals("--fingerprint"))){
            probe(new File(args[1]));
            return;
        }
        System.err.println("usage: FormatGolden --convert <fixturesDir> <outDir>");
        System.err.println("       FormatGolden --probe <file>");
        System.exit(2);
    }

    // ------------------------------------------------------------------ convert

    private static void convert(File root, File outDir) throws Exception{
        List<Path> files = new ArrayList<>();
        try(Stream<Path> s = Files.walk(root.toPath())){
            s.filter(Files::isRegularFile).forEach(files::add);
        }
        Collections.sort(files);

        File jsonDir = new File(outDir, "ncpf");
        jsonDir.mkdirs();

        StringBuilder manifest = new StringBuilder();
        manifest.append("{\n");
        manifest.append("  \"tool\": \"FormatGolden\",\n");
        manifest.append("  \"root\": \"").append(esc(root.getPath().replace('\\', '/'))).append("\",\n");
        manifest.append("  \"entries\": [\n");

        int ok = 0, bad = 0, skipped = 0;
        List<String> entries = new ArrayList<>();
        for(Path p : files){
            String name = root.toPath().relativize(p).toString().replace('\\', '/');
            String base = p.getFileName().toString();
            if(base.equals("README.md")||base.equals("MANIFEST.txt")||base.endsWith(".md")){
                skipped++;
                continue;
            }
            String rel = name.replace('/', '_');
            StringBuilder e = new StringBuilder();
            e.append("    {");
            e.append("\"file\": \"").append(esc(name)).append("\", ");
            String eff = effectiveReader(p.toFile());
            e.append("\"reader\": \"").append(esc(eff)).append("\", ");
            try{
                Project project = FileReader.read(p.toFile());
                if(project==null)throw new IllegalStateException("reader chain returned null");
                String fingerprint = signature(project);
                int elements = countElements(project);
                int designs = project.designs.size();
                String outName = rel.endsWith(".json") ? rel : rel + ".ncpf.json";
                File outFile = new File(jsonDir, outName);
                NCPFFileWriter.write(project, outFile, NCPFFileWriter.formats.get(0));
                e.append("\"ok\": true, ");
                e.append("\"elements\": ").append(elements).append(", ");
                e.append("\"designs\": ").append(designs).append(", ");
                e.append("\"fingerprint\": \"").append(fingerprint).append("\", ");
                e.append("\"converted\": \"ncpf/").append(esc(outName)).append("\"");
                ok++;
                System.out.println(String.format("%-34s OK   %-28s elems=%-5d designs=%-3d %s",
                        name, eff, elements, designs, fingerprint));
            }catch(Throwable t){
                String msg = shortMsg(t);
                e.append("\"ok\": false, ");
                e.append("\"error\": \"").append(esc(msg)).append("\"");
                bad++;
                System.out.println(String.format("%-34s FAIL %-28s %s", name, eff, msg));
            }
            e.append("}");
            entries.add(e.toString());
        }
        manifest.append(String.join(",\n", entries)).append('\n');
        manifest.append("  ],\n");
        manifest.append("  \"summary\": {\"ok\": ").append(ok).append(", \"failed\": ").append(bad)
                .append(", \"skipped\": ").append(skipped).append("}\n");
        manifest.append("}\n");

        Files.write(new File(outDir, "MANIFEST.json").toPath(),
                manifest.toString().getBytes(StandardCharsets.UTF_8));
        System.out.println();
        System.out.println("=== converted ===");
        System.out.println("read OK : "+ok);
        System.out.println("failed  : "+bad);
        System.out.println("skipped : "+skipped);
        System.out.println("manifest: "+new File(outDir, "MANIFEST.json").getPath());
    }

    // -------------------------------------------------------------------- probe

    private static void probe(File file) throws Exception{
        System.out.println("file      : "+file.getAbsolutePath());
        System.out.println("reader    : "+effectiveReader(file));
        try{
            Project project = FileReader.read(file);
            if(project==null)throw new IllegalStateException("reader chain returned null");
            System.out.println("read      : OK");
            System.out.println("elements  : "+countElements(project));
            System.out.println("designs   : "+project.designs.size());
            for(net.ncplanner.plannerator.planner.ncpf.Design d : project.designs){
                System.out.println("  design  : "+d.definition.type);
            }
            System.out.println("fingerprint: "+signature(project));
        }catch(Throwable t){
            System.out.println("read      : FAILED");
            System.out.println("exception : "+shortMsg(t));
            System.exit(1);
        }
    }

    // ------------------------------------------------------------------ helpers

    private static String effectiveReader(File f){
        for(net.ncplanner.plannerator.planner.file.FormatReader r : FileReader.formats){
            String name = r.getClass().getSimpleName();
            if(name.equals("NCPFReader"))continue;
            try{
                if(r.formatMatches(provider(f)))return name;
            }catch(Throwable ignored){
            }
        }
        return "NCPFReader (catch-all)";
    }

    private static Supplier<InputStream> provider(File f){
        return () -> {
            try{
                return new FileInputStream(f);
            }catch(Exception ex){
                return null;
            }
        };
    }

    private static String shortMsg(Throwable t){
        StringBuilder sb = new StringBuilder();
        Throwable c = t;
        while(c!=null&&sb.length()<220){
            if(sb.length()>0)sb.append(" <- ");
            sb.append(c.getClass().getSimpleName()).append(": ").append(String.valueOf(c.getMessage()));
            c = c.getCause();
        }
        return sb.toString().replace('\n', ' ');
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

    /** Verbatim copy of {@code RoundTrip.signature(Project)} — the 38/38 baseline. */
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

    private static String esc(String s){
        StringBuilder sb = new StringBuilder();
        for(char c : s.toCharArray()){
            switch(c){
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if(c<0x20)sb.append(String.format("\\u%04x", (int)c));
                    else sb.append(c);
            }
        }
        return sb.toString();
    }
}
