package net.ncplanner.plannerator.tools;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;

import net.ncplanner.plannerator.multiblock.AbstractBlock;
import net.ncplanner.plannerator.multiblock.BlockPos;
import net.ncplanner.plannerator.multiblock.CuboidalMultiblock;
import net.ncplanner.plannerator.multiblock.Multiblock;
import net.ncplanner.plannerator.multiblock.overhaul.fissionmsr.OverhaulMSR;
import net.ncplanner.plannerator.multiblock.overhaul.fissionsfr.OverhaulSFR;
import net.ncplanner.plannerator.multiblock.overhaul.turbine.OverhaulTurbine;
import net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.UnderhaulSFR;
import net.ncplanner.plannerator.ncpf.NCPFElement;
import net.ncplanner.plannerator.planner.Core;
import net.ncplanner.plannerator.planner.ncpf.Project;
import net.ncplanner.plannerator.planner.ncpf.design.MultiblockDesign;

/**
 * R0.2 / R0.3 — headless golden-dataset generator.
 *
 * <p>Boots the plannerator domain layer with no GL context (see {@link Bootstrap}),
 * builds reactors of a chosen type, evaluates them, and writes one JSON object per
 * line to a JSONL golden dataset.
 *
 * <p><b>Two engines.</b> Only two reactor types ship a second "lite" physics
 * implementation used by the generator:
 * <ul>
 *   <li>{@code sfr} → Overhaul SFR, editor + lite</li>
 *   <li>{@code underhaul-sfr} → Underhaul SFR, editor + lite</li>
 * </ul>
 * For every other type ({@code msr}, {@code turbine}, {@code fusion}, {@code distiller})
 * only the editor engine exists, so the record carries golden stats with
 * {@code "lite": null} and an empty divergence set. Those records are still the
 * reference the TypeScript port must reproduce.
 *
 * <p><b>Stats are extracted by reflection</b> over the multiblock's numeric fields
 * (including private ones, which is necessary — most of the interesting counters are
 * private). That keeps the tool type-agnostic and captures every stat a new
 * implementation has to match, rather than a hand-picked subset.
 *
 * <p><b>Divergence</b> is computed over every numeric field present in BOTH engines.
 * Where the two engines genuinely disagree, that is recorded per field.
 *
 * <p>Usage:
 * <pre>
 *   GoldenGen --type sfr --cases 5000 --out golden.jsonl --seed 20260101
 *   GoldenGen --type underhaul-sfr --cases 3000 --out usfr.jsonl
 *   GoldenGen --type msr --cases 1000 --out msr.jsonl
 *   GoldenGen --diag --type msr --min-size 5 --max-size 5
 * </pre>
 */
public class GoldenGen{
    private static final int STRAT_RANDOM = 0;
    private static final int STRAT_MIXED = 1;
    private static final int STRAT_FUEL_MOD = 2;
    private static final int STRAT_FUEL_ONLY = 3;
    private static final int STRAT_CASING_ONLY = 4;
    private static final int STRAT_FUEL_HEATSINK = 5;
    private static final int STRAT_CHECKER = 6;
    private static final String[] STRAT_NAMES = {
        "random", "mixed", "fuel_mod", "fuel_only", "casing_only", "fuel_heatsink", "checker"
    };

    /** Template module fields that mean "this block is a shell, not interior". */
    private static final String[] SHELL_MODULES = {"casing", "controller", "coolantVent", "port"};
    /** Template module fields that classify an interior block, in priority order. */
    private static final String[] INTERIOR_MODULES = {
        "fuelCell", "fuelVessel", "moderator", "heatsink", "cooler", "reflector",
        "neutronShield", "irradiator", "neutronSource", "conductor", "heater",
        "blade", "stator", "coil", "bearing", "shaft", "connector", "core",
        "breedingBlanket", "heatingBlanket", "electromagnet", "heatsinkComponent"
    };

    /**
     * Numeric fields that are bookkeeping rather than results, so they are excluded
     * from the golden record and from divergence comparison.
     */
    private static final List<String> NON_RESULT_FIELDS = Arrays.asList(
            "calcStep", "calcSubstep", "steps", "stps", "somethingChanged",
            // wall-clock timestamp written by Multiblock.resetMetadata(); including it
            // would make the dataset non-reproducible
            "lastChangeTime",
            // interior dimensions; already carried by the record's "size" field
            "x", "y", "z"
    );

    private static boolean verbose = false;
    private static boolean diag = false;
    /** Print per-block engine state after recalculation (debugging aid). */
    private static boolean dumpBlocks = false;
    /** When set, only dump the block state of cases whose id contains this text. */
    private static String dumpBlocksFilter = null;
    /**
     * R1.0a: evaluate every case this many times and compare the numeric stats,
     * to measure whether the frozen engine is bit-for-bit repeatable. Required
     * before a tolerance can be fixed.
     */
    private static int repeat = 1;
    private static int repeatCompared = 0;
    private static int repeatDiffering = 0;
    private static final java.util.LinkedHashMap<String, Integer> repeatFields = new java.util.LinkedHashMap<>();
    private static int repeatMaxUlps = 0;

    // ---------------------------------------------------------------------------
    // reactor type registry
    // ---------------------------------------------------------------------------

    private static class ReactorSpec{
        final String key;            // CLI name
        final String definitionName; // Multiblock.getDefinitionName()
        final boolean hasLite;
        /** Module that must be active for this type's config to be readable (or null). */
        final String requiredModule;
        /** Why this type cannot be exercised at all, or null if it can. */
        final String unsupported;
        ReactorSpec(String key, String definitionName, boolean hasLite){
            this(key, definitionName, hasLite, null, null);
        }
        ReactorSpec(String key, String definitionName, boolean hasLite, String requiredModule, String unsupported){
            this.key = key;
            this.definitionName = definitionName;
            this.hasLite = hasLite;
            this.requiredModule = requiredModule;
            this.unsupported = unsupported;
        }
    }

    private static final Map<String, ReactorSpec> TYPES = new LinkedHashMap<>();
    static{
        ReactorSpec sfr = new ReactorSpec("sfr", "Overhaul SFR", true);
        ReactorSpec usfr = new ReactorSpec("underhaul-sfr", "Underhaul SFR", true);
        ReactorSpec msr = new ReactorSpec("msr", "Overhaul MSR", false);
        ReactorSpec turbine = new ReactorSpec("turbine", "Overhaul Turbine", false);
        // The fusion reactor is only registered once the (default-inactive)
        // fusion_test module is on, and it is NOT a CuboidalMultiblock (toroidal
        // geometry), so this cuboidal-grid harness cannot build it.
        ReactorSpec fusion = new ReactorSpec("fusion", "Overhaul Fusion Reactor", false, "fusion_test",
                "OverhaulFusionReactor is not a CuboidalMultiblock (toroidal/tokamak geometry), so this "
                +"cuboidal-grid harness cannot construct it; it needs its own generator");
        // No shipped configuration contains distiller settings at all
        // (nuclearcraft.ncpf.json holds only turbine/msr/sfr/underhaul_sfr), so
        // OverhaulDistiller cannot be instantiated. It is a WIP feature.
        ReactorSpec distiller = new ReactorSpec("distiller", "Overhaul Distiller", false, null,
                "no shipped configuration contains Overhaul Distiller settings "
                +"(see docs/r0/golden-datasets.md); the multiblock type exists but is unusable with the default config");
        for(ReactorSpec s : new ReactorSpec[]{sfr, usfr, msr, turbine, fusion, distiller})TYPES.put(s.key, s);
    }

    // ---------------------------------------------------------------------------

    public static void main(String[] args) throws Exception{
        int cases = 200;
        String out = "golden.jsonl";
        long seed = 1L;
        int minSize = 3;
        int maxSize = 11;
        int maxDivergencePrint = 20;
        String strategiesArg = null;
        String typeKey = "sfr";
        String fromNcpf = null;

        for(int i = 0; i<args.length; i++){
            switch(args[i]){
                case "--cases": cases = Integer.parseInt(args[++i]); break;
                case "--out": out = args[++i]; break;
                case "--seed": seed = Long.parseLong(args[++i]); break;
                case "--min-size": minSize = Integer.parseInt(args[++i]); break;
                case "--max-size": maxSize = Integer.parseInt(args[++i]); break;
                case "--strategies": strategiesArg = args[++i]; break;
                case "--max-divergence-print": maxDivergencePrint = Integer.parseInt(args[++i]); break;
                case "--type": typeKey = args[++i]; break;
                case "--from-ncpf": fromNcpf = args[++i]; break;
                case "--verbose": verbose = true; break;
                case "--dump-blocks": dumpBlocks = true; break;
                case "--dump-blocks-id": dumpBlocks = true; dumpBlocksFilter = args[++i]; break;
                case "--repeat": repeat = Integer.parseInt(args[++i]); break;
                case "--diag": diag = true; cases = 1; verbose = true; break;
                case "--list-types":
                    for(ReactorSpec s : TYPES.values()){
                        System.out.println(String.format("%-16s definitionName=%-26s lite=%s",
                                s.key, s.definitionName, s.hasLite));
                    }
                    return;
                default:
                    System.err.println("Unknown argument: "+args[i]);
                    System.exit(2);
            }
        }

        ReactorSpec spec = TYPES.get(typeKey);
        if(spec==null){
            System.err.println("Unknown --type '"+typeKey+"'. Use --list-types.");
            System.exit(2);
        }

        System.out.println("=== NC Plannerator golden-data generator (R0.2/R0.3) ===");
        System.out.println("reactor type : "+spec.key+"  ("+spec.definitionName+", lite engine: "+spec.hasLite+")");
        if(spec.unsupported!=null){
            System.out.println();
            System.out.println("UNSUPPORTED: "+spec.unsupported);
            System.exit(3);
        }
        bootstrap();

        // Some types only exist once their (default-inactive) module is enabled,
        // which also loads that module's own configuration.
        if(spec.requiredModule!=null){
            if(!Bootstrap.activateModule(spec.requiredModule)){
                System.err.println("could not activate required module '"+spec.requiredModule+"'");
                System.exit(3);
            }
            useModuleConfiguration(spec.requiredModule);
        }

        // `--from-ncpf <fileOrDir>`: evaluate reactors from real project files instead
        // of generating random ones. This is how R0.3's "real user designs" gap gets
        // closed as soon as someone drops archives into a directory.
        if(fromNcpf!=null){
            importFromNcpf(fromNcpf, out, maxDivergencePrint);
            return;
        }

        Multiblock template = findTemplate(spec.definitionName);
        if(template==null)throw new IllegalStateException(
                "No registered Multiblock with definitionName '"+spec.definitionName+"'. "
                +"Is its module active? Registered: "+registeredNames());
        CuboidalMultiblock probe;
        try{
            probe = (CuboidalMultiblock)template.newInstance(Core.project.conglomeration);
        }catch(Throwable t){
            throw new IllegalStateException("cannot instantiate "+spec.definitionName
                    +" against the current configuration: "+t
                    +" (does the loaded configuration contain its settings?)", t);
        }
        int cfgMin = probe.getMinX();
        int cfgMax = probe.getMaxX();
        System.out.println("size bounds  : min="+cfgMin+" max="+cfgMax);
        minSize = Math.max(minSize, cfgMin);
        maxSize = Math.min(maxSize, cfgMax);
        if(minSize>maxSize)throw new IllegalStateException("Empty size range ("+minSize+".."+maxSize+")");

        List<Integer> strategies = new ArrayList<>();
        if(strategiesArg==null){
            for(int s = 0; s<STRAT_NAMES.length; s++)strategies.add(s);
        }else{
            for(String s : strategiesArg.split(",")){
                s = s.trim();
                boolean found = false;
                for(int k = 0; k<STRAT_NAMES.length; k++){
                    if(STRAT_NAMES[k].equals(s)){ strategies.add(k); found = true; }
                }
                if(!found)throw new IllegalArgumentException("Unknown strategy: "+s);
            }
        }

        Random rand = new Random(seed);
        int written = 0, failed = 0, errored = 0, diverged = 0, productive = 0, divergencesPrinted = 0;
        LinkedHashMap<String, Integer> divergenceByField = new LinkedHashMap<>();
        LinkedHashMap<String, int[]> strategyTotals = new LinkedHashMap<>();

        String prefix = spec.key.replace("underhaul-sfr", "usfr").replace("sfr", "sfr");

        try(BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(out), StandardCharsets.UTF_8))){
            w.write("{\"__meta\":{\"generator\":\"GoldenGen\",\"datasetVersion\":3"
                    +",\"reactorType\":\""+spec.key+"\""
                    +",\"definitionName\":\""+esc(spec.definitionName)+"\""
                    +",\"hasLiteEngine\":"+spec.hasLite
                    +",\"cases\":"+cases+",\"seed\":"+seed
                    +",\"minSize\":"+minSize+",\"maxSize\":"+maxSize
                    +",\"config\":\"nuclearcraft.ncpf.json\",\"engine\":\"java-final\""
                    +",\"templateNaming\":\"NCPFElementDefinition.toString() (injective)\""
                    +",\"recipeNaming\":\"NCPFElementDefinition.toString() (injective)\""
                    +",\"statsExtraction\":\"reflection over numeric fields (incl. private)\"}}\n");
            for(int i = 0; i<cases; i++){
                int strategy = strategies.get(rand.nextInt(strategies.size()));
                int sx = minSize+rand.nextInt(maxSize-minSize+1);
                int sy = minSize+rand.nextInt(maxSize-minSize+1);
                int sz = minSize+rand.nextInt(maxSize-minSize+1);
                String id = String.format("%s-%06d", prefix, i);
                try{
                    CaseResult r = runCase(id, spec, template, sx, sy, sz, strategy, rand);
                    if(r==null){ failed++; continue; }
                    w.write(r.toJson());
                    w.write('\n');
                    written++;
                    if(r.error!=null)errored++;
                    if(r.editorOutput()!=0.0)productive++;
                    String sname = STRAT_NAMES[strategy];
                    int[] tot = strategyTotals.get(sname);
                    if(tot==null){ tot = new int[2]; strategyTotals.put(sname, tot); }
                    tot[0]++;
                    if(!r.divergenceFields.isEmpty()){
                        tot[1]++;
                        for(String f : r.divergenceFields){
                            Integer c = divergenceByField.get(f);
                            divergenceByField.put(f, c==null?1:c+1);
                        }
                    }
                    if(!r.divergence.isEmpty()){
                        diverged++;
                        if(divergencesPrinted<maxDivergencePrint){
                            divergencesPrinted++;
                            System.out.println("DIVERGENCE "+id+" size=["+sx+","+sy+","+sz+"] strategy="
                                    +sname+" -> "+r.divergence);
                        }
                    }
                    if(verbose&&i%50==0)System.out.println("  ... "+i+"/"+cases);
                }catch(Throwable t){
                    failed++;
                    System.out.println("CASE FAILED "+id+" size=["+sx+","+sy+","+sz+"] strategy="
                            +STRAT_NAMES[strategy]+": "+t);
                    if(verbose)t.printStackTrace(System.out);
                }
                if((i+1)%100==0)System.out.println("progress "+(i+1)+"/"+cases
                        +" (written="+written+" failed="+failed+" diverged="+diverged+")");
            }
        }

        System.out.println("=== done ===");
        System.out.println("reactor type    : "+spec.key);
        System.out.println("cases requested : "+cases);
        System.out.println("written         : "+written);
        System.out.println("failed          : "+failed);
        System.out.println("editor crashed  : "+errored+" (recorded with an error field, no golden stats)");
        System.out.println("productive      : "+productive+" (editor output != 0)");
        if(spec.hasLite){
            System.out.println("diverged        : "+diverged
                    +(written>0?String.format(" (%.2f%%)", 100.0*diverged/written):""));
        }else{
            System.out.println("diverged        : n/a (no lite engine for this type)");
        }
        System.out.println("output          : "+new File(out).getAbsolutePath());
        if(productive==0&&written>0){
            System.out.println();
            System.out.println("WARNING: every case produced zero output. The generic reflection-driven");
            System.out.println("         interior fill does not synthesise a *working* reactor of this type;");
            System.out.println("         the records are still valid golden data (block grid + stats), but the");
            System.out.println("         stats are all zero, so they are weak reference values. Types that");
            System.out.println("         need reactor-specific structure (MSR vessel groups, turbine blades/");
            System.out.println("         coils) would need a dedicated builder. See docs/r0/golden-datasets.md.");
        }
        if(spec.hasLite){
            System.out.println();
            System.out.println("--- divergence by field (cases affected / total) ---");
            List<Map.Entry<String, Integer>> fe = new ArrayList<>(divergenceByField.entrySet());
            fe.sort((p, q) -> q.getValue()-p.getValue());
            for(Map.Entry<String, Integer> e : fe){
                System.out.println(String.format("  %-22s %6d  %5.1f%%", e.getKey(), e.getValue(),
                        written>0?100.0*e.getValue()/written:0));
            }
            if(fe.isEmpty())System.out.println("  (none)");
        }
        System.out.println();
        System.out.println("--- by strategy ---");
        for(Map.Entry<String, int[]> e : strategyTotals.entrySet()){
            int[] t = e.getValue();
            System.out.println(String.format("  %-16s %6d cases, %6d diverged (%5.1f%%)",
                    e.getKey(), t[0], t[1], t[0]>0?100.0*t[1]/t[0]:0));
        }
        if(repeat>1){
            System.out.println();
            System.out.println("--- repeatability (R1.0a: "+repeat+" evaluations per case) ---");
            System.out.println("re-evaluations  : "+repeatCompared);
            System.out.println("differing cases : "+repeatDiffering);
            System.out.println("max float ulps  : "+repeatMaxUlps);
            if(repeatFields.isEmpty()){
                System.out.println("result          : every numeric field is bit-for-bit identical");
            }else{
                System.out.println("fields that moved:");
                for(Map.Entry<String, Integer> e : repeatFields.entrySet()){
                    System.out.println("  "+e.getKey()+" x"+e.getValue());
                }
            }
        }
    }

    /** Delegates to {@link Bootstrap}; kept as a named seam for the tool's docs. */
    private static void bootstrap(){
        Bootstrap.init();
    }

    // ---------------------------------------------------------------------------
    // importing real project files
    // ---------------------------------------------------------------------------

    /**
     * Evaluate every multiblock design found in the given project file (or every
     * {@code .ncpf}/{@code .ncpf.json} under the given directory) and emit the same
     * golden records as the generator does, with {@code "strategy":"imported"}.
     *
     * <p>This is the harness side of R0.3's remaining gap: the divergence rates in
     * {@code docs/r0/golden-datasets.md} come from random grids, so they cannot be
     * extrapolated to hand-built reactors. Feed real designs in here to get a
     * representative set.
     *
     * <p>Each design is evaluated against <em>its own</em> project configuration (the
     * file carries it), which is why the design's {@code file} reference is left as
     * the reader set it.
     */
    private static void importFromNcpf(String path, String out, int maxDivergencePrint) throws Exception{
        List<File> files = new ArrayList<>();
        File root = new File(path);
        if(!root.exists())throw new IllegalArgumentException("--from-ncpf path does not exist: "+path);
        if(root.isDirectory())collectProjects(root, files);
        else files.add(root);
        Collections.sort(files);
        System.out.println("importing     : "+files.size()+" project file(s) under "+path);

        int written = 0, failed = 0, diverged = 0, errored = 0, designs = 0, divergencesPrinted = 0;
        try(BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(out), StandardCharsets.UTF_8))){
            w.write("{\"__meta\":{\"generator\":\"GoldenGen\",\"datasetVersion\":3"
                    +",\"source\":\"ncpf-import\",\"inputPath\":\""+esc(path)+"\""
                    +",\"files\":"+files.size()
                    +",\"statsExtraction\":\"reflection over numeric fields (incl. private)\"}}\n");
            for(File f : files){
                Project p;
                try{
                    p = net.ncplanner.plannerator.planner.file.FileReader.read(f);
                    if(p==null)throw new IllegalStateException("reader chain returned null");
                }catch(Throwable t){
                    failed++;
                    System.out.println("FILE FAILED "+f.getName()+": "+t);
                    continue;
                }
                int index = 0;
                for(Object d : p.designs){
                    index++;
                    if(!(d instanceof MultiblockDesign))continue;
                    designs++;
                    MultiblockDesign md = (MultiblockDesign)d;
                    Multiblock mb;
                    try{
                        md.convertElements();
                        mb = md.toMultiblock();
                    }catch(Throwable t){
                        failed++;
                        System.out.println("  DESIGN FAILED "+f.getName()+"#"+index+": "+t);
                        continue;
                    }
                    if(!(mb instanceof CuboidalMultiblock)){
                        System.out.println("  skipping non-cuboidal design "+f.getName()+"#"+index
                                +" ("+mb.getDefinitionName()+")");
                        continue;
                    }
                    ReactorSpec spec = specForDefinitionName(mb.getDefinitionName());
                    String id = baseName(f.getName())+"#"+index;
                    CaseResult r;
                    try{
                        r = evaluate(id, spec, -1, (CuboidalMultiblock)mb);
                    }catch(Throwable t){
                        failed++;
                        System.out.println("  CASE FAILED "+id+": "+t);
                        continue;
                    }
                    w.write(r.toJson());
                    w.write('\n');
                    written++;
                    if(r.error!=null)errored++;
                    if(!r.divergence.isEmpty()){
                        diverged++;
                        if(divergencesPrinted<maxDivergencePrint){
                            divergencesPrinted++;
                            System.out.println("DIVERGENCE "+id+" ("+r.type+") -> "+r.divergence);
                        }
                    }
                }
            }
        }
        System.out.println();
        System.out.println("=== import summary ===");
        System.out.println("files           : "+files.size());
        System.out.println("designs seen    : "+designs);
        System.out.println("records written : "+written);
        System.out.println("failed          : "+failed);
        System.out.println("editor crashed  : "+errored);
        if(written>0)System.out.println("diverged        : "+diverged
                +String.format(" (%.2f%%)", 100.0*diverged/written));
        System.out.println("output          : "+new File(out).getAbsolutePath());
    }

    private static void collectProjects(File dir, List<File> out){
        File[] children = dir.listFiles();
        if(children==null)return;
        for(File c : children){
            if(c.isDirectory())collectProjects(c, out);
            else{
                String n = c.getName().toLowerCase();
                // .ncpf / .ncpf.json carry Plannerator projects; plain .json may be a
                // Hellrage reactor file, which is where design-bearing archives live.
                if(n.endsWith(".ncpf")||n.endsWith(".ncpf.json")||n.endsWith(".json"))out.add(c);
            }
        }
    }

    private static String baseName(String fileName){
        String n = fileName;
        if(n.endsWith(".ncpf.json"))return n.substring(0, n.length()-".ncpf.json".length());
        if(n.endsWith(".ncpf"))return n.substring(0, n.length()-".ncpf".length());
        return n;
    }

    /** Map a {@code Multiblock.getDefinitionName()} onto a registered spec. */
    private static ReactorSpec specForDefinitionName(String definitionName){
        for(ReactorSpec s : TYPES.values()){
            if(s.definitionName.equals(definitionName))return s;
        }
        // unknown / addon reactor type: no lite engine, key derived from the name
        return new ReactorSpec(definitionName.toLowerCase().replace(' ', '-'), definitionName, false);
    }

    /**
     * Switches the active project configuration to the one a module contributed.
     *
     * <p>A module such as {@code fusion_test} registers its configuration into
     * {@link Configuration#configurations} but does <em>not</em> make it active —
     * in the app the user picks it. The generator needs it active because the
     * reactor is instantiated against {@code Core.project.conglomeration}.
     */
    private static void useModuleConfiguration(String moduleName){
        net.ncplanner.plannerator.planner.ncpf.Configuration chosen = null;
        for(net.ncplanner.plannerator.planner.ncpf.Configuration c
                : net.ncplanner.plannerator.planner.ncpf.Configuration.configurations){
            if(c==net.ncplanner.plannerator.planner.ncpf.Configuration.NUCLEARCRAFT)continue;
            if(net.ncplanner.plannerator.planner.ncpf.Configuration.internalConfigurations.contains(c))continue;
            chosen = c;// last non-internal configuration wins
        }
        if(chosen==null){
            System.out.println("[config] no configuration contributed by module '"+moduleName+"'; keeping the default");
            return;
        }
        Core.setConfiguration(chosen);
        System.out.println("[config] switched to module configuration: "+chosen.getName());
    }

    // ---------------------------------------------------------------------------
    // type lookup
    // ---------------------------------------------------------------------------

    private static Multiblock findTemplate(String definitionName){
        for(Multiblock m : Core.multiblockTypes){
            if(definitionName.equals(m.getDefinitionName()))return m;
        }
        return null;
    }

    private static String registeredNames(){
        StringBuilder sb = new StringBuilder();
        for(Multiblock m : Core.multiblockTypes){
            if(sb.length()>0)sb.append(", ");
            sb.append(m.getDefinitionName());
        }
        return sb.toString();
    }

    // ---------------------------------------------------------------------------
    // one case
    // ---------------------------------------------------------------------------

    private static class CaseResult{
        String id;
        String type;
        int strategy;
        int x, y, z;
        int[] grid;            // template index per flattened position; -1 = empty
        int[] recipes;         // recipe index per flattened position; -1 = none
        String[] blockNames;
        String[] recipeNames;
        TreeMap<String, Object> editor;
        TreeMap<String, Object> lite;
        /** Non-null when the editor engine itself threw (e.g. the irradiator-branch NPE). */
        String error;
        List<String> divergence = new ArrayList<>();
        List<String> divergenceFields = new ArrayList<>();

        /**
         * Best-effort "is this reactor doing anything" probe, type agnostic.
         * Scans every stat whose name looks like an output/power figure, because the
         * field name differs per reactor type (Overhaul SFR uses totalOutput, MSR uses
         * totalTotalOutput, turbines use totalPower, ...).
         */
        double editorOutput(){
            double best = 0;
            for(Map.Entry<String, Object> e : editor.entrySet()){
                if(!(e.getValue() instanceof Number))continue;
                String k = e.getKey().toLowerCase();
                if(!k.contains("output")&&!k.contains("power"))continue;
                double v = Math.abs(((Number)e.getValue()).doubleValue());
                if(Double.isNaN(v))continue;
                if(v>best)best = v;
            }
            return best;
        }

        String toJson(){
            StringBuilder sb = new StringBuilder(1024);
            sb.append("{\"id\":\"").append(id).append('"');
            sb.append(",\"type\":\"").append(esc(type)).append('"');
            sb.append(",\"strategy\":\"").append(strategy<0?"imported":STRAT_NAMES[strategy]).append('"');
            sb.append(",\"size\":[").append(x).append(',').append(y).append(',').append(z).append(']');
            sb.append(",\"blockNames\":").append(strArray(blockNames));
            sb.append(",\"recipeNames\":").append(strArray(recipeNames));
            sb.append(",\"grid\":").append(intArray(grid));
            sb.append(",\"recipes\":").append(intArray(recipes));
            if(error!=null)sb.append(",\"error\":\"").append(esc(error)).append('"');
            sb.append(",\"editor\":").append(map(editor));
            sb.append(",\"lite\":").append(lite==null?"null":map(lite));
            sb.append(",\"divergence\":{");
            for(int i = 0; i<divergence.size(); i++){
                if(i>0)sb.append(',');
                sb.append(divergence.get(i));
            }
            sb.append("}}");
            return sb.toString();
        }
    }

    @SuppressWarnings({"rawtypes","unchecked"})
    private static CaseResult runCase(String id, ReactorSpec spec, Multiblock template,
            int x, int y, int z, int strategy, Random rand){
        Multiblock mb = template.newInstance(Core.project.conglomeration, x, y, z);
        if(!(mb instanceof CuboidalMultiblock))throw new IllegalStateException(
                spec.definitionName+" is not a CuboidalMultiblock; this harness only handles cuboidal reactors");
        CuboidalMultiblock cub = (CuboidalMultiblock)mb;
        cub.buildDefaultCasing();
        // R1.0b / R1.0c: the generic reflection fill below cannot synthesise a
        // *working* MSR or Turbine (see docs/r0/golden-datasets.md §4 and §7):
        // the reflection pool is category-blind, so it never produces contiguous
        // fuel-vessel groups with valid heaters, nor a blade/stator/coil rotor.
        // Those two types get a dedicated constructor each.
        if("msr".equals(spec.key))fillMSRInterior((OverhaulMSR)cub, rand);
        else if("turbine".equals(spec.key))fillTurbineInterior((OverhaulTurbine)cub, rand);
        else fillInterior(cub, strategy, rand);
        return evaluate(id, spec, strategy, cub);
    }

    /**
     * Record and evaluate an already-built reactor. Shared by generated cases and by
     * reactors imported from a real project file ({@code --from-ncpf}).
     */
    @SuppressWarnings({"rawtypes","unchecked"})
    private static CaseResult evaluate(String id, ReactorSpec spec, int strategy, CuboidalMultiblock cub){
        CaseResult res = new CaseResult();
        res.id = id;
        res.type = spec.key;
        res.strategy = strategy;

        // ---- record the grid (shell + interior), language independent ----------
        int dimX = cub.getInternalWidth()+2;
        int dimY = cub.getInternalHeight()+2;
        int dimZ = cub.getInternalDepth()+2;
        res.x = dimX; res.y = dimY; res.z = dimZ;
        int[] grid = new int[dimX*dimY*dimZ];
        int[] recipes = new int[dimX*dimY*dimZ];
        Arrays.fill(grid, -1);
        Arrays.fill(recipes, -1);
        LinkedHashMap<String, Integer> blockIndex = new LinkedHashMap<>();
        LinkedHashMap<String, Integer> recipeIndex = new LinkedHashMap<>();
        for(int gx = 0; gx<dimX; gx++){
            for(int gy = 0; gy<dimY; gy++){
                for(int gz = 0; gz<dimZ; gz++){
                    Object b = cub.getBlock(new BlockPos(gx, gy, gz));
                    if(b==null)continue;
                    int idx = gx*dimY*dimZ+gy*dimZ+gz;
                    String name = templateName(b);
                    Integer bi = blockIndex.get(name);
                    if(bi==null){ bi = blockIndex.size(); blockIndex.put(name, bi); }
                    grid[idx] = bi;
                    String recipe = recipeName(b);
                    if(recipe!=null){
                        Integer ri = recipeIndex.get(recipe);
                        if(ri==null){ ri = recipeIndex.size(); recipeIndex.put(recipe, ri); }
                        recipes[idx] = ri;
                    }
                }
            }
        }
        res.grid = grid;
        res.recipes = recipes;
        res.blockNames = blockIndex.keySet().toArray(new String[0]);
        res.recipeNames = recipeIndex.keySet().toArray(new String[0]);

        // ---- engine 1: editor simulator (the golden value) ---------------------
        // The editor engine can throw on some layouts (a known missing null guard at
        // OverhaulSFR.java:1024). Record it as an explicit errored case rather than
        // silently dropping it: the frozen engine crashing here is data too.
        try{
            cub.clearCaches();
            cub.recalculate();
            res.editor = numericStats(cub);
            if(repeat>1)checkRepeatability(cub, res);
            if(dumpBlocks)dumpBlockStates(id, cub);
        }catch(Throwable t){
            res.error = t.getClass().getSimpleName()+": "+String.valueOf(t.getMessage());
            res.editor = new TreeMap<>();
            if(diag)printDiagnostics(spec, cub, res);
            return res;
        }
        // ---- engine 2: lite engine, when the type has one ----------------------
        if(spec.hasLite){
            TreeMap<String, Object> liteStats = null;
            try{
                Object lite = compile(cub);
                if(lite==null){
                    res.divergence.add("\"__lite_error\":\"no lite engine instance\"");
                }else{
                    calculateLite(lite);
                    liteStats = numericStats(lite);
                }
            }catch(Throwable t){
                res.divergence.add("\"__lite_error\":\""+esc(String.valueOf(t))+"\"");
            }
            res.lite = liteStats;
            if(liteStats!=null)compare(res, res.editor, liteStats);
        }

        if(diag)printDiagnostics(spec, cub, res);
        return res;
    }

    /**
     * R1.0a — re-evaluate the same reactor `repeat-1` more times and compare every
     * numeric field bit for bit. In-place re-evaluation is deliberate: it also
     * exercises the state that {@code recalculate()} is supposed to reset.
     */
    @SuppressWarnings({"rawtypes","unchecked"})
    private static void checkRepeatability(CuboidalMultiblock cub, CaseResult res){
        TreeMap<String, Object> first = res.editor;
        for(int run = 1; run<repeat; run++){
            cub.clearCaches();
            cub.recalculate();
            TreeMap<String, Object> again = numericStats(cub);
            repeatCompared++;
            boolean differed = false;
            for(Map.Entry<String, Object> e : first.entrySet()){
                Object b = again.get(e.getKey());
                if(b==null)continue;
                if(!(e.getValue() instanceof Number)||!(b instanceof Number))continue;
                double da = ((Number)e.getValue()).doubleValue();
                double db = ((Number)b).doubleValue();
                if(Double.compare(da, db)==0)continue;
                if(Double.isNaN(da)&&Double.isNaN(db))continue;
                differed = true;
                repeatFields.merge(e.getKey(), 1, Integer::sum);
                int ulps = ulpDistance((float)da, (float)db);
                if(ulps>repeatMaxUlps)repeatMaxUlps = ulps;
                System.out.println("NON-REPEATABLE "+res.id+" run="+run+" "+e.getKey()
                        +" first="+da+" again="+db+" (float ulps="+ulps+")");
            }
            if(differed)repeatDiffering++;
        }
    }

    /** Distance between two floats in units-in-the-last-place (Infinity if signs differ). */
    private static int ulpDistance(float a, float b){
        if(Float.isNaN(a)||Float.isNaN(b))return 0;
        int ia = Float.floatToIntBits(a);
        int ib = Float.floatToIntBits(b);
        if(ia<0)ia = 0x80000000-ia;
        if(ib<0)ib = 0x80000000-ib;
        long d = Math.abs((long)ia-(long)ib);
        return d>Integer.MAX_VALUE?Integer.MAX_VALUE:(int)d;
    }


    private static Object compile(CuboidalMultiblock cub) throws Exception{
        // Multiblock.compile() is generic; both SFR types implement it.
        java.lang.reflect.Method m = cub.getClass().getMethod("compile");
        return m.invoke(cub);
    }

    /**
     * Per-block engine state after {@code recalculate()} — the ground truth for
     * debugging a port that gets the aggregate numbers wrong on a few layouts.
     * Fields are read reflectively so the dump works for every reactor type.
     */
    @SuppressWarnings({"rawtypes","unchecked"})
    private static void dumpBlockStates(String id, CuboidalMultiblock cub){
        if(dumpBlocksFilter!=null&&!id.contains(dumpBlocksFilter))return;
        System.out.println("=== BLOCK DUMP "+id+" (interior "
                +cub.getInternalWidth()+"x"+cub.getInternalHeight()+"x"+cub.getInternalDepth()+") ===");
        String[] fields = {"neutronFlux","moderatorLines","positionalEfficiency","efficiency",
            "hadFlux","wasActive","hasPropogated","moderatorValid","moderatorActive",
            "heatsinkValid","reflectorActive","shieldActive","casingValid","valid",
            "adjacentCells","adjacentModerators","energyMult","heatMult","coolerValid"};
        for(int x = 0; x<cub.getExternalWidth(); x++){
            for(int y = 0; y<cub.getExternalHeight(); y++){
                for(int z = 0; z<cub.getExternalDepth(); z++){
                    Object b = cub.getBlock(new BlockPos(x, y, z));
                    if(b==null)continue;
                    Object template = field(b, "template");
                    StringBuilder sb = new StringBuilder();
                    sb.append(x).append(',').append(y).append(',').append(z).append(' ')
                      .append(template instanceof NCPFElement?((NCPFElement)template).definition.toString():"?");
                    Object fuel = field(b, "fuel");
                    if(fuel instanceof NCPFElement)sb.append(" fuel=").append(((NCPFElement)fuel).definition.toString());
                    Object recipe = field(b, "irradiatorRecipe");
                    if(recipe!=null)sb.append(" irradiatorRecipe=").append(recipe.getClass().getSimpleName());
                    Object heater = field(b, "heaterRecipe");
                    if(heater!=null)sb.append(" heaterRecipe=").append(heater.getClass().getSimpleName());
                    Object active = field(b, "recipe");
                    if(active instanceof NCPFElement)sb.append(" recipe=").append(((NCPFElement)active).definition.toString());
                    Object source = field(b, "source");
                    sb.append(" source=").append(source==null?"-":"yes");
                    Object coilMod = template==null?null:field(template, "coil");
                    if(coilMod!=null){
                        sb.append(" isCoil=yes isActive=").append(((AbstractBlock)b).isActive());
                        Object rulesObj = field(coilMod, "rules");
                        if(rulesObj instanceof List)for(Object ruleObj : (List<?>)rulesObj){
                            sb.append(" ruleOk=").append(
                                    ((net.ncplanner.plannerator.ncpf.NCPFPlacementRule)ruleObj)
                                            .isValid(((AbstractBlock)b), cub));
                        }
                    }
                    Object cluster = field(b, "cluster");
                    sb.append(" cluster=").append(cluster==null?"-":String.valueOf(System.identityHashCode(cluster)));
                    for(String f : fields){
                        Object v = field(b, f);
                        if(v!=null)sb.append(' ').append(f).append('=').append(v);
                    }
                    System.out.println(sb);
                }
            }
        }
        System.out.println("=== END BLOCK DUMP "+id+" ===");
    }

    private static void calculateLite(Object lite) throws Exception{
        java.lang.reflect.Method m = lite.getClass().getMethod("calculate");
        m.invoke(lite);
    }

    // ---------------------------------------------------------------------------
    // interior fill (reflection-based, type agnostic)
    // ---------------------------------------------------------------------------

    @SuppressWarnings({"rawtypes","unchecked"})
    private static void fillInterior(CuboidalMultiblock cub, int strategy, Random r){
        ArrayList<AbstractBlock> available = new ArrayList<>();
        cub.getAvailableBlocks(available);

        ArrayList<AbstractBlock> pool = new ArrayList<>();
        LinkedHashMap<String, ArrayList<AbstractBlock>> byCat = new LinkedHashMap<>();
        for(AbstractBlock b : available){
            Object t = field(b, "template");
            if(t==null)continue;
            if(isShell(t))continue;
            pool.add(b);
            String cat = category(t);
            if(cat==null)continue;
            ArrayList<AbstractBlock> list = byCat.get(cat);
            if(list==null){ list = new ArrayList<>(); byCat.put(cat, list); }
            list.add(b);
        }
        if(pool.isEmpty())throw new IllegalStateException("no interior-placeable blocks");

        final ArrayList<AbstractBlock> fPool = pool;
        final LinkedHashMap<String, ArrayList<AbstractBlock>> fByCat = byCat;
        final Random fr = r;
        cub.forEachInternalPosition(new java.util.function.Consumer<BlockPos>(){
            @Override
            public void accept(BlockPos pos){
            AbstractBlock chosen = null;
            switch(strategy){
                case STRAT_CASING_ONLY:
                    return;
                case STRAT_RANDOM:
                    chosen = fPool.get(fr.nextInt(fPool.size()));
                    break;
                case STRAT_MIXED:
                    chosen = weighted(fByCat, fr);
                    if(chosen==null)chosen = fPool.get(fr.nextInt(fPool.size()));
                    break;
                case STRAT_FUEL_MOD:
                    chosen = pick(fr, fByCat, fr.nextBoolean()?"fuelCell":"moderator");
                    break;
                case STRAT_FUEL_ONLY:
                    chosen = pick(fr, fByCat, "fuelCell");
                    break;
                case STRAT_FUEL_HEATSINK:
                    chosen = pick(fr, fByCat, fr.nextBoolean()?"fuelCell":"heatsink");
                    break;
                case STRAT_CHECKER:
                    chosen = (((pos.x+pos.y+pos.z)&1)==0)
                            ? pick(fr, fByCat, "fuelCell")
                            : pick(fr, fByCat, "moderator");
                    break;
                default:
                    chosen = fPool.get(fr.nextInt(fPool.size()));
            }
            if(chosen==null)chosen = fPool.get(fr.nextInt(fPool.size()));
            AbstractBlock placed = newInstanceAt(chosen, pos);
            assignRecipe(placed, fr);
            cub.setBlock(pos, placed);
            }
        });
    }

    private static AbstractBlock weighted(Map<String, ArrayList<AbstractBlock>> byCat, Random r){
        int[] weights = {32, 28, 20, 8, 6, 3, 2, 1};
        int total = 0;
        List<ArrayList<AbstractBlock>> lists = new ArrayList<>();
        List<Integer> ws = new ArrayList<>();
        int i = 0;
        for(Map.Entry<String, ArrayList<AbstractBlock>> e : byCat.entrySet()){
            int w = i<weights.length?weights[i]:1;
            if(!e.getValue().isEmpty()){ lists.add(e.getValue()); ws.add(w); total += w; }
            i++;
        }
        if(total<=0)return null;
        int roll = r.nextInt(total);
        for(int k = 0; k<lists.size(); k++){
            if(roll<ws.get(k))return lists.get(k).get(r.nextInt(lists.get(k).size()));
            roll -= ws.get(k);
        }
        return null;
    }

    private static AbstractBlock pick(Random r, Map<String, ArrayList<AbstractBlock>> byCat, String cat){
        ArrayList<AbstractBlock> list = byCat.get(cat);
        if(list==null||list.isEmpty())return null;
        return list.get(r.nextInt(list.size()));
    }

    private static AbstractBlock newInstanceAt(AbstractBlock block, BlockPos pos){
        try{
            java.lang.reflect.Method m = block.getClass().getMethod("newInstance", BlockPos.class);
            return (AbstractBlock)m.invoke(block, pos);
        }catch(Throwable t){
            throw new RuntimeException("cannot instantiate block "+block.getClass().getSimpleName(), t);
        }
    }

    private static void assignRecipe(AbstractBlock block, Random r){
        Object template = field(block, "template");
        if(template==null)return;
        // Template element lists that can supply a per-block recipe/fuel, and the
        // block field each one feeds.
        String[][] sources = {
            {"fuels", "fuel"},
            {"irradiatorRecipes", "irradiatorRecipe"},
            {"heaterRecipes", "heaterRecipe"},
            {"activeCoolerRecipes", "recipe"},
        };
        for(String[] pair : sources){
            Object listObj = field(template, pair[0]);
            if(!(listObj instanceof List))continue;
            List<?> list = (List<?>)listObj;
            if(list.isEmpty())continue;
            Object chosen = list.get(r.nextInt(list.size()));
            setField(block, pair[1], chosen);
            return;
        }
    }

    private static boolean isShell(Object template){
        for(String f : SHELL_MODULES){
            if(field(template, f)!=null)return true;
        }
        return false;
    }

    // ===========================================================================
    // R1.0b — dedicated Overhaul MSR constructor
    // ===========================================================================
    //
    // Why a dedicated constructor is required (docs/r0/golden-datasets.md §4/§7):
    // the generic reflection fill is category-blind. A random MSR gets fuel
    // vessels with no fuel, no contiguous groups, no valid heater adjacency and no
    // moderator lines, so `totalFuelVessels` is always 0 and every stat is 0 —
    // worthless as a golden reference.
    //
    // What a *working* MSR needs, read off OverhaulMSR's own physics:
    //
    //   * Vessel groups (OverhaulMSR.VesselGroup) are built by 4-adjacency flood
    //     fill over blocks with the *same template and the same Fuel instance*.
    //     Each group must be primed (`isPrimed()`), which for a self-priming fuel
    //     is satisfied as soon as `getSurfaceFactor() <= 1`. A single isolated
    //     vessel has 6 open faces → surface factor 1 → primed.
    //   * Flux (`propogateNeutronFlux`) only ever crosses a line of moderators:
    //     it walks up to `neutronReach+1` blocks and requires `length > 0` (i.e. at
    //     least one moderator) before it will give flux to another vessel. So the
    //     constructor must leave unblocked moderator runs between vessels.
    //   * Heaters must satisfy their template's placement rules, which always
    //     mention `fuel_vessel` and/or `moderator`/`casing` — never "nothing". The
    //     generic fill satisfies none of them, so `isHeaterActive()` is false and
    //     `cluster.totalCooling` stays 0.
    //   * A Cluster is created only by a block whose `createsCluster()` is true
    //     (fuel vessel / irradiator / neutron shield) and it must be connected to
    //     the wall. So at least one *active* fuel vessel has to touch a casing-ward
    //     moderator/block.
    //   * Output = sum over heater blocks of `cluster.efficiency * sparsityMult`,
    //     which is nonzero only if the cluster has active fuel vessels AND a heater
    //     with a recipe.
    //
    // The construction below is therefore:
    //
    //   - vessels on a coarse 3-cell lattice so moderator lines always exist
    //     between neighbouring vessels;
    //   - a fuel chosen from the *self-priming* subset of the vessel's fuels, so
    //     groups light up without needing a neutron source;
    //   - the lattice cells between/around vessels filled with moderators, except
    //     cells that would *block* a vessel-to-vessel moderator line;
    //   - heaters placed only on cells adjacent to a vessel that do not block such
    //     a line, and only using heater templates whose rules are satisfiable with
    //     fuel vessels + moderators (+ casing / neutron source) as neighbours;
    //   - reflectors / shields / conductors sprinkled into the remaining cells.
    //
    // (ASCII sketch: see docs/r1/msr-turbine-goldens.md)

    /**
     * True when both cells one and two steps along {@code (dx,dy,dz)} from
     * {@code (x,y,z)} are fuel vessels — i.e. {@code (x,y,z)} currently sits *on*
     * the moderator run between two vessels, so overwriting it with a heater would
     * sever the flux line.
     */
    private static boolean isVesselLine(int x, int y, int z, int dimX, int dimY, int dimZ,
            boolean[][][] isVessel, int dx, int dy, int dz){
        int x1 = x+dx, y1 = y+dy, z1 = z+dz;
        int x2 = x+2*dx, y2 = y+2*dy, z2 = z+2*dz;
        if(x1<1||y1<1||z1<1||x2<1||y2<1||z2<1)return false;
        if(x1>dimX||y1>dimY||z1>dimZ||x2>dimX||y2>dimY||z2>dimZ)return false;
        return isVessel[x1][y1][z1]&&isVessel[x2][y2][z2];
    }

    /**
     * Placement-rule feasibility for MSR heaters. Walks the rule tree and reports
     * whether it can hold when the only neighbours available are fuel vessels,
     * moderators, casings, neutron sources and heaters. A BETWEEN rule with
     * min &gt;= 1 needs at least one *possible* neighbour of the right kind; an
     * AXIAL rule needs two opposite neighbours, which for the tiny 1-wide MSR rule
     * set is not worth modelling precisely, so it is treated permissively.
     */
    private static void heaterRuleFeasible(Object rule, boolean targetIsHeater, boolean[] out){
        String type = String.valueOf(field(rule, "rule"));
        Boolean hasSubRules = null;
        Object rulesObj = field(rule, "rules");
        if(rulesObj instanceof List&&!((List<?>)rulesObj).isEmpty()){
            if("AND".equals(type)){
                for(Object sub : (List<?>)rulesObj)heaterRuleFeasible(sub, targetIsHeater, out);
            }else{// OR — satisfied if any branch is
                boolean[] any = new boolean[]{false, false};
                for(Object sub : (List<?>)rulesObj){
                    boolean[] sub1 = new boolean[]{true, false};
                    heaterRuleFeasible(sub, targetIsHeater, sub1);
                    if(sub1[0])any[0] = true;
                    if(sub1[1])any[1] = true;
                }
                out[0] &= any[0];
                out[1] |= any[1];
            }
            return;
        }
        if("AXIAL".equals(type)||"VERTEX".equals(type)||"EDGE".equals(type))return;//permissive
        Object target = field(rule, "target");
        String def = target==null?"":String.valueOf(field(target, "definition"));
        boolean needsHeater = def.contains("heater");
        boolean needsVessel = def.contains("fuel_vessel");
        boolean needsModerator = def.contains("moderator");
        boolean needsCasing = def.contains("casing");
        boolean feasible = true;
        if(needsHeater&&targetIsHeater)feasible = false;//we only ever place one heater template here
        if(!(needsHeater||needsVessel||needsModerator||needsCasing))feasible = false;//e.g. "exactly 2 <some other block>"
        out[0] &= feasible;
        if(!feasible)out[1] = true;
    }

    /** Can this heater template's rules hold in a vessel+moderator+casing reactor? */
    private static boolean heaterTemplateFits(Object template, boolean targetIsHeater){
        Object heater = field(template, "heater");
        if(heater==null)return false;
        Object rules = field(heater, "rules");
        if(!(rules instanceof List))return false;
        boolean[] out = new boolean[]{true, false};
        for(Object rule : (List<?>)rules)heaterRuleFeasible(rule, targetIsHeater, out);
        return out[0]&&!out[1];
    }

    /**
     * All block templates of a multiblock's configuration. As a side effect it
     * registers, per template object, the prototype block that
     * {@link #newInstanceAt} can instantiate — the configuration APIs hand out
     * {@code BlockElement}s (templates), not the per-reactor block wrappers, so the
     * builder needs that mapping to create a block for a template it picked itself.
     */
    @SuppressWarnings({"rawtypes","unchecked"})
    private static List<Object> templatesOf(CuboidalMultiblock cub){
        List<Object> out = new ArrayList<>();
        for(Object o : cub.<AbstractBlock>getAvailableBlocks()){
            AbstractBlock b = (AbstractBlock)o;
            Object t = field(b, "template");
            if(t==null)continue;
            out.add(t);
            PROTOTYPES.put(t, b);
        }
        return out;
    }

    @SuppressWarnings({"rawtypes","unchecked"})
    private static void fillMSRInterior(OverhaulMSR msr, Random r){
        List<Object> templates = templatesOf(msr);
        List<Object> vesselTemplates = new ArrayList<>();
        List<Object> moderatorTemplates = new ArrayList<>();
        List<Object> heaterTemplates = new ArrayList<>();
        List<Object> reflectorTemplates = new ArrayList<>();
        List<Object> shieldTemplates = new ArrayList<>();
        List<Object> conductorTemplates = new ArrayList<>();
        List<Object> sourceTemplates = new ArrayList<>();
        for(Object t : templates){
            if(field(t, "casing")!=null||field(t, "controller")!=null||field(t, "port")!=null)continue;
            if(field(t, "fuelVessel")!=null)vesselTemplates.add(t);
            if(field(t, "moderator")!=null)moderatorTemplates.add(t);
            if(field(t, "heater")!=null)heaterTemplates.add(t);
            if(field(t, "reflector")!=null)reflectorTemplates.add(t);
            if(field(t, "neutronShield")!=null)shieldTemplates.add(t);
            if(field(t, "conductor")!=null)conductorTemplates.add(t);
            if(field(t, "neutronSource")!=null)sourceTemplates.add(t);
        }
        if(vesselTemplates.isEmpty())throw new IllegalStateException(
                "Overhaul MSR configuration has no fuel-vessel block");
        if(moderatorTemplates.isEmpty())throw new IllegalStateException(
                "Overhaul MSR configuration has no moderator block");
        if(heaterTemplates.isEmpty())throw new IllegalStateException(
                "Overhaul MSR configuration has no heater block");

        final int dimX = msr.getInternalWidth();
        final int dimY = msr.getInternalHeight();
        final int dimZ = msr.getInternalDepth();
        final int volume = dimX*dimY*dimZ;

        Object vesselTemplate = vesselTemplates.get(r.nextInt(vesselTemplates.size()));
        // Highest-flux moderator: a vessel's activation depends on the flux its
        // moderator runs carry (`propogateNeutronFlux` sums `moderator.flux`), so a
        // low-flux moderator (Graphite: 10) makes small reactors fail to reach
        // criticality while the high-flux one (Heavy Water: 36) reaches it far more
        // often. The moderator is still chosen from the configuration rather than
        // hardcoded, by inspecting the module's `flux` setting.
        Object moderatorTemplate = moderatorTemplates.get(0);
        for(Object m : moderatorTemplates){
            Object mod = field(m, "moderator");
            Object best = field(moderatorTemplate, "moderator");
            if(mod==null||best==null)continue;
            Object flux = field(mod, "flux");
            Object bestFlux = field(best, "flux");
            if(flux instanceof Number&&bestFlux instanceof Number
                    &&((Number)flux).floatValue()>((Number)bestFlux).floatValue())moderatorTemplate = m;
        }
        Object reflectorTemplate = reflectorTemplates.isEmpty()?null
                :reflectorTemplates.get(r.nextInt(reflectorTemplates.size()));
        // A neutron shield is created toggled; place the *closed* variant (i.e. the
        // one whose template has no `unToggled`) so the constructor never has to
        // call Block.setToggled.
        Object shieldTemplate = null;
        if(!shieldTemplates.isEmpty()){
            shieldTemplate = shieldTemplates.get(r.nextInt(shieldTemplates.size()));
            Object un = field(shieldTemplate, "unToggled");
            if(un!=null)shieldTemplate = un;
        }
        Object conductorTemplate = conductorTemplates.isEmpty()?null
                :conductorTemplates.get(r.nextInt(conductorTemplates.size()));

        // Vessel fuels: only neutron sources let a non-self-priming fuel start, so
        // restrict to self-priming fuels. The fuel list lives on the vessel template
        // when the vessel has no recipe ports, otherwise on the template's parent.
        Object fuelOwner = vesselTemplate;
        if(field(fuelOwner, "fuels")==null||((List<?>)field(fuelOwner, "fuels")).isEmpty()){
            Object parent = field(vesselTemplate, "parent");
            if(parent!=null)fuelOwner = parent;
        }
        @SuppressWarnings("unchecked")
        List<Object> allFuels = (List<Object>)field(fuelOwner, "fuels");
        if(allFuels==null)allFuels = new ArrayList<>();
        List<Object> primingFuels = new ArrayList<>();
        for(Object f : allFuels){
            Object stats = field(f, "stats");
            Object sp = stats==null?null:field(stats, "selfPriming");
            if(Boolean.TRUE.equals(sp))primingFuels.add(f);
        }
        if(primingFuels.isEmpty())primingFuels.addAll(allFuels);
        if(primingFuels.isEmpty())throw new IllegalStateException(
                "Overhaul MSR fuel-vessel template exposes no fuels");

        Random rand = new Random(r.nextLong());

        // ---- 1. vessel lattice ------------------------------------------------
        // Vessels sit on a lattice of (x,y) every *2* cells and z every *2* cells,
        // starting at cell 1. Both spacings are forced by the physics:
        //
        //   * 2 along x/y so that two neighbouring vessels have exactly one
        //     moderator between them. `propogateNeutronFlux` walks outward and
        //     `break`s on the first empty cell and requires `length > 0`, so a pair
        //     with two or more cells between them never receives flux; one
        //     intervening moderator is precisely the "moderator line" it wants.
        //   * z: every 4th level. Vessels on consecutive levels would be 2 apart in
        //     z as well, and then *every* 6-neighbour of *every* vessel sits on a
        //     vessel-to-vessel moderator run, leaving no legal heater cell at all
        //     (measured 41% productive vs 52% here). Widening z also makes the
        //     x/y runs the ones that carry activation, which is why the x/y spacing
        //     is the tight one.
        boolean[][][] isVessel = new boolean[dimX+1][dimY+1][dimZ+1];
        boolean[][][] isHeater = new boolean[dimX+1][dimY+1][dimZ+1];
        for(int x = 1; x<=dimX; x++){
            for(int y = 1; y<=dimY; y++){
                for(int z = 1; z<=dimZ; z++){
                    if(((x-1)%2)==0&&((y-1)%2)==0&&((z-1)%4)==0)isVessel[x][y][z] = true;
                }
            }
        }

        // Place the vessels, grouping consecutive ones onto a shared fuel *instance*
        // (OverhaulMSR.VesselGroup is built by 4-adjacency over blocks with the same
        // template AND the same Fuel object, so sharing the instance is what makes a
        // multi-vessel group).
        List<BlockPos> vessels = new ArrayList<>();
        int groupSize = 1+rand.nextInt(volume>=64?3:2);
        int sinceGroup = 0;
        Object groupFuel = null;
        for(int z = 1; z<=dimZ; z++){
            for(int y = 1; y<=dimY; y++){
                for(int x = 1; x<=dimX; x++){
                    if(!isVessel[x][y][z])continue;
                    if(sinceGroup<=0){
                        groupFuel = primingFuels.get(rand.nextInt(primingFuels.size()));
                        sinceGroup = groupSize;
                    }
                    sinceGroup--;
                    BlockPos pos = new BlockPos(x, y, z);
                    Object b = newInstanceAt((AbstractBlock)PROTOTYPES.get(vesselTemplate), pos);
                    setField(b, "fuel", groupFuel);
                    msr.setBlock(pos, (net.ncplanner.plannerator.multiblock.overhaul.fissionmsr.Block)b);
                    vessels.add(pos);
                }
            }
        }

        // Moderator scaffold: every non-vessel cell starts life as a moderator, so
        // the reactor always has moderator lines available. Heaters/reflectors/
        // shields/conductors below selectively replace some of these cells — never
        // one that carries a vessel-to-vessel flux line.
        for(int x = 1; x<=dimX; x++){
            for(int y = 1; y<=dimY; y++){
                for(int z = 1; z<=dimZ; z++){
                    if(isVessel[x][y][z])continue;
                    placeMSRBlock(msr, moderatorTemplate, x, y, z, rand);
                }
            }
        }

        // ---- 2. heaters -------------------------------------------------------
        // A heater cell must be 6-adjacent to a vessel (so the heater's own
        // "at least 1 fuel vessel" rule can hold) and must not sit between two
        // vessels on an axis (that cell is the moderator run the flux crosses).
        // Only templates whose rule tree is satisfiable with fuel vessels +
        // moderators + casing are used, and they are tried in the order the config
        // lists them so the reactor gets a mix of cooling values.
        List<Object> fittingHeaters = new ArrayList<>();
        for(Object h : heaterTemplates){
            if(heaterTemplateFits(h, false))fittingHeaters.add(h);
        }
        if(fittingHeaters.isEmpty())fittingHeaters.addAll(heaterTemplates);
        List<BlockPos> heaterCells = new ArrayList<>();
        for(BlockPos v : vessels){
            for(int[] d : DIRS6){
                int x = v.x+d[0], y = v.y+d[1], z = v.z+d[2];
                if(x<1||y<1||z<1||x>dimX||y>dimY||z>dimZ)continue;
                if(isVessel[x][y][z]||isHeater[x][y][z])continue;
                boolean blocksLine = false;
                for(int[] ld : DIRS6){
                    if(isVesselLine(x, y, z, dimX, dimY, dimZ, isVessel, ld[0], ld[1], ld[2])){
                        blocksLine = true;
                        break;
                    }
                }
                if(blocksLine)continue;
                isHeater[x][y][z] = true;
                heaterCells.add(new BlockPos(x, y, z));
            }
        }
        double heaterRatio = 0.45+rand.nextDouble()*0.45;
        for(BlockPos p : heaterCells){
            if(rand.nextDouble()>heaterRatio)continue;
            Object t = fittingHeaters.get(rand.nextInt(fittingHeaters.size()));
            placeMSRBlock(msr, t, p.x, p.y, p.z, rand);
        }

        // ---- 3. reflectors / shields / conductors in the leftover cells -------
        double reflectorChance = reflectorTemplate==null?0:0.10+rand.nextDouble()*0.25;
        double shieldChance = shieldTemplate==null?0:0.05+rand.nextDouble()*0.15;
        double conductorChance = conductorTemplate==null?0:0.05+rand.nextDouble()*0.15;
        for(int x = 1; x<=dimX; x++){
            for(int y = 1; y<=dimY; y++){
                for(int z = 1; z<=dimZ; z++){
                    if(isVessel[x][y][z]||isHeater[x][y][z])continue;
                    double roll = rand.nextDouble();
                    if(reflectorTemplate!=null&&roll<reflectorChance){
                        placeMSRBlock(msr, reflectorTemplate, x, y, z, rand);
                    }else if(shieldTemplate!=null&&roll<reflectorChance+shieldChance){
                        placeMSRBlock(msr, shieldTemplate, x, y, z, rand);
                    }else if(conductorTemplate!=null&&roll<reflectorChance+shieldChance+conductorChance){
                        placeMSRBlock(msr, conductorTemplate, x, y, z, rand);
                    }
                }
            }
        }

        // ---- 4. one neutron source on the casing, aimed at the first vessel ---
        // Belt-and-braces: a self-priming group does not need one, but the source
        // makes the reactor work even for a fuel whose selfPriming flag we could not
        // read, and it exercises the neutron-source branch of the physics.
        if(!sourceTemplates.isEmpty()&&!vessels.isEmpty()){
            Object source = sourceTemplates.get(rand.nextInt(sourceTemplates.size()));
            for(int[] d : DIRS6){
                BlockPos v = vessels.get(0);
                BlockPos p = new BlockPos(v.x+d[0], v.y+d[1], v.z+d[2]);
                boolean onShell = p.x==0||p.y==0||p.z==0
                        ||p.x==dimX+1||p.y==dimY+1||p.z==dimZ+1;
                if(!onShell)continue;
                Object proto = PROTOTYPES.get(source);
                if(proto==null)continue;
                msr.setBlock(p, (net.ncplanner.plannerator.multiblock.overhaul.fissionmsr.Block)
                        newInstanceAt((AbstractBlock)proto, p));
                break;
            }
        }
    }

    @SuppressWarnings({"rawtypes","unchecked"})
    private static void placeMSRBlock(OverhaulMSR msr, Object template,
            int x, int y, int z, Random rand){
        Object proto = PROTOTYPES.get(template);
        if(proto==null)return;
        AbstractBlock placed = newInstanceAt((AbstractBlock)proto, new BlockPos(x, y, z));
        assignRecipe(placed, rand);
        msr.setBlock(new BlockPos(x, y, z),
                (net.ncplanner.plannerator.multiblock.overhaul.fissionmsr.Block)placed);
    }

    /** template -> the prototype AbstractBlock that {@link #newInstanceAt} understands. */
    private static final java.util.IdentityHashMap<Object, Object> PROTOTYPES
            = new java.util.IdentityHashMap<>();

    /** The six axis directions, as unit offsets. */
    private static final int[][] DIRS6 = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};

    // ===========================================================================
    // R1.0c — dedicated Overhaul Turbine constructor
    // ===========================================================================
    //
    // The generic fill cannot make a turbine work: `rotorValid` needs every z-slice
    // to be *completely* filled on the blade ring with a single consistent
    // template, and `totalEfficiency` is
    //     coilEfficiency * rotorEfficiency * throughputEfficiency * idealityMultiplier
    // so a zero coil efficiency (no valid coil) zeroes the output even with a
    // perfect rotor. See OverhaulTurbine.doCalculationStep cases 1-5.
    //
    // Layout produced here (relative to the turbine axis = z):
    //
    //        z=0            z=1 .. z=depth          z=depth+1
    //   +-----------+   +---------------------+   +-----------+
    //   | casing    |   | blade ring (one     |   | casing    |
    //   | + bearing |   | template per slice, |   | + bearing |
    //   | + coil    |   | stators mixed in)   |   | + coil    |
    //   | + inlet   |   | + shaft in the core |   | + outlet  |
    //   +-----------+   +---------------------+   +-----------+
    //
    // * bearing: the full central column, template `bearing` at both z faces and
    //   `shaft` for every interior z (exactly what case 1 validates).
    // * blade ring: every interior (x,y) where exactly one of x,y is inside the
    //   bearing column — the same region the Blade Suggestor fills. One template
    //   per z slice (blade or stator), chosen from the rotor's own blade/stator
    //   lists and biased to the highest expansion so `idealityMultiplier` is not
    //   degenerate.
    // * coils: placed on the interior ring that is 6-adjacent to the bearing, at
    //   z = 0 and z = depth+1 (the two faces `case 5` sums over), using the
    //   highest-efficiency template whose placement rules actually hold.
    // * connector: on the casing face next to a coil, so the connector's own rule
    //   ("at least 1 coil") holds and the coil gains a second valid neighbour.
    // * the default casing already supplies controller + inlet + outlet.

    @SuppressWarnings({"rawtypes","unchecked"})
    private static void fillTurbineInterior(OverhaulTurbine turbine, Random r){
        Random rand = new Random(r.nextLong());
        List<Object> all = templatesOf(turbine);
        List<Object> blades = new ArrayList<>();
        List<Object> stators = new ArrayList<>();
        List<Object> coils = new ArrayList<>();
        Object bearingTemplate = null, shaftTemplate = null, connectorTemplate = null;
        for(Object t : all){
            if(field(t, "blade")!=null)blades.add(t);
            if(field(t, "stator")!=null)stators.add(t);
            if(field(t, "coil")!=null)coils.add(t);
            if(bearingTemplate==null&&field(t, "bearing")!=null)bearingTemplate = t;
            if(shaftTemplate==null&&field(t, "shaft")!=null)shaftTemplate = t;
            if(connectorTemplate==null&&field(t, "connector")!=null)connectorTemplate = t;
        }
        if(blades.isEmpty())throw new IllegalStateException(
                "Overhaul Turbine configuration has no rotor blade block");
        if(bearingTemplate==null||shaftTemplate==null)throw new IllegalStateException(
                "Overhaul Turbine configuration has no bearing/shaft block");
        if(coils.isEmpty())throw new IllegalStateException(
                "Overhaul Turbine configuration has no dynamo coil block");

        // highest expansion blade / highest efficiency coil first (explicit
        // right-minus-left comparison so the direction is unambiguous)
        blades.sort((a, b) -> Float.compare(
                ((Number)field(field(a, "blade"), "expansion")).floatValue(),
                ((Number)field(field(b, "blade"), "expansion")).floatValue()));
        java.util.Collections.reverse(blades);
        coils.sort((a, b) -> Float.compare(
                ((Number)field(field(a, "coil"), "efficiency")).floatValue(),
                ((Number)field(field(b, "coil"), "efficiency")).floatValue()));
        java.util.Collections.reverse(coils);

        final int dimX = turbine.getInternalWidth();
        final int dimY = turbine.getInternalHeight();
        final int dimZ = turbine.getInternalDepth();

        // ---- 1. bearing / shaft ----------------------------------------------
        // `doCalculationStep` case 1 wraps its search in the labelled loop
        // `BEARING:` and `break BEARING`s out of it as soon as a diameter fails, so
        // the FIRST fitting diameter wins (the iterator steps by 2, so odd widths
        // start at 1 and even widths at 2). Its bounds are
        //     bearingMin = externalWidth/2 - i/2
        //     bearingMax = externalWidth/2 + i/2 - (i even ? 1 : 0)
        // and `case 2` uses exactly those bounds to decide which (x,y) are "blade
        // ring". The constructor has to mirror both, or the ring it fills is not
        // the ring the engine validates and `rotorValid` stays false.
        int bearingD = (dimX%2==0)?2:1;
        int bMin = 0, bMax = 0;
        for(int i = (dimX%2==0)?2:1; i<=dimX-2; i += 2){
            bMin = turbine.getExternalWidth()/2-i/2;
            bMax = turbine.getExternalWidth()/2+i/2-(i%2==0?1:0);
            bearingD = i;
            break;
        }
        final int bx0 = bMin, bx1 = bMax;
        for(int x = bx0; x<=bx1; x++){
            for(int y = bx0; y<=bx1; y++){
                for(int z = 0; z<=dimZ+1; z++){
                    Object t = (z==0||z==dimZ+1)?bearingTemplate:shaftTemplate;
                    placeTurbineBlock(turbine, t, x, y, z, rand);
                }
            }
        }

        // ---- 2. rotor: one template per z slice -------------------------------
        int statorCount = stators.isEmpty()?0:rand.nextInt(Math.min(dimZ, 3)+1);
        java.util.HashSet<Integer> statorSlices = new java.util.HashSet<>();
        while(statorSlices.size()<statorCount)statorSlices.add(1+rand.nextInt(dimZ));
        for(int z = 1; z<=dimZ; z++){
            Object t = statorSlices.contains(z)?stators.get(rand.nextInt(stators.size()))
                    :blades.get(rand.nextInt(blades.size()));
            for(int x = 1; x<=dimX; x++){
                for(int y = 1; y<=dimY; y++){
                    boolean xIn = x>=bx0&&x<=bx1;
                    boolean yIn = y>=bx0&&y<=bx1;
                    if(xIn==yIn)continue;// both => bearing; neither => outside the ring
                    placeTurbineBlock(turbine, t, x, y, z, rand);
                }
            }
        }

        // ---- 3. coils, on the ring adjacent to the bearing at both faces -----
        // `case 5` sums the coils found at z==0 and z==externalDepth-1 over the
        // interior x/y, and `calculateCoil` marks a coil valid only if it is
        // 6-adjacent to a block that is *already* valid AND its own placement rules
        // hold.
        //
        // Most dynamo-coil templates in this configuration require one or two
        // *other* coil types to be adjacent (silver needs gold AND copper, gold
        // needs aluminium, beryllium needs magnesium, ...). Such a coil can never
        // become valid by construction, and an invalid coil contributes 0 to
        // `coilEfficiency`. Exactly one template's rules mention only the bearing or
        // the connector — the lowest-efficiency one — and that is the bootstrap coil
        // a real turbine uses. Pick it explicitly rather than relying on list order.
        Object coilTemplate = coils.get(0);
        for(Object c : coils){
            Object cm = field(c, "coil");
            Object best = field(coilTemplate, "coil");
            if(cm==null||best==null)continue;
            if(((Number)field(cm, "efficiency")).floatValue()
                    <((Number)field(best, "efficiency")).floatValue())coilTemplate = c;
        }
        for(int[] zPair : new int[][]{{0,dimZ+1}}){
            int z = zPair[0];
            for(int x = 1; x<=dimX; x++){
                for(int y = 1; y<=dimY; y++){
                    boolean xIn = x>=bx0&&x<=bx1;
                    boolean yIn = y>=bx0&&y<=bx1;
                    if(xIn==yIn)continue;// the same ring as the blades: exactly one axis inside
                    placeTurbineBlock(turbine, coilTemplate, x, y, z, rand);
                }
            }
        }

        // ---- 4. coil connector on the casing face, if one can be valid -------
        // The connector's own rule is "at least 1 coil adjacent". Coils only exist
        // on the interior *ring*, which is never 6-adjacent to a casing-face
        // position unless the bearing reaches x/y == 1 (it does not: the search
        // picks the smallest odd diameter), so a connector can never be valid here.
        // It is placed only where the rule actually holds, and skipped otherwise.
        if(connectorTemplate!=null){
            for(int z : new int[]{0, dimZ+1}){
                for(int x = 1; x<=dimX; x++){
                    for(int y = 1; y<=dimY; y++){
                        boolean x1 = x==1||x==dimX;
                        boolean y1 = y==1||y==dimY;
                        if(x1==y1)continue;// corners are casing edges
                        boolean touchesCoil = false;
                        for(int[] dd : DIRS6){
                            BlockPos np = new BlockPos(x+dd[0], y+dd[1], z+dd[2]);
                            if(!turbine.contains(np))continue;
                            Object nb = turbine.getBlock(np);
                            if(nb!=null&&field(nb, "template")!=null&&field(field(nb, "template"), "coil")!=null){
                                touchesCoil = true;
                                break;
                            }
                        }
                        if(!touchesCoil)continue;
                        Object existing = turbine.getBlock(new BlockPos(x, y, z));
                        if(existing!=null&&field(field(existing, "template"), "controller")!=null)continue;
                        placeTurbineBlock(turbine, connectorTemplate, x, y, z, rand);
                        return;
                    }
                }
            }
        }
    }

    @SuppressWarnings({"rawtypes","unchecked"})
    private static void placeTurbineBlock(OverhaulTurbine turbine, Object template,
            int x, int y, int z, Random rand){
        Object proto = PROTOTYPES.get(template);
        if(proto==null)return;
        AbstractBlock placed = newInstanceAt((AbstractBlock)proto, new BlockPos(x, y, z));
        assignRecipe(placed, rand);
        turbine.setBlock(new BlockPos(x, y, z),
                (net.ncplanner.plannerator.multiblock.overhaul.turbine.Block)placed);
    }

    private static String category(Object template){
        for(String f : INTERIOR_MODULES){
            if(field(template, f)!=null)return f;
        }
        return null;
    }
    private static String templateName(Object block){
        Object t = field(block, "template");
        if(t instanceof NCPFElement){
            // datasetVersion 3: use the *injective* definition string, not the
            // (lossy) name. `getName()` collapses e.g. both `fission_reflector`
            // variants and all 16 `solid_fission_sink` variants into one entry,
            // which makes the grid ambiguous to reconstruct. See
            // docs/r1/r1.0-dataset-naming.md
            return ((NCPFElement)t).definition.toString();
        }
        return t==null?"?":t.getClass().getSimpleName();
    }

    /** Recipe name for a placed block: any element-valued field other than template. */
    private static String recipeName(Object block){
        for(Field f : block.getClass().getFields()){
            if(!NCPFElement.class.isAssignableFrom(f.getType()))continue;
            if(f.getName().equals("template"))continue;
            try{
                Object v = f.get(block);
                if(v instanceof NCPFElement){
                    // datasetVersion 3: injective definition string (same reasoning
                    // as templateName())
                    String n = ((NCPFElement)v).definition.toString();
                    return f.getName()+"="+n;
                }
            }catch(Throwable ignored){
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------------
    // reflection helpers
    // ---------------------------------------------------------------------------

    private static Object field(Object o, String name){
        for(Class<?> c = o.getClass(); c!=null&&c!=Object.class; c = c.getSuperclass()){
            try{
                Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f.get(o);
            }catch(NoSuchFieldException e){
                // keep walking up
            }catch(Throwable t){
                return null;
            }
        }
        return null;
    }

    private static void setField(Object o, String name, Object value){
        for(Class<?> c = o.getClass(); c!=null&&c!=Object.class; c = c.getSuperclass()){
            try{
                Field f = c.getDeclaredField(name);
                if(!f.getType().isAssignableFrom(value.getClass()))continue;
                f.setAccessible(true);
                f.set(o, value);
                return;
            }catch(NoSuchFieldException e){
                // keep walking up
            }catch(Throwable t){
                return;
            }
        }
    }

    /**
     * Every non-static numeric field of the object, including private ones,
     * most-derived declaration winning. This is the golden stat set.
     */
    private static TreeMap<String, Object> numericStats(Object o){
        TreeMap<String, Object> m = new TreeMap<>();
        for(Class<?> c = o.getClass(); c!=null&&c!=Object.class; c = c.getSuperclass()){
            for(Field f : c.getDeclaredFields()){
                if(Modifier.isStatic(f.getModifiers()))continue;
                Class<?> t = f.getType();
                if(t!=int.class&&t!=float.class&&t!=double.class&&t!=long.class)continue;
                String n = f.getName();
                if(NON_RESULT_FIELDS.contains(n))continue;
                if(m.containsKey(n))continue;// subclass declaration already captured
                try{
                    f.setAccessible(true);
                    m.put(n, f.get(o));
                }catch(Throwable ignored){
                }
            }
        }
        return m;
    }

    // ---------------------------------------------------------------------------
    // divergence
    // ---------------------------------------------------------------------------

    private static void compare(CaseResult res, TreeMap<String, Object> a, TreeMap<String, Object> b){
        for(Map.Entry<String, Object> e : a.entrySet()){
            Object av = e.getValue();
            Object bv = b.get(e.getKey());
            if(bv==null)continue;
            if(!(av instanceof Number)||!(bv instanceof Number))continue;
            double da = ((Number)av).doubleValue();
            double db = ((Number)bv).doubleValue();
            if(Double.compare(da, db)==0)continue;
            if(Double.isNaN(da)&&Double.isNaN(db))continue;
            double scale = Math.max(1e-9, Math.max(Math.abs(da), Math.abs(db)));
            if(Math.abs(da-db)/scale<1e-5)continue;
            res.divergence.add("\""+e.getKey()+"\":["+num(da)+","+num(db)+"]");
            res.divergenceFields.add(e.getKey());
        }
    }

    // ---------------------------------------------------------------------------
    // diagnostics
    // ---------------------------------------------------------------------------

    private static void printDiagnostics(ReactorSpec spec, CuboidalMultiblock cub, CaseResult res){
        System.out.println();
        System.out.println("========== DIAGNOSTICS "+res.id+" ("+spec.key+") ==========");
        System.out.println("interior size   : "+cub.getInternalWidth()+"x"+cub.getInternalHeight()+"x"+cub.getInternalDepth());
        System.out.println("full grid       : "+res.x+"x"+res.y+"x"+res.z);
        System.out.println("templates       : "+Arrays.toString(res.blockNames));
        System.out.println("recipes         : "+Arrays.toString(res.recipeNames));
        System.out.println("editor stats    : "+map(res.editor));
        System.out.println("lite stats      : "+(res.lite==null?"null":map(res.lite)));
        System.out.println("divergence      : "+res.divergence);
        System.out.println("grid layers (x horizontal, z vertical):");
        for(int y = 0; y<res.y; y++){
            System.out.println("  y="+y);
            for(int z = 0; z<res.z; z++){
                StringBuilder sb = new StringBuilder("   ");
                for(int x = 0; x<res.x; x++){
                    int v = res.grid[x*res.y*res.z+y*res.z+z];
                    sb.append(v<0?'.':(char)('A'+(v%26)));
                }
                System.out.println(sb);
            }
        }
        System.out.println("legend:");
        for(int i = 0; i<res.blockNames.length; i++){
            System.out.println("   "+(char)('A'+(i%26))+" = "+res.blockNames[i]);
        }
        System.out.println("==========================================");
        System.out.println();
    }

    // ---------------------------------------------------------------------------
    // json helpers
    // ---------------------------------------------------------------------------

    private static String map(TreeMap<String, Object> m){
        if(m==null)return "null";
        StringBuilder sb = new StringBuilder(256);
        sb.append('{');
        boolean first = true;
        for(Map.Entry<String, Object> e : m.entrySet()){
            if(!first)sb.append(',');
            first = false;
            sb.append('"').append(esc(e.getKey())).append("\":").append(value(e.getValue()));
        }
        sb.append('}');
        return sb.toString();
    }

    private static String value(Object v){
        if(v==null)return "null";
        if(v instanceof Float){
            float f = (Float)v;
            if(Float.isNaN(f))return "\"NaN\"";
            if(Float.isInfinite(f))return f>0?"\"Infinity\"":"\"-Infinity\"";
            return Float.toString(f);
        }
        if(v instanceof Double){
            double d = (Double)v;
            if(Double.isNaN(d))return "\"NaN\"";
            if(Double.isInfinite(d))return d>0?"\"Infinity\"":"\"-Infinity\"";
            return Double.toString(d);
        }
        if(v instanceof Number)return v.toString();
        return "\""+esc(String.valueOf(v))+"\"";
    }

    private static String num(double d){
        if(Double.isNaN(d))return "\"NaN\"";
        if(Double.isInfinite(d))return d>0?"\"Infinity\"":"\"-Infinity\"";
        if(d==Math.rint(d)&&Math.abs(d)<1e15)return String.valueOf((long)d);
        return Double.toString(d);
    }

    private static String strArray(String[] a){
        StringBuilder sb = new StringBuilder(128);
        sb.append('[');
        for(int i = 0; i<a.length; i++){
            if(i>0)sb.append(',');
            sb.append('"').append(esc(a[i])).append('"');
        }
        sb.append(']');
        return sb.toString();
    }

    private static String intArray(int[] a){
        StringBuilder sb = new StringBuilder(a.length*3+2);
        sb.append('[');
        for(int i = 0; i<a.length; i++){
            if(i>0)sb.append(',');
            sb.append(a[i]);
        }
        sb.append(']');
        return sb.toString();
    }

    private static String esc(String s){
        StringBuilder sb = new StringBuilder(s.length()+8);
        for(int i = 0; i<s.length(); i++){
            char c = s.charAt(i);
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


