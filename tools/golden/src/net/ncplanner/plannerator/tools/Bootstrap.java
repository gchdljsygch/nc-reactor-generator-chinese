package net.ncplanner.plannerator.tools;

import net.ncplanner.plannerator.planner.Core;
import net.ncplanner.plannerator.planner.Main;
import net.ncplanner.plannerator.planner.file.FileReader;
import net.ncplanner.plannerator.planner.file.reader.*;
import net.ncplanner.plannerator.planner.module.CoreModule;
import net.ncplanner.plannerator.planner.module.FusionTestModule;
import net.ncplanner.plannerator.planner.module.OverhaulModule;
import net.ncplanner.plannerator.planner.module.PrimeFuelModule;
import net.ncplanner.plannerator.planner.module.QuantumTraversedEfficiencyModule;
import net.ncplanner.plannerator.planner.module.RainbowFactorModule;
import net.ncplanner.plannerator.planner.module.TiConModule;
import net.ncplanner.plannerator.planner.module.UnderhaulModule;
import net.ncplanner.plannerator.planner.ncpf.Configuration;

/**
 * Brings up the plannerator domain layer with NO GL context, so that the
 * simulation, NCPF model and format readers can be exercised from a CLI.
 *
 * <p>Two switches make this possible:
 * <ul>
 *   <li>{@code plannerator.skipTextures=true} — {@code TextureModule.convertFromObject}
 *       returns early instead of base64-decoding a PNG. The shipped NCPF configs are
 *       ~10 MB and almost all of that is texture payload, so this is what lets the
 *       configuration load without OpenGL.</li>
 *   <li>{@code Main.isBot=true} — {@code Core.warning/error/criticalError} short-circuit
 *       before dereferencing {@code Core.gui}, which is null here.</li>
 * </ul>
 *
 * <p>Mirrors the ordering used by {@code MenuInit}, stopping before anything that
 * needs a window.
 */
public final class Bootstrap{
    private static boolean done = false;

    private Bootstrap(){}

    /** Idempotent. Safe to call from several tools in one JVM. */
    public static synchronized void init(){
        if(done)return;
        done = true;

        System.setProperty("plannerator.skipTextures", "true");
        Main.isBot = true;
        Main.headless = true;
        Main.novr = true;

        log("resetting metadata");
        Core.resetMetadata();

        log("registering file formats");
        registerAllReaders();

        log("registering modules");
        // Exactly the set MenuInit registers. Only the ones whose constructor passes
        // defaultActive=true (core / underhaul / overhaul) end up registered by
        // refreshModules(); the rest stay dormant until activateModule() is called,
        // mirroring what a default install does.
        Core.modules.add(new CoreModule());
        Core.modules.add(new UnderhaulModule());
        Core.modules.add(new OverhaulModule());
        Core.modules.add(new FusionTestModule());
        Core.modules.add(new RainbowFactorModule());
        Core.modules.add(new PrimeFuelModule());
        Core.modules.add(new QuantumTraversedEfficiencyModule());
        Core.modules.add(new TiConModule());

        log("refreshModules (classgraph scan)");
        Core.refreshModules();

        log("loading NuclearCraft configuration");
        Configuration.initNuclearcraftConfiguration();
        Core.setConfiguration(Configuration.NUCLEARCRAFT);

        log("ready");
    }

    /**
     * Registers every {@link net.ncplanner.plannerator.planner.file.FormatReader}
     * in exactly the order {@code MenuInit} does.
     *
     * <p>The order is load-bearing: {@code FileReader.read} walks the list forward
     * and takes the first reader whose {@code formatMatches} is true AND whose
     * {@code read()} returns non-null. {@code NCPFReader} is first but always
     * "matches", so it deliberately returns {@code null} for non-NCPF files to let
     * the legacy readers have a turn. See docs/r0/compat-contract.md §6.
     */
    public static void registerAllReaders(){
        FileReader.formats.add(new NCPFReader());
        FileReader.formats.add(new LegacyNCPF11Reader());
        FileReader.formats.add(new LegacyNCPF10Reader());
        FileReader.formats.add(new LegacyNCPF9Reader());
        FileReader.formats.add(new LegacyNCPF8Reader());
        FileReader.formats.add(new LegacyNCPF7Reader());
        FileReader.formats.add(new LegacyNCPF6Reader());
        FileReader.formats.add(new LegacyNCPF5Reader());
        FileReader.formats.add(new LegacyNCPF4Reader());
        FileReader.formats.add(new LegacyNCPF3Reader());
        FileReader.formats.add(new LegacyNCPF2Reader());
        FileReader.formats.add(new LegacyNCPF1Reader());
        FileReader.formats.add(new OverhaulHellrageSFR6Reader());
        FileReader.formats.add(new OverhaulHellrageSFR5Reader());
        FileReader.formats.add(new OverhaulHellrageSFR4Reader());
        FileReader.formats.add(new OverhaulHellrageSFR3Reader());
        FileReader.formats.add(new OverhaulHellrageSFR2Reader());
        FileReader.formats.add(new OverhaulHellrageSFR1Reader());
        FileReader.formats.add(new UnderhaulHellrage2Reader());
        FileReader.formats.add(new UnderhaulHellrage1Reader());
        FileReader.formats.add(new OverhaulHellrageMSR6Reader());
        FileReader.formats.add(new OverhaulHellrageMSR5Reader());
        FileReader.formats.add(new OverhaulHellrageMSR4Reader());
        FileReader.formats.add(new OverhaulHellrageMSR3Reader());
        FileReader.formats.add(new OverhaulHellrageMSR2Reader());
        FileReader.formats.add(new OverhaulHellrageMSR1Reader());
        FileReader.formats.add(new OverhaulNCConfigReader());
        FileReader.formats.add(new UnderhaulNCConfigReader());
    }

    /** @return the loaded NuclearCraft configuration. Calls {@link #init()} if needed. */
    public static Configuration nuclearcraft(){
        init();
        return Configuration.NUCLEARCRAFT;
    }

    /**
     * Turns on a module that is inactive by default (e.g. {@code fusion_test},
     * {@code rainbow_factor}) and re-runs registration. Some shipped configuration
     * files can only be read once their module is active.
     *
     * @return true if a module with that name existed
     */
    public static synchronized boolean activateModule(String name){
        init();
        boolean found = false;
        for(net.ncplanner.plannerator.planner.module.Module m : Core.modules){
            if(!m.name.equals(name))continue;
            found = true;
            if(!m.isActive()){
                log("activating module '"+name+"'");
                m.activate();// also re-runs Core.refreshModules()
            }
        }
        return found;
    }

    private static void log(String message){
        System.out.println("[bootstrap] "+message);
    }
}
